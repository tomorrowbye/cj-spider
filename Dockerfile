FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat \
    && corepack enable \
    && corepack prepare pnpm@10.26.2 --activate
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
# tsx and the other development dependencies are needed by the tools target.
RUN pnpm install --frozen-lockfile --prod=false

# Operator image: source, migrations, scripts and full dependencies; no secrets.
# Build explicitly with --target tools. It does not start the web application.
FROM base AS tools
COPY --from=deps /app/node_modules ./node_modules
COPY . .
CMD ["pnpm", "db:migrate"]

FROM tools AS builder
ENV NODE_ENV=production
# No DATABASE_URL, JWT_SECRET or source credentials are needed for the build.
RUN pnpm build

# Default target is the small Next.js standalone web image.
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TZ=Asia/Shanghai
RUN apk add --no-cache libc6-compat \
    && addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
