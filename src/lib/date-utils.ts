/**
 * 时间格式化工具函数
 * 统一使用东8区（中国标准时间）进行显示
 */

/**
 * 将日期转换为可用的 Date 对象
 * 处理两种情况：
 * 1. 带时区的 ISO 字符串（如 "2024-12-26T06:30:45.000Z"）- 直接解析
 * 2. 不带时区的字符串（如 "2025-12-25T16:15:33.162916"）- 假定为 UTC 时间，自动添加 Z 标识
 */
function toBeijingTime(date: Date | string | null): Date | null {
  if (!date) return null;

  if (typeof date === "string") {
    // 检查字符串是否包含时区标识（Z 或 +/-）
    const hasTimezone = date.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(date);

    if (!hasTimezone) {
      // 不带时区标识，假定为 UTC 时间，添加 Z 标识
      const utcString = date + "Z";
      const d = new Date(utcString);
      if (isNaN(d.getTime())) return null;
      return d;
    }
  }

  const d = typeof date === "string" ? new Date(date) : date;

  // 检查是否为有效日期
  if (isNaN(d.getTime())) return null;

  return d;
}

/**
 * 格式化日期时间为完整格式（东8区）
 * @param dateStr ISO 日期字符串或 Date 对象
 * @returns 格式化后的日期时间字符串，如 "2024-12-26 14:30:45"
 * @example
 * formatDateTime("2024-12-26T06:30:45.000Z") // "2024-12-26 14:30:45"
 */
export function formatDateTime(dateStr: string | Date | null): string {
  const date = toBeijingTime(dateStr);
  if (!date) return "-";

  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(/\//g, "-");
}

/**
 * 格式化日期为短格式（东8区）
 * @param dateStr ISO 日期字符串或 Date 对象
 * @returns 格式化后的日期字符串，如 "2024-12-26"
 * @example
 * formatDate("2024-12-26T06:30:45.000Z") // "2024-12-26"
 */
export function formatDate(dateStr: string | Date | null): string {
  const date = toBeijingTime(dateStr);
  if (!date) return "-";

  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(date)
    .replace(/\//g, "-");
}

/**
 * 格式化为相对时间描述
 * @param dateStr ISO 日期字符串或 Date 对象
 * @returns 相对时间描述，如 "刚刚"、"5分钟前"、"2小时前"
 */
export function formatRelativeTime(dateStr: string | Date | null): string {
  const date = toBeijingTime(dateStr);
  if (!date) return "-";

  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 30) return `${days}天前`;

  return formatDate(date);
}

/**
 * 计算时间差（分钟）
 * @param startDate 开始时间
 * @param endDate 结束时间，默认为当前时间
 * @returns 时间差（分钟），保留1位小数
 */
export function calculateDuration(
  startDate: string | Date | null,
  endDate: string | Date | null = null,
): number {
  const start = toBeijingTime(startDate);
  if (!start) return 0;

  const end = endDate ? toBeijingTime(endDate) : new Date();
  if (!end) return 0;

  const diff = end.getTime() - start.getTime();
  return Math.round((diff / 60000) * 10) / 10;
}

/**
 * 格式化时长为易读格式
 * @param minutes 分钟数
 * @returns 格式化后的时长字符串，如 "2.5 分钟"、"1 小时 30 分钟"
 */
export function formatDuration(minutes: number): string {
  if (minutes <= 0) return "-";
  if (minutes < 1) return "< 1 分钟";
  if (minutes < 60) return `${Math.ceil(minutes)} 分钟`;

  const hours = Math.floor(minutes / 60);
  const mins = Math.ceil(minutes % 60);

  if (mins === 0) return `${hours} 小时`;
  return `${hours} 小时 ${mins} 分钟`;
}

/**
 * 格式化时长为简短格式（用于表格显示）
 * @param startDate 开始时间
 * @param endDate 结束时间，默认为当前时间
 * @returns 格式化后的时长字符串
 */
export function formatDurationFromDates(
  startDate: string | Date | null,
  endDate: string | Date | null = null,
): string {
  const minutes = calculateDuration(startDate, endDate);
  return formatDuration(minutes);
}
