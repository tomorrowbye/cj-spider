# PostgreSQL 迁移与切流手册（第一阶段）

本阶段保留现有 UI、API、统计、导出和账号功能，使用 Kysely 0.29 + pg。微信登录、UI 重做、独立 worker 和 MCP 不在本阶段。本文命令由运维在审核后的版本执行；构建或合并代码不代表已迁移或部署。

## 1. 准备环境与备份

- Node.js ≥22、pnpm 10.26.2；Docker 镜像使用 Node 22。安装依赖：`corepack enable && corepack prepare pnpm@10.26.2 --activate`，然后 `pnpm install --frozen-lockfile`。
- 在服务器现有 PostgreSQL 中准备专用数据库及用户，容器必须能访问连接地址。迁移/导入账号须有建表、表锁、更新触发器状态及序列重置权限（通常使用该库对象所有者）。运行账号按需要单独限制权限。
- 运行时必需：`DATABASE_URL`、私有随机 `JWT_SECRET`。JWT 没有默认值，可用 `openssl rand -hex 32` 私下生成。运行时启动检查不允许缺失；构建不需要这些变量。
- 一次性导入额外必需：`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`。必须使用可读取全部源数据的服务端凭据，不能使用受 RLS 限制的匿名 key。旧 `NEXT_PUBLIC_SUPABASE_*` 和 `CJ_COOKIE` 不用于新服务部署。
- 在仓库外建立权限为 `0600` 的 `/secure/cj-spider.runtime.env`，仅放运行时变量；另建 `/secure/cj-spider.import.env`，放 `DATABASE_URL` 和两个一次性 Supabase 变量。示例路径需替换为实际安全目录。不要将源 key 放入 web 容器、构建参数或浏览器。
- 记录旧镜像固定标签/摘要、旧运行时配置、反代配置及旧数据库连接。保留可回退的旧服务，先用独立端口/反代 upstream 验收新服务。
- 冻结写入后制作 Supabase 全量数据库备份/快照及目标 PostgreSQL 备份，验证可恢复。备份包含密码哈希和会话等敏感数据，限制访问并加密存储，**全部存放在仓库外**；禁止提交 `.bak`、数据库导出或其他备份文件。

目标 PostgreSQL 备份示例（变量已通过安全进程环境提供，目录位于仓库外）：

```sh
pg_dump --format=custom --file=/secure/backups/cj-spider-before-import.dump "$DATABASE_URL"
```

数据库密码不应包含在命令历史中；不要将日志、备份或 env 文件粘贴到 PR。源端备份须覆盖全部在用表，不只是新闻。

## 2. 冻结源端及目标端写入

停止旧服务所有爬虫、定时任务及写 API，阻止用户登录和账号管理、导出记录写入；登录也会更新用户时间。目标新服务保持停止，暂停目标其他写入者。冻结持续至导入、数据比对和切流验收完成。

导入器通过 Supabase REST 分页读取，**没有跨请求事务快照**。它读取精确源行数，按递增主键取完所有页，并在读取后和目标提交前复查行数。此检查可以发现增删造成的数量变化，不能发现原地修改或“删除一行再新增一行”的等数量变化；行数一致也不证明字段内容一致。因此冻结不可省略，应另用源数据库快照/逐字段抽查验证。

导入器尝试 OpenAPI 表/列发现；不可用时会告警，运维必须手工盘点 public schema 和在用表。任何无法读取的表、列或未映射结构都需先核实，不能靠减少源端权限让检查通过。精确 count 只覆盖凭据实际可见的数据。

## 3. 建表与导入

先确认连接指向新专用库。迁移使用版本账本，可重复执行，不自动创建管理员，不自动导入数据。

已通过受控进程环境提供变量时，准确命令为：

```sh
pnpm db:migrate
node --conditions=react-server --import tsx scripts/import-supabase.ts
```

本地脚本不自动加载 `.env.local`。使用仓库外 env 文件的等价命令为：

```sh
node --env-file=/secure/cj-spider.runtime.env --conditions=react-server --import tsx scripts/migrate.ts
node --env-file=/secure/cj-spider.import.env --conditions=react-server --import tsx scripts/import-supabase.ts
```

导入范围：`news`、`site_users`、`crawl_sessions`、`export_history`，以及存在时的旧兼容表 `crawl_tasks`、`login_sessions`。后两表确认不存在时会告警并按空表处理，必须记录其确实未使用；权限失败不是表不存在。`auth_identities` 在目标按原用户创建 `local` 身份，不从源端导入其他提供方。若源端已有其他身份提供方或额外表/列，先扩展映射并复核再迁移。

导入保留主键、账号密码哈希、文章正文/HTML、JSON 元数据及时间字段；Supabase 无时区 timestamp 存储的是 UTC，导入时补 `Z`（日期值补 `T00:00:00Z`），带时区时保留原有时刻。仅爬虫抓到的原站无时区时间字符串按北京时间（`+08:00`）解析，不能将该规则用于 Supabase 数据导入。目标使用 timestamptz，展示及统计日期边界按北京时间核验。

数据在目标事务内按主键 upsert，核对各表行数和本地身份数量，并重置自增序列，可在同一冻结源上重跑。目标存在源端没有的 ID 或身份冲突时会拒绝执行；不会自动删掉它们。失败时数据事务回滚，排查配置/权限/结构并保留证据，不要默认清空或 DROP 库。成功输出每表 `source=N target=N`，保存脱敏结果供验收。

## 4. 用 Docker tools 执行

standalone runner 只用于 web，不含完整运维脚本。对同一审核版本显式构建两个目标，不传任何凭据：

```sh
docker build --target tools -t cj-spider-tools:phase1 .
docker build -t cj-spider:phase1 .
docker run --rm --env-file /secure/cj-spider.runtime.env cj-spider-tools:phase1 pnpm db:migrate
docker run --rm --env-file /secure/cj-spider.import.env cj-spider-tools:phase1 node --conditions=react-server --import tsx scripts/import-supabase.ts
```

tools 包含开发依赖（含 tsx）、`src/`、`db/`、`scripts/`。它的默认命令也是 `pnpm db:migrate`，只应由运维显式运行。若 PostgreSQL 仅在服务器 Docker 网络内可见，两条 `docker run` 都需加 `--network <实际数据库网络名>`，web Compose 也需接入该网络。不要把容器的 `localhost` 当成宿主机或其他 PostgreSQL 容器。

Docker 构建忽略所有 `.env` 和 `.env.*`（仅允许示例）、备份及本地依赖。完成导入后移除/撤销一次性源凭据及临时 env 文件，保留源备份和旧服务的受控回退能力；运行容器仅需要运行时变量。

## 5. 验收、切流与观察

在仍冻结写入的情况下，逐表核对源端独立查询结果、导入输出、目标实际行数；确认可选表状态、版本迁移账本、本地身份一人一条以及序列可继续插入。数据库查询中显式使用北京时间：

```sql
SET TIME ZONE 'Asia/Shanghai';
SELECT 'news' AS table_name, count(*) FROM news
UNION ALL SELECT 'site_users', count(*) FROM site_users
UNION ALL SELECT 'crawl_sessions', count(*) FROM crawl_sessions
UNION ALL SELECT 'export_history', count(*) FROM export_history
UNION ALL SELECT 'crawl_tasks', count(*) FROM crawl_tasks
UNION ALL SELECT 'login_sessions', count(*) FROM login_sessions
UNION ALL SELECT 'local_identities', count(*) FROM auth_identities WHERE provider = 'local';
```

完成以下人工验收并记录结果：

- 抽查最早、最新、跨北京时间午夜及空字段的新闻；比对 ID/source_id、标题、正文、纯文本、摘要、作者、来源、地区、分类、标签、阅读/分享量、图片/二维码/联系方式/关联链接、源 URL、raw_html、状态、错误信息及全部创建/更新/发布/爬取时间。不要只比较总行数。
- 检查全部用户的用户名、角色、启用状态、密码哈希保留和登录时间；用代表性的现有管理员/普通用户实际登录，禁用用户不能登录。没有默认密码；新库首次管理员须通过受控流程建立。JWT 变更可能使旧会话失效，用户需重新登录。
- 匿名调用爬取、管理、导出和统计等受保护 API 应拒绝访问；普通账号不能执行管理员操作。检查退出及登录状态。
- 比对爬取会话全部计数、页码、状态、开始/结束时间和阶段/速度，核对导出历史筛选条件、列、文件名、数量及时间；保留的旧表会话数据不保证重启后外部网站会话仍有效，需要时重新完成验证码登录。
- 对相同新闻筛选条件执行列表/详情预览与 Excel 导出，比对所有可选列、默认列、正文、中文内容、日期区间及数量；检查新闻导出历史和爬取历史导出。
- 检查统计总数、成功/待处理/失败数、当日/本周边界、爬取/发布趋势、地区/来源/作者分布、正文长度、图片及标签统计。特别检查 +08:00 午夜边界，避免时间整体偏移八小时。

验收完成后，显式启动新服务：

```sh
docker compose --env-file /secure/cj-spider.runtime.env config --quiet
docker compose --env-file /secure/cj-spider.runtime.env up -d --no-build cj-spider
docker compose --env-file /secure/cj-spider.runtime.env ps
curl --fail http://127.0.0.1:3000/api/health
```

如使用远端固定版本镜像，先将 `CJ_SPIDER_IMAGE` 设置为该标签并运行 `docker compose --env-file /secure/cj-spider.runtime.env pull cj-spider`。HTTP 健康检查只验证响应，不证明数据库可用，仍需登录和数据验收。生产运行时缺少 JWT_SECRET 或 DATABASE_URL 必须启动失败；镜像构建不依赖它们。

切换反代前完成上述只读/登录验收，登录会产生目标写入，此后不要直接重跑全量导入覆盖验收后的变化。切流后仅恢复新服务写入，旧服务维持只读/停止写入。受控地测试 CJ 验证码登录、采集一页、详情更新、去重、任务暂停/继续/重试、导出与账号管理，确认新增 ID/序列正常；观察日志及错误率数日，再决定退役旧服务与 Supabase。

工作流只支持手动触发，`deploy` 默认关闭；触发构建只推送版本号镜像、创建标签与 Release，不推送或覆盖 `latest`。部署前须将服务器 Compose 的镜像标签设为对应版本号。只有人工确认迁移及服务器配置后才允许显式部署。首次迁移不由 CI 自动执行。

## 6. 回滚

保留旧镜像、源 Supabase、旧配置和仓库外备份。在尚未恢复新写入前发现问题：停止新服务，反代切回保留的旧服务，在确认旧环境仍完整后恢复其写入；保留新库供排查。不要执行默认降级迁移、TRUNCATE、DROP、清空卷或删除源数据。

如果新服务已经写入，先再次冻结两端写入并备份新 PostgreSQL，盘点切流后新增新闻、账号变更、爬取/导出记录。制定和验证增量回灌/数据协调方案后再切回；旧服务不会自动读到新 PostgreSQL 的变化，单纯切换镜像可能丢失这段写入。恢复数据库备份须经明确审核，优先恢复到独立数据库检查，不覆盖唯一现存副本。回退应用版本也必须确认其表结构/数据库后端兼容。
