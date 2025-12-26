# 数据库时区问题修复

## 问题描述

### 现象
接口返回的时间数据：
```json
{
  "created_at": "2025-12-25T16:15:33.162916"
}
```

用户实际操作时间：昨天晚上 12:00（即 `2025-12-25 00:00:00` 左右）

### 问题分析
返回的时间 `16:15:33` 比实际操作时间 `00:00:00` 晚了约 16 小时，这表明：
1. 数据库存储的时间**不是 UTC 时间**
2. 数据库直接存储了**东8区本地时间**
3. 时间字符串**没有时区标识**（缺少 `Z` 或 `+08:00`）

### 根本原因
Supabase (PostgreSQL) 数据库可能配置为使用本地时区（Asia/Shanghai），导致：
- `NOW()` 函数返回东8区时间而非 UTC 时间
- `timestamp without time zone` 类型字段存储本地时间

## 解决方案

### 方案 1：前端智能处理（已实施）✅

修改 `src/lib/date-utils.ts`，让时间格式化函数能够智能识别时间格式：

```typescript
function toBeijingTime(date: Date | string | null): Date | null {
  if (!date) return null;

  if (typeof date === 'string') {
    // 检查是否包含时区标识
    const hasTimezone = date.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(date);
    
    if (!hasTimezone) {
      // 不带时区 = 假定为东8区本地时间
      // 需要减去 8 小时转为 UTC，再让 Intl 格式化为东8区
      const d = new Date(date);
      const utcTime = new Date(d.getTime() - 8 * 60 * 60 * 1000);
      return utcTime;
    }
  }

  return typeof date === 'string' ? new Date(date) : date;
}
```

**优点：**
- ✅ 无需修改数据库
- ✅ 无需迁移现有数据
- ✅ 立即生效
- ✅ 向后兼容

**处理逻辑：**
```
输入: "2025-12-25T16:15:33.162916"（数据库返回，东8区时间）
↓
减去 8 小时转为 UTC: "2025-12-25T08:15:33.162916Z"
↓
Intl.DateTimeFormat 转为东8区显示: "2025-12-25 16:15:33"
```

### 方案 2：修复数据库配置（可选）

如果需要规范化数据存储，可以执行 `docs/fix-timezone.sql` 脚本：

```sql
-- 设置数据库默认时区为 UTC
ALTER DATABASE postgres SET timezone TO 'UTC';

-- 修改表的默认值使用 UTC 时间
ALTER TABLE export_history 
ALTER COLUMN created_at SET DEFAULT (NOW() AT TIME ZONE 'UTC');
```

**优点：**
- ✅ 符合最佳实践（数据库存 UTC）
- ✅ 避免时区混乱

**缺点：**
- ❌ 需要迁移现有数据
- ❌ 需要数据库管理权限

## 测试验证

### 测试用例

```typescript
// 测试不带时区的时间字符串
formatDateTime('2025-12-25T16:15:33.162916')
// 输出: '2025-12-25 16:15:33' ✅

// 测试带时区的 UTC 时间
formatDateTime('2024-12-26T06:30:45.000Z')
// 输出: '2024-12-26 14:30:45' ✅
```

### 验证步骤

1. 查看导出历史列表的创建时间
2. 确认显示的时间与实际操作时间一致
3. 检查其他时间字段（爬取任务、用户登录等）

## 时间格式对照表

| 数据库存储格式 | 前端显示 | 说明 |
|--------------|---------|------|
| `2025-12-25T16:15:33.162916` | `2025-12-25 16:15:33` | 不带时区，假定为东8区 |
| `2024-12-26T06:30:45.000Z` | `2024-12-26 14:30:45` | UTC 时间，+8小时显示 |
| `2024-12-26T14:30:45+08:00` | `2024-12-26 14:30:45` | 带时区标识的东8区时间 |

## 注意事项

1. **新功能开发**：建议在后端插入数据时使用 UTC 时间
2. **数据导出**：导出的 Excel 文件中的时间已经是东8区格式
3. **API 设计**：建议 API 返回带时区标识的 ISO 8601 格式
4. **跨时区支持**：如果未来需要支持其他时区，需要重构为用户时区配置

## 最佳实践建议

### 后端（推荐但非必需）

```typescript
// 插入数据时显式使用 UTC 时间
const now = new Date().toISOString(); // 包含 Z 的 UTC 时间
await supabase.from('export_history').insert({
  created_at: now,
  // ...
});
```

### 前端（已实施）

```typescript
// 使用统一的时间格式化工具
import { formatDateTime } from '@/lib/date-utils';

// 显示时间
<span>{formatDateTime(item.created_at)}</span>
```

## 总结

✅ **当前状态**：前端已修复，可以正确显示所有时间  
⚠️ **数据库状态**：仍在存储本地时间，但不影响显示  
📋 **建议**：未来有机会时执行数据库规范化（可选）
