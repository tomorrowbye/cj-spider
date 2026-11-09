# CJ Spider

基于 Next.js 的安徽财经网新闻采集、管理与导出系统。第一阶段将数据存储迁到服务器 PostgreSQL，通过 Kysely + pg 在服务端访问；保留现有页面、功能与导出字段。

## 功能

- 站内账号登录、管理员用户管理与角色控制；身份表为后续登录提供方预留扩展。
- 安徽财经网验证码登录、会员已发布列表采集、正文解析、增量去重。
- 爬取任务控制、进度、失败重试、爬取历史与历史导出。
- 新闻标题、作者、地区、来源、分类、日期筛选，详情预览和可选列 Excel 导出。
- 导出历史、用户资料和统计大盘（概览、趋势、分布、正文分析）。

本阶段不重做 UI，不拆 worker，不新增微信登录或 MCP 接口。

## 本地开发

需要 Node.js **≥22**（Kysely 0.29 的引擎要求）、pnpm **10.26.2** 和可连接的 PostgreSQL。

```sh
corepack enable
corepack prepare pnpm@10.26.2 --activate
pnpm install --frozen-lockfile
cp .env.example .env.local
```

编辑 `.env.local`，设置专用数据库的 `DATABASE_URL` 和私有随机 `JWT_SECRET`（可用 `openssl rand -hex 32` 生成）。不提供默认密钥。Next.js 在启动时通过 instrumentation 校验这两个变量；缺失会启动失败。数据库凭据不使用 `NEXT_PUBLIC_*`，不进入浏览器包。

迁移脚本不会自动加载 Next.js 的 `.env.local`，需显式加载。以下命令使用 Node 的 env-file 支持，避免 shell 解析密码中的特殊字符：

```sh
node --env-file=.env.local --conditions=react-server --import tsx scripts/migrate.ts
pnpm dev
```

如果 `DATABASE_URL` 已由进程环境提供，建表命令为 `pnpm db:migrate`。打开 <http://localhost:3000>。历史迁移会保留原账号密码哈希；新库没有默认管理员或引导密码，首次管理员需由运维通过受控流程建立，不应复用公开密码。

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

`pnpm build` 不需要数据库、JWT 或 Supabase 凭据；`pnpm start` 需要运行时环境。`react-server` 条件只用于导入 server-only 模块的运维脚本/测试，不要全局配置给 Next.js。

## Docker

默认镜像是非 root 的 Next.js standalone 服务；独立 `tools` 目标保留源码、迁移和开发依赖供运维使用。Docker 构建排除所有 `.env` / `.env.*`（仅允许 `.env.example`），禁止通过构建参数注入凭据。

```sh
docker build -t cj-spider:phase1 .
docker build --target tools -t cj-spider-tools:phase1 .
# /secure/cj-spider.runtime.env 由运维在仓库外创建，仅含运行时配置。
docker run --rm --env-file /secure/cj-spider.runtime.env cj-spider-tools:phase1 pnpm db:migrate
docker compose --env-file /secure/cj-spider.runtime.env up -d --no-build cj-spider
```

Compose 使用服务器现有 PostgreSQL，不创建数据库容器。`DATABASE_URL` 的主机必须可从容器访问；若数据库仅在另一个 Compose 网络中，需要运维将服务接入相同外部网络。默认端口只绑定 `127.0.0.1:3000`；宿主机反代可访问，容器反代需配置共享网络或合适的绑定地址。生产用 `CJ_SPIDER_IMAGE` 指定固定版本标签并先拉取，避免无法追溯的 `latest`。

健康检查使用现有 `/api/auth/status`，只检查 HTTP 服务响应，不能代替数据库和登录验收。启动不会自动执行迁移或导入。

## 迁移与发布

完整步骤、一次性 Supabase 凭据、备份、验收与回滚见 [PostgreSQL 迁移手册](docs/POSTGRES_MIGRATION.md)。迁移前必须冻结源端和目标端写入。Supabase 仅为一次性导入来源，不是新服务运行依赖。

`.github/workflows/deploy.yml` 仅手动触发，不再传 Supabase 构建参数。`deploy` 输入默认 `false`：默认只构建/推送镜像并创建版本标签和 Release；只有明确勾选部署才运行现有 SSH 部署步骤。首次切流前，运维必须先更新服务器的 Compose 与运行时环境、执行迁移并完成验收；工作流不会替你迁移数据。不要在验收前触发部署。
