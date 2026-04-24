# NovelForge · 部署指南

> 本文档详细介绍如何将 NovelForge 部署到 Cloudflare Pages 生产环境。

---

## 📋 目录

- [前置准备](#前置准备)
- [本地开发环境搭建](#本地开发环境搭建)
- [首次部署](#首次部署)
- [持续部署 (CI/CD)](#持续部署-cicd)
- [环境变量配置](#环境变量配置)
- [数据库迁移](#数据库迁移)
- [故障排查](#故障排查)
- [性能优化](#性能优化)

---

## 前置准备

### 必需账号和服务

1. **Cloudflare 账号**
   - 注册：https://dash.cloudflare.com/sign-up
   - 免费版即可满足个人使用需求

2. **Git 仓库**（推荐 GitHub）
   - 创建仓库：https://github.com/new
   - 克隆仓库：`git clone https://github.com/your-username/novelforge.git`

3. **LLM API Key**（至少选择一个）
   - [火山引擎](https://console.volcengine.com/ark)（推荐，中文优化）
   - [Anthropic](https://console.anthropic.com/)
   - [OpenAI](https://platform.openai.com/)

### 系统要求

```bash
# Node.js 版本（v1.6.0+ 推荐 Node 20）
node -v  # >= 20.x

# 包管理器
pnpm -v  # >= 9.x (推荐)
# 或
npm -v   # >= 10.x

# Cloudflare CLI
wrangler -v  # >= 4.0
```

---

## 本地开发环境搭建

### Step 1: 克隆项目

```bash
git clone https://github.com/your-username/novelforge.git
cd novelforge
```

### Step 2: 安装依赖

```bash
pnpm install
```

### Step 3: 创建 Cloudflare 资源

```bash
# 登录 Cloudflare（如果尚未登录）
wrangler login

# 创建 D1 数据库
wrangler d1 create novelforge
# 输出示例：
# ✅ Successfully created DB 'novelforge'
# Created new D1 database with ID: abc123...

# 创建 R2 存储桶
wrangler r2 bucket create novelforge-storage
# 输出示例：
# ✅ Successfully created bucket 'novelforge-storage'
```

### Step 4: 配置 wrangler.toml

编辑 `wrangler.toml`，替换数据库 ID：

```toml
name = "novelforge"
main = "server/index.ts"
compatibility_date = "2026-01-01"
compatibility_flags = ["nodejs_compat"]

[observability]
[observability.logs]
enabled = true
invocation_logs = true

[assets]
directory = "dist"
binding = "ASSETS"
not_found_handling = "single-page-application"
run_worker_first = true

[[d1_databases]]
binding = "DB"
database_name = "novelforge"
database_id = "你的-database-id-这里"  # ← 替换为实际 ID

[[r2_buckets]]
binding = "STORAGE"
bucket_name = "novelforge-storage"

[ai]
binding = "AI"

[[vectorize]]
binding = "VECTORIZE"
index_name = "novelforge-index"

[[queues.producers]]
binding = "TASK_QUEUE"
queue = "novelforge-tasks"

[[queues.consumers]]
queue = "novelforge-tasks"
max_batch_size = 10
max_batch_timeout = 5
max_retries = 3
```

### Step 5: 设置本地环境变量

创建 `.dev.vars` 文件（**不要提交到 Git**）：

```bash
cat > .dev.vars << 'EOF'
VOLCENGINE_API_KEY=sk-your-volcengine-api-key
ANTHROPIC_API_KEY=sk-ant-your-key
OPENAI_API_KEY=sk-your-openai-key
EOF
```

⚠️ **重要**: 将 `.dev.vars` 添加到 `.gitignore`:

```bash
echo ".dev.vars" >> .gitignore
```

### Step 6: 初始化本地数据库

```bash
# 应用数据库迁移
wrangler d1 migrations apply novelforge --local

# 验证表是否创建成功
wrangler d1 execute novelforge --local --command \
  "SELECT name FROM sqlite_master WHERE type='table'"
```

预期输出应包含以下表：
- novels
- outlines
- chapters
- characters
- volumes
- model_configs

### Step 7: 启动开发服务器

```bash
# 方式 1: 使用 Wrangler（推荐，模拟完整环境）
wrangler pages dev --local -- pnpm dev

# 方式 2: 仅前端开发
pnpm dev

# 访问 http://localhost:8788
```

---

## 首次部署

### Step 1: 构建项目

```bash
pnpm build
```

构建成功后会生成 `dist/` 目录：

```
dist/
├── index.html
├── assets/
│   ├── index-*.css
│   └── index-*.js
```

### Step 2: 部署到生产环境

```bash
# 部署到 Production
wrangler pages deploy dist --branch main --project-name novelforge
```

部署成功后会获得一个 URL：

```
✨ Deployment complete!
Your site is now live at:
https://novelforge.pages.dev
```

### Step 3: 设置生产环境变量

```bash
# 设置 API Keys（加密存储，不会泄露）
wrangler secret put VOLCENGINE_API_KEY
# 输入后粘贴你的 Key

wrangler secret put ANTHROPIC_API_KEY
wrangler secret put OPENAI_API_KEY
```

### Step 4: 执行生产数据库迁移

```bash
# ⚠️ 警告：这会修改生产数据库！
wrangler d1 migrations apply novelforge --remote
```

### Step 5: 验证部署

```bash
# 健康检查
curl https://novelforge.pages.dev/api/health

# 预期响应
{"ok":true,"ts":1713571234567,"phase":3}
```

---

## 持续部署 (CI/CD)

### 方案 A: GitHub Actions（推荐）

创建 `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Cloudflare Pages

on:
  push:
    branches:
      - main
  pull_request:
    branches:
      - main

jobs:
  deploy:
    runs-on: ubuntu-latest
    name: Deploy
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install

      - name: Build
        run: pnpm build
        env:
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

      - name: Deploy to Cloudflare Pages
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          command: pages deploy dist --project-name novelforge

      - name: Run Database Migrations
        if: github.ref == 'refs/heads/main'
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          command: d1 migrations apply novelforge --remote
```

### 配置 GitHub Secrets

在 GitHub 仓库 Settings → Secrets and variables → Actions 中添加：

| Secret 名称 | 值 | 获取方式 |
|------------|-----|----------|
| `CLOUDFLARE_ACCOUNT_ID` | `xxxxxxxxxxxxxxxx` | Cloudflare Dashboard → 右侧边栏 |
| `CLOUDFLARE_API_TOKEN` | `xxxxxxxxxxxxxxxx` | [创建 API Token](https://dash.cloudflare.com/profile/api-tokens) |

### 创建 API Token

1. 访问 https://dash.cloudflare.com/profile/api-tokens
2. 点击 "Create Token"
3. 选择 "Edit Cloudflare Pages" 模板或自定义
4. 权限设置：
   - `Page Storage: Edit`
   - `D1: Edit`
   - `Account: Read`
5. 复制生成的 Token 存入 GitHub Secrets

### 方案 B: Cloudflare Pages Git 集成（最简单）

1. 访问 https://dash.cloudflare.com/pages
2. 点击 "Connect to Git"
3. 选择 GitHub 仓库
4. 配置构建设置：
   - **Build command**: `pnpm build`
   - **Build output directory**: `dist`
   - **Root directory**: `/`
5. 设置环境变量（在 Pages 控制台的 Settings → Environment variables）：
   - `NODE_VERSION`: `18`
6. 点击 "Save and Deploy"

⚠️ **注意**: Git 集成方式无法自动运行数据库迁移，需要手动执行或通过 Actions 补充。

---

## 环境变量配置

### 环境变量类型对比

| 类型 | 文件 | 用途 | 是否提交 |
|------|------|------|----------|
| 本地开发 | `.dev.vars` | Wrangler 本地模拟 | ❌ 否 |
| 生产 Secret | `wrangler secret` | 生产环境 API Key | ❌ 否 |
| 构建变量 | `wrangler.toml` / Dashboard | 构建时变量 | ✅ 可 |
| 前端变量 | `.env` | Vite 构建变量 | ❌ 否 |

### 本地开发变量 (.dev.vars)

```bash
# .dev.vars
VOLCENGINE_API_KEY=sk-xxx
ANTHROPIC_API_KEY=sk-ant-xxx
OPENAI_API_KEY=sk-xxx
```

### 生产环境变量（Secrets）

```bash
# 单个设置
wrangler secret put SECRET_NAME

# 批量设置（从文件）
cat .prod.vars | wrangler secret bulk
```

### 前端环境变量 (.env)

Vite 支持的前缀：
- `VITE_` - 暴露给客户端
- 其他 - 仅构建时使用

```bash
# .env
VITE_APP_NAME=NovelForge
API_BASE_URL=/api  # 使用相对路径，无需配置
```

---

## 数据库迁移

### 迁移文件结构

```
server/db/migrations/
├── 0010_schema.sql       # v4.0 整合迁移（合并所有历史迁移）
├── 0011_check_logs.sql   # v4.0 检查日志表
└── 0012_foreshadowing_progress.sql # v1.7.0 伏笔进度追踪表
```

> **v1.7.0 变更说明**：新增伏笔进度追踪功能，需要执行 `0012_foreshadowing_progress.sql` 迁移。

> **v4.0 变更说明**：从 v1.6.0 开始，数据库迁移已整合为 `0010_schema.sql`，使用触发器自动维护字数/章数统计。升级时请直接执行 `0010_schema.sql`。

### 创建新迁移

```bash
# 手动创建迁移文件
cat > server/db/migrations/000X_migration_name.sql << 'EOF'
-- 上一步骤的 SQL
ALTER TABLE novels ADD COLUMN cover_image TEXT;
EOF
```

### 应用迁移

```bash
# 本地
wrangler d1 migrations apply novelforge --local

# 生产
wrangler d1 migrations apply novelforge --remote

# 查看迁移历史
wrangler d1 migrations list novelforge --local
wrangler d1 migrations list novelforge --remote
```

### 回滚迁移（谨慎使用）

```bash
# 回滚最后一次迁移
wrangler d1 migrations rollback novelforge --local
```

---

## 故障排查

### 常见问题

#### 1. 构建失败：模块找不到

**错误**: `Could not resolve "./llm"`

**原因**: 导入路径错误或文件不存在

**解决**:
```bash
# 检查文件是否存在
ls server/services/llm.ts

# 检查导入路径
grep -r "from './llm'" server/
```

#### 2. 本地数据库连接失败

**错误**: `D1_DATABASE_NOT_FOUND`

**解决**:
```bash
# 重新创建数据库
wrangler d1 create novelforge

# 检查 wrangler.toml 中的 database_id 是否正确
cat wrangler.toml | grep database_id
```

#### 3. AI 模型调用失败

**错误**: `Workers AI binding not configured`

**解决**:
```bash
# 检查 wrangler.toml 是否有 [ai] 配置
cat wrangler.toml | grep -A 2 "\[ai\]"

# 确保 compatibility_flags 包含 nodejs_compat
```

#### 4. R2 上传失败

**错误**: `R2 storage binding not configured`

**解决**:
```bash
# 检查 R2 绑定
wrangler r2 bucket list

# 检查 wrangler.toml
cat wrangler.toml | grep -A 3 "\[\[r2_buckets\]\]"
```

#### 5. 生产环境 API Key 未生效

**症状**: 本地正常，生产报错 "API key required"

**解决**:
```bash
# 检查 Secret 是否设置
wrangler secret list

# 重新设置
wrangler secret put VOLCENGINE_API_KEY
```

### 日志查看

```bash
# 查看 Functions 日志（本地）
wrangler pages dev --local -- pnpm dev 2>&1 | tee local.log

# 查看生产日志（需要 Pro 计划）
# 访问：https://dash.cloudflare.com/pages/{project}/functions/logs
```

### 调试技巧

```typescript
// 在代码中添加详细日志
console.log('Debug:', {
  env: Object.keys(c.env),
  config: llmConfig,
  messages: messages.length
})

// 捕获所有未处理的 Promise rejection
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
})
```

---

## 性能优化

### 1. 启用 CDN 缓存

```typescript
// 静态资源缓存头
app.use('*', async (c, next) => {
  await next()
  if (c.req.path.startsWith('/assets/')) {
    c.header('Cache-Control', 'public, max-age=31536000, immutable')
  }
})
```

### 2. 压缩响应

```typescript
// Hono 内置压缩中间件
import { compress } from 'hono/compress'
app.use(compress())
```

### 3. 数据库索引

```sql
-- 添加常用查询的索引
CREATE INDEX idx_chapters_novelId ON chapters(novel_id);
CREATE INDEX idx_outlines_novelId ON outlines(novel_id);
CREATE INDEX idx_characters_novelId ON characters(novel_id);
CREATE INDEX idx_model_configs_scope_stage ON model_configs(scope, stage);
```

### 4. 前端代码分割

```typescript
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'ui-components': ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu'],
        }
      }
    }
  }
})
```

### 5. 图片优化

```html
<!-- 使用现代格式 -->
<img src="character.webp" loading="lazy" />

<!-- 响应式图片 -->
<picture>
  <source srcset="character.avif" type="image/avif">
  <source srcset="character.webp" type="image/webp">
  <img src="character.jpg" alt="角色名">
</picture>
```

---

## 监控与告警

### Cloudflare 仪表盘

访问 https://dash.cloudflare.com/pages/{project}/analytics

关键指标：
- **请求数**: 每日访问量
- **带宽使用**: 流量消耗
- **边缘缓存命中率**: CDN 效率
- **函数执行时间**: API 响应速度

### 错误追踪

集成 Sentry：

```bash
pnpm add @sentry/react
```

```typescript
// src/main.tsx
import * as Sentry from "@sentry/react"

Sentry.init({
  dsn: "https://your-dsn@sentry.io/project-id",
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration(),
  ],
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
});
```

---

## 备份策略

### 数据库备份

```bash
# 导出 D1 数据
wrangler d1 export novelforge --output backup.sql --remote

# 定时任务（cron）
# 添加到 crontab: 0 2 * * * (每天凌晨 2 点)
```

### R2 备份

```bash
# 使用 rclone 同步到其他地方
rclone sync r2:novelforge-storage s3:backup-bucket/novelforge
```

---

## 成本估算

### 免费额度（足够个人使用）

| 服务 | 免费配额 | 预估使用 |
|------|---------|----------|
| Pages 请求 | 100,000/日 | ~10,000/日 |
| D1 读取 | 1,000,000/日 | ~50,000/日 |
| D1 写入 | 100,000/日 | ~5,000/日 |
| R2 存储 | 10 GB | ~1 GB |
| Vectorize | 1,000 索引 | ~200 索引 |
| Workers AI | 100,000 秒/日 | ~1,000 秒/日 |

### 超出后的费用

| 服务 | 单价 |
|------|------|
| Pages 额外请求 | $0.30 / 10,000 |
| D1 额外读取 | $0.30 / 1,000,000 |
| R2 额外存储 | $0.015 / GB/月 |

**预计月成本**: $0 - $5（取决于使用量）

---

## 升级路径

### 从旧版本升级

```bash
# 1. 拉取最新代码
git pull origin main

# 2. 更新依赖
pnpm update

# 3. 运行新迁移（v1.6.0 使用整合迁移）
wrangler d1 migrations apply novelforge --remote

# 4. 创建/更新 Vectorize 索引（v4.0 维度为 1024）
# 如果索引已存在，跳过此步骤
wrangler vectorize create novelforge-index --dimensions=1024 --metric=cosine

# 5. 创建 Queue（v1.6.0 新增）
wrangler queues create novelforge-tasks

# 6. 重新部署
pnpm build
wrangler pages deploy dist
```

**v1.6.0 升级注意事项**：
- Node.js 版本需要 >= 20
- Wrangler 版本需要 >= 4.0
- 数据库迁移已整合，直接执行 `0010_schema.sql`
- 向量索引维度从 768 升级到 1024（如果重建索引）

**v1.7.0 升级注意事项**：
- 执行 `0012_foreshadowing_progress.sql` 迁移以支持伏笔进度追踪
- 如果使用_wrangler queues，确保队列消费者配置正确

### 版本兼容性

| 版本 | Node.js | Wrangler | Drizzle |
|------|---------|----------|---------|
| v1.7+ | >= 20 | >= 4.0 | >= 0.45 |
| v1.6+ | >= 20 | >= 4.0 | >= 0.45 |
| v1.5+ | >= 18 | >= 3.0 | >= 0.45 |
| v1.4+ | >= 18 | >= 3.0 | >= 0.45 |
| v1.3+ | >= 18 | >= 3.0 | >= 0.40 |
| v1.0+ | >= 18 | >= 3.0 | >= 0.30 |

### 重要变更说明 (v1.7.0)

- **伏笔进度追踪**：新增 `foreshadowing_progress` 表
- **工坊导入增强**：新增格式化工坊导入路由和服务
- **Agent服务优化**：多个服务模块代码优化
- **数据库查询优化**：提升API响应速度

### 重要变更说明 (v1.6.0)

- **上下文构建 v4.0**：RAG 架构优化，Token 预算从 14k 提升至 55k
- **向量索引精简**：从 6 种类型减少到 3 种（character/setting/foreshadowing）
- **新增 Queue 配置**：支持后台异步任务处理
- **Agent 系统模块化**：拆分为 14 个子模块
- **新增 Queue Handler**：异步处理索引重建等耗时任务

### 重要变更说明 (v1.4.0)

- 数据库 Schema 重构为扁平化结构
- 原 `outlines` 表被 `master_outline` 和 `novel_settings` 替代
- 新增 `foreshadowing`、`writing_rules`、`vector_index`、`entity_index` 等表
- 需要 Vectorize 索引支持

---

## 附录

### A. 完整的环境变量清单

```bash
# .dev.vars (本地)
VOLCENGINE_API_KEY=xxx
ANTHROPIC_API_KEY=xxx
OPENAI_API_KEY=xxx

# wrangler.toml (绑定)
[[d1_databases]]
binding = "DB"
database_name = "novelforge"
database_id = "xxx"

[[r2_buckets]]
binding = "STORAGE"
bucket_name = "novelforge-storage"

[ai]
binding = "AI"

[[vectorize]]
binding = "VECTORIZE"
index_name = "novelforge-index"

[[queues.producers]]
binding = "TASK_QUEUE"
queue = "novelforge-tasks"

[[queues.consumers]]
queue = "novelforge-tasks"
max_batch_size = 10
max_batch_timeout = 5
max_retries = 3

# .env (前端)
VITE_APP_NAME=NovelForge
```

### B. 常用命令速查

```bash
# 开发
pnpm dev                          # 仅前端
wrangler pages dev --local -- pnpm dev  # 全栈

# 构建
pnpm build                        # 生产构建

# 数据库
wrangler d1 migrations apply novelforge --local
wrangler d1 migrations apply novelforge --remote

# Vectorize
wrangler vectorize create novelforge-index --dimensions=768 --metric=cosine
wrangler vectorize list

# 部署
wrangler pages deploy dist

# 调试
wrangler tail                     # 实时日志
wrangler secret list              # 查看 Secrets
```

### C. 资源链接

- [Cloudflare Docs](https://developers.cloudflare.com/)
- [Hono Docs](https://hono.dev/)
- [Drizzle Docs](https://orm.drizzle.team/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/commands/)
- [Vectorize Docs](https://developers.cloudflare.com/vectorize/)

---

<div align="center">

**Happy Deploying! 🚀**

</div>
