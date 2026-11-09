# 远程 MCP

地址：`https://spider.wakaja.top/api/mcp`。服务名 `cj-spider`，版本取 package.json。使用官方 `@modelcontextprotocol/sdk` 1.32.2 的 Web Standard Streamable HTTP，每个请求新建无状态 server/transport，不生成 MCP session ID。POST、GET、DELETE 均交由 SDK 处理（无状态模式不提供持久 SSE 会话或可删除的会话）。路由使用 Node.js runtime、force-dynamic。不提供 OAuth，MCP 不读取或设置站内登录 Cookie。

## 创建、管理和使用 API Key

1. 用站内账号登录，打开 `/profile` 的“API Key”区块。
2. 新建 Key，填写名称（1–100 字符）和可选有效期（整数天）；留空表示不过期。
3. 创建弹窗只显示一次完整 Key，点击复制并保存到客户端私有配置。关闭后列表仅显示名称、前缀、创建/最后使用/到期/吊销时间，不能再次取回完整 Key。
4. 不再使用时，在列表确认吊销。每个账号最多 10 个未吊销 Key，过期 Key 也占名额，需吊销释放。
5. 管理员在 `/users` 的“所有用户的 API Key”区块查看用户名及全部 Key 元数据，可以确认吊销任意 Key。

Key 格式是 `cjsk_<8位随机hex前缀>_<32字节随机数的base64url编码>`。数据库只保存完整 Key 的 SHA-256 hash，不存明文；按前缀查找后用 `timingSafeEqual` 比较等长摘要，前缀不存在也做假比较。无需额外 HMAC 环境变量。

Key 没有 scope，权限等于所属账号的**当前角色**。每次请求重新查询用户的 role 和 is_active：启用的 user/admin 均能调用八个爬取、新闻、验证码工具；只有 admin 可以调用 `create_user`。管理员降为 user 后，其 Key 立即失去建号权限；用户停用、删除或 Key 吊销、过期后，请求返回统一 401。`tools/list` 对普通用户和管理员均列出全部九个工具，`create_user` 的中文说明标明“仅管理员”，调用时仍校验角色。

Key 管理 API 仅接受站内 JWT Cookie 登录（`requireSiteAuth`），不接受 Bearer Key，防止 Key 自行创建 Key。反过来，API Key 只能访问 `/api/mcp`，不能访问其他站内 API。

| 管理 API | 行为 |
| --- | --- |
| `GET /api/api-keys` | 自己的元数据列表，不含 hash 或完整 Key。 |
| `POST /api/api-keys` | `{"name":"Grok Bot","expires_in_days":30}`，仅创建响应返回完整 `key`。有效期可省略，范围 1–36500 天。 |
| `DELETE /api/api-keys/:id` | 写入 revoked_at，保留记录；普通用户只能吊销自己的 Key，管理员可吊销任意 Key。 |
| `GET /api/api-keys?all=1` | 管理员列出所有人的 Key 并附用户名；普通用户返回 403。 |

## 环境变量

以下值只在服务器 runtime 注入，禁止用于构建或提交到仓库。Compose 已映射原站凭据。

| 变量 | 用途与缺失行为 |
| --- | --- |
| `CJ_USERNAME` | 固定原站账号；缺失时 get_captcha、submit_captcha 返回明确配置错误，应用照常启动。 |
| `CJ_PASSWORD` | 固定原站密码；缺失行为同上。 |
| `DATABASE_URL` | 应用运行必填，保持现有数据库启动校验。 |
| `JWT_SECRET` | 站内登录运行必填，保持现有启动校验；不是 MCP Bearer Key。 |

MCP 不需要全局 token、指定代理用户名或启用开关。没有可用 Key 时 `/api/mcp` 自然返回 401，应用照常启动。示例文件中的原站凭据只允许占位符：

```dotenv
CJ_USERNAME=REPLACE
CJ_PASSWORD=REPLACE
```

## 九个工具与输入输出

所有工具都有中文 description 和严格 Zod schema，未知字段也会被拒绝。除新闻列表外，成功结果同时给 JSON text 和同值 structuredContent；验证码还附 MCP image。时间一律 `+08:00`。下列 task_id、用户 ID、会话 ID 和文章均为示意值，实际进度可能随后台执行变化。

| 工具 | 输入示例 | 输出示例 / 行为 |
| --- | --- | --- |
| `start_crawl` | `{"pages":10,"skip_existing":true,"idempotency_key":"chat-request-001"}` | `{"task_id":"42","status":"paused","start_page":1,"end_page":10,"needs_captcha":true}`；缺登录时先持久化待执行任务，登录后自动启动。已有活动任务时附 `"already_running":true`。 |
| `get_crawl_status` | `{"task_id":"42"}` 或 `{}` | 返回下方完整进度对象；省略编号取最近任务。 |
| `get_captcha` | `{}` | `content` 包含 `{"type":"image","data":"<base64图片>","mimeType":"image/png"}` 和 JSON text `{"login_session_id":"<会话ID>","expires_in_seconds":300,"hint":"请识别图片并在五分钟内提交验证码；失败后请重新获取。"}`；structuredContent 同 text 对象。mimeType 使用原站实际 Content-Type。 |
| `submit_captcha` | `{"code":"1234","login_session_id":"<会话ID>"}` | `{"logged_in":true,"resumed_task_id":"42"}`；没有待恢复任务时不含 resumed_task_id。登录后必须复核会员页，失败返回 `{"logged_in":false,"error":"登录失败或验证码已过期，请重新获取验证码"}`。 |
| `pause_crawl` | `{"task_id":"42"}` 或 `{}` | 返回完整进度对象，例如 state 为 `paused`；省略编号取活动任务。 |
| `resume_crawl` | `{"task_id":"42"}` 或 `{}` | 返回完整进度对象，例如 state 为 `running`；列表阶段登录失效时为 `paused`、needs_captcha:true、pause_reason:cj_login_required。 |
| `cancel_crawl` | `{"task_id":"42"}` 或 `{}` | 返回完整进度对象，state 为 `cancelled`，已入库数据保留；省略编号取活动任务。 |
| `create_user` | `{"username":"mcp_example_user","role":"user"}` | 仅管理员：`{"user_id":7,"username":"mcp_example_user","role":"user","generated_password":"<仅本次返回的随机密码>"}`。也可传 `{"username":"mcp_example_admin","password":"<私有密码>","role":"admin"}`，此时结果不含 generated_password。 |
| `list_recent_news` | `{"limit":20,"start_date":"2026-11-01","end_date":"2026-11-10","keyword":"合肥"}` 或 `{}` | text 是 JSON 数组，structuredContent 是 `{"news":[...]}`；仅返回下述字段，不含正文。 |

`start_crawl` 的 pages 为整数 1..100，表示第 1..pages 页；可替换为 `{"start_page":5,"end_page":14}`，两种形式互斥，范围必须完整、正整数、起点不晚于终点且最多 100 页。skip_existing 默认 true，idempotency_key 长度 1–200。task_id 是正整数的字符串。

验证码 code 为 4–6 字符，login_session_id 使用上一步返回值。会话有效五分钟、绑定站内用户、仅可提交一次；进程重启或失败后重新取图。

`create_user` 的 username 长度 3–50，password 可省略，提供时至少 4 字符；role 为 user/admin，默认 user。与 `/api/users` POST 共用 `createUserValidated` 校验和建号逻辑，在同一事务内写 bcrypt 密码哈希及 local auth_identity。省略密码时生成至少 16 字符的强随机密码，仅在本次结果返回，不写日志或审计。

新闻 limit 为整数 1..50，默认 20；start_date/end_date 是有效 YYYY-MM-DD，北京时间整天范围，开始不得晚于结束；keyword 最多 200 字符。复用 news-service.getNewsList。

完整进度对象示例（pause/resume/cancel 也返回此形状，字段取操作后的实际值）：

```json
{
  "task_id":"42", "state":"paused", "phase":"list",
  "current_page":3, "total_pages":10, "total_news":60,
  "crawled":40, "failed":0, "pending":20,
  "avg_speed":2, "eta_minutes":10,
  "needs_captcha":true, "pause_reason":"cj_login_required",
  "recent_titles":[{"time":"2026-11-10T08:00:00+08:00","page":3,"title":"示例文章","status":"completed"}],
  "started_at":"2026-11-10T07:50:00+08:00", "finished_at":null
}
```

state 为 running/paused/completed/failed/cancelled，recent_titles 最多十条。current_page 保留相对进度语义；恢复游标另按绝对页码持久化。

新闻结果示例：

```json
{
  "content":[{"type":"text","text":"[{\"source_id\":\"123\",\"title\":\"示例文章\",\"author\":null,\"source_name\":\"示例来源\",\"region\":\"合肥\",\"publish_time\":\"2026-11-10T08:00:00+08:00\",\"url\":\"https://example.com/news/123\"}]"}],
  "structuredContent":{"news":[{"source_id":"123","title":"示例文章","author":null,"source_name":"示例来源","region":"合肥","publish_time":"2026-11-10T08:00:00+08:00","url":"https://example.com/news/123"}]}
}
```

## 错误与限流

| 情况 | 响应 / 处理 |
| --- | --- |
| 缺少、错误、已吊销、过期的 Bearer Key，或所属用户不存在/停用 | HTTP 401 `{"error":"Unauthorized"}`，`WWW-Authenticate: Bearer`，不区分具体原因。 |
| 数据库鉴权暂不可用 | HTTP 503 `{"error":"MCP unavailable"}`；不是配置开关。 |
| 鉴权失败来源 IP 达每分钟 20 次 | 后续请求 HTTP 429，`Retry-After: 60`。 |
| 普通用户调用 create_user | MCP `isError:true`，text 与 structuredContent 均为 `{"error":"forbidden: admin only"}`，记录失败审计。 |
| 无效参数、越界、混用页数和范围、未知字段 | MCP `isError:true`，`{"error":"参数无效，请检查工具输入格式和范围"}`。 |
| create_user 用户名重复 | MCP `isError:true`，返回共享建号逻辑的明确用户名重复错误；密码不回显。 |
| get_crawl_status 无任务 | MCP `isError:true`，`{"error":"没有找到任务"}`。 |
| pause/resume/cancel 无活动任务或状态不允许 | MCP `isError:true`，错误为“没有活动任务”“任务当前无法继续”或“任务当前无法执行此操作”。 |
| 原站凭据缺失 | MCP `isError:true`，`{"error":"未配置 CJ_USERNAME 和 CJ_PASSWORD，无法登录原站"}`。 |
| 验证码失败、过期、重复提交或属于其他用户 | `{"logged_in":false,"error":"登录失败或验证码已过期，请重新获取验证码"}`；这是业务失败，未设置 isError，审计 ok=false。 |
| 验证码图片非图片 MIME | MCP `isError:true`，“验证码图片暂不可用，请重新获取验证码”。 |
| 工具限流 | MCP `isError:true`，“调用过于频繁，请稍后重试”。 |
| 未知工具 / 执行异常 / 审计不可用 | MCP `isError:true`，分别返回“未知工具”、安全执行错误或“审计记录暂不可用，请稍后重试”，不泄露上游原始错误。 |

按 Key 使用进程内令牌桶：每分钟 60 次工具调用，get_captcha 与 submit_captcha 合计 10 次，start_crawl 3 次。last_used_at 距上次更新超过 60 秒才写库。

每次工具调用写 mcp_audit_log，包含 user_id、api_key_id、工具、脱敏参数、结果、耗时及 task_id，并打印结构化日志中的 key_prefix。验证码只记长度；建号仅记 username、role、password_source（provided/generated），不记密码；任何完整 Key、Cookie、原站密码都不记录。Key 创建/吊销日志记操作者、时间和前缀。审计外键 ON DELETE SET NULL，用户或 Key 删除不删除审计历史。

## 客户端与 Inspector 手动验证

客户端需支持 Streamable HTTP 和自定义 Authorization header。配置键名按具体客户端调整，以下 Key 值是占位符：

```json
{
  "mcpServers": {
    "cj-spider": {
      "type":"streamable-http",
      "url":"https://spider.wakaja.top/api/mcp",
      "headers":{"Authorization":"Bearer <从 /profile 复制的 API Key>"}
    }
  }
}
```

以下是操作者在批准的测试环境/发布验证阶段执行的步骤；写操作会创建账号或爬取任务。本次文档更新不执行这些步骤，也不连接生产或真实原站。

1. 分别以普通用户和管理员登录站内，在各自 `/profile` 创建测试 Key。管理员到 `/users` 确认可见两个用户的元数据，列表没有明文 Key/hash。
2. 本机运行 `npx @modelcontextprotocol/inspector`，打开它显示的本地 UI，选择 Streamable HTTP，填服务 URL 和 header `Authorization: Bearer <普通用户Key>`。
3. Connect、List Tools，应列出全部九个工具，create_user 标明“仅管理员”。调用 `get_crawl_status {}`（空库应有明确无任务错误）、`list_recent_news {"limit":1}`、`get_captcha {}`，确认图片 MIME 和五分钟会话。
4. 用普通用户 Key 调 `create_user {"username":"inspector_user_denied"}`，应得到 isError:true / forbidden: admin only，并有失败审计；普通用户仍可使用爬取、新闻和验证码工具。
5. 换成管理员 Key，重新 Connect、List Tools，仍为九个。调用 `create_user {"username":"inspector_created_user"}`，确认返回 user_id、role:user 和一次性 generated_password。用另一唯一用户名、私有显式密码和 role:admin 验证可创建管理员且不返回 generated_password。重复用户名应明确报错。
6. 调 `start_crawl {"pages":1,"idempotency_key":"inspector-test-001"}`。若 needs_captcha:true，取新图、人工输入 code 并提交同一 login_session_id，确认 logged_in:true 和 resumed_task_id；查询状态，按需测试 pause/resume/cancel，再查新闻。重复幂等键应复用 task_id。
7. 将测试管理员降为 user，其原 Key 的 create_user 应立即被拒；停用该用户后请求应为 401。吊销普通用户测试 Key、或使用已过期/错误 Key、移除 header，均应统一 401。恢复测试账号配置并清理测试账号/Key。
8. 用站内登录 Cookie 验证普通用户不能 `GET /api/api-keys?all=1` 或吊销其他用户 Key，管理员可以；仅带 Bearer Key 访问 `/api/api-keys` 或 `/api/users` 应被拒。

聊天示例：用户说“爬最新 10 页”→ Bot 调 start_crawl → needs_captcha 时调 get_captcha，把图片发给用户 → 用户输入验证码 → Bot 调 submit_captcha → 自动启动或继续任务 → 调 get_crawl_status 和 list_recent_news。失败后重新取图，不复用旧会话。

## 持久化、并发与恢复

幂等迁移 `002-mcp` 纳入版本账本，添加任务绝对 start/end/next 页码、暂停原因、执行代次、幂等键、最近文章，以及 api_keys、mcp_audit_log。Key 无 scope 列。

全局只允许一个 running 或 paused 任务，Web 和 MCP 共用数据库事务内的 `LOCK TABLE crawl_sessions IN SHARE ROW EXCLUSIVE MODE`，串行化活动任务检查与写入。已有活动任务时 MCP 返回该任务及 already_running:true，Web start 返回 409 和当前任务。同一 idempotency_key 在十分钟内复用 task_id，包括已结束任务。

原站 Cookie 存 login_sessions，仅使用最新有效且未过期记录，不通过接口返回。登录合并 Cookie 后用 checkLoginStatus 复核。验证码复用内存 session-store，与 Web 隔离并绑定用户。Web 浏览器 cj_auth 流程兼容；启动/继续 Web 爬取时将所提供 Cookie 写入服务端会话，供共享执行。

列表登录失效时暂停为 paused/cj_login_required，失效的原站会话标记无效，持久化失败的绝对页码；验证码登录成功后从该页继续，不重爬已完成页、不超出原始 end_page。手动暂停不会仅因登录成功而自动继续，需显式 resume；resume 遇登录失效则转为等待验证码。详情阶段不需要 Cookie。执行代次防止暂停/取消后旧请求覆盖状态，正在请求的详情可能完成入库，之后停止。首次访问将残留 running 恢复为 paused/server_restart，释放错误的运行状态，保留活动任务等待显式恢复。

**部署只运行一个 Next.js 进程/副本。** 验证码、限流、后台执行和重启恢复仍依赖进程内协调；数据库任务锁不构成多副本 worker 协议。扩容前需共享验证码存储和任务租约/独立 worker。原站会话数据库及备份按凭据保护。

## 发布步骤（仅供操作者执行，本次不执行）

顺序必须是：服务器环境文件 → 002 迁移 → 更换镜像 → 验证。不能先启动依赖新表的镜像。

1. 在服务器 `~/wakaja/spider/.env.production` 追加私有 `CJ_USERNAME`、`CJ_PASSWORD`，保留 DATABASE_URL、JWT_SECRET，清除历史共享 MCP 鉴权设置。不要写入仓库或构建参数；没有原站凭据也能启动，但不能获取/提交验证码。
2. 备份数据库并暂停旧应用写入。使用待发布版本源码（包含迁移文件）、私有 runtime 环境，先 `pnpm install --frozen-lockfile`。从受保护的 `.env.production` 由部署工具注入环境后运行 `pnpm db:migrate`，确认版本账本中 `002-mcp` 成功。`pnpm db:migrate` 不自动加载 `.env.production`，需显式注入；精简 runner 镜像不包含 tsx 和迁移源码，不在该镜像内直接执行迁移。
3. 将 `CJ_SPIDER_IMAGE` 设置为包含本次变更的固定版本镜像（保留旧镜像供回滚），在 `~/wakaja/spider` 使用本版本 compose：`docker compose --env-file .env.production pull cj-spider`，然后 `docker compose --env-file .env.production up -d --no-build cj-spider`。仅启动单进程/单副本，不依赖可变 latest 标签。
4. 检查容器健康和 `/api/health`，验证站内登录、原有 API、`/profile` 新建/复制一次/吊销 Key、管理员 `/users` 管理全部 Key。无 Bearer Key 的 MCP 请求应 401；随后按 Inspector 普通用户/管理员步骤验证九个工具和角色变更。不要在截图、终端日志或工单公开 Key/密码。

本地实现验证清单：`pnpm install --frozen-lockfile`、`pnpm test`、`pnpm lint`、`pnpm typecheck`、不带密钥的 `pnpm build`、`git diff --check`。SDK 集成测试使用真实 Client + StreamableHTTPClientTransport、PGlite、现场生成的 Key 和模拟原站请求，不访问生产或真实 ahcaijing.com。这是验证要求，不代表本次文档修改已运行整套实现测试。
