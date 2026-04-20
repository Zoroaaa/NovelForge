# NovelForge · Phase 1 开发大纲 v2
# （Cloudflare Pages + Functions 单包方案）

> 一个仓库、一条命令、一次部署。
> 目标：从零到本地可跑、线上可访问的小说管理 + 基础生成原型

---

## 技术选型

### 前端
| 类别 | 选型 |
|------|------|
| 框架 | React 18 + TypeScript |
| 构建 | Vite 5 |
| 路由 | React Router v6 |
| 状态 | Zustand |
| 服务端状态 | TanStack Query v5 |
| UI 组件库 | shadcn/ui（Radix 底层）|
| CSS | Tailwind CSS v3 |
| 编辑器 | Novel.js（Tiptap 封装）|
| 图标 | Lucide React |
| 表单 | React Hook Form + Zod |
| Markdown 渲染 | react-markdown + remark-gfm |
| 拖拽排序 | @dnd-kit/core + @dnd-kit/sortable |

### 后端（Pages Functions）
| 类别 | 选型 |
|------|------|
| 运行时 | Cloudflare Pages Functions |
| 框架 | Hono v4（`hono/cloudflare-pages` 适配器）|
| ORM | Drizzle ORM（D1 适配）|
| 验证 | Zod + @hono/zod-validator |

### 基础设施
| 类别 | 选型 |
|------|------|
| 部署 | Cloudflare Pages（静态 + Functions 一体）|
| 数据库 | D1（SQLite）|
| 文件存储 | R2 |
| 本地开发 | `wrangler pages dev`（单命令全栈）|
| 包管理 | pnpm（单包，无 monorepo）|

---

## 项目结构

```
novelforge/
├── src/                              # React 前端
│   ├── components/
│   │   ├── ui/                       # shadcn 自动生成
│   │   ├── layout/
│   │   │   ├── AppLayout.tsx         # 三栏主布局
│   │   │   └── Sidebar.tsx           # 左侧导航
│   │   ├── novel/
│   │   │   ├── NovelCard.tsx
│   │   │   └── CreateNovelDialog.tsx
│   │   ├── outline/
│   │   │   ├── OutlineTree.tsx
│   │   │   └── OutlineEditor.tsx
│   │   ├── chapter/
│   │   │   ├── ChapterList.tsx
│   │   │   ├── ChapterEditor.tsx     # Novel.js 封装
│   │   │   └── ChapterReader.tsx
│   │   ├── generate/
│   │   │   ├── GeneratePanel.tsx
│   │   │   └── StreamOutput.tsx
│   │   └── settings/
│   │       └── ModelConfig.tsx
│   ├── pages/
│   │   ├── NovelsPage.tsx            # /novels
│   │   ├── WorkspacePage.tsx         # /novels/:id
│   │   └── ReaderPage.tsx            # /novels/:id/read
│   ├── store/
│   │   ├── novelStore.ts
│   │   └── readerStore.ts
│   ├── hooks/
│   │   ├── useGenerate.ts            # SSE hook
│   │   └── useAutoSave.ts
│   ├── lib/
│   │   ├── api.ts                    # fetch 封装（相对路径，同域无跨域）
│   │   └── types.ts
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
│
├── functions/                        # Pages Functions = 后端
│   └── api/
│       └── [[route]].ts              # 通配符，接管所有 /api/* 请求
│
├── server/                           # 后端逻辑（被 functions 引用）
│   ├── index.ts                      # Hono app 定义
│   ├── routes/
│   │   ├── novels.ts
│   │   ├── outlines.ts
│   │   ├── chapters.ts
│   │   ├── volumes.ts
│   │   ├── characters.ts
│   │   ├── generate.ts
│   │   ├── export.ts
│   │   └── settings.ts
│   ├── db/
│   │   ├── schema.ts                 # Drizzle schema
│   │   └── migrations/
│   │       └── 0001_init.sql
│   ├── services/
│   │   ├── llm.ts                    # LLM 统一调用层
│   │   └── storage.ts                # R2 操作封装
│   └── lib/
│       └── utils.ts
│
├── public/                           # 静态资源
├── index.html
├── vite.config.ts
├── tailwind.config.js
├── tsconfig.json
├── wrangler.toml
└── package.json
```

---

## Step 0 · 环境初始化

**耗时：0.5 天**

### 0.1 安装工具

```bash
# Node.js >= 18
node -v

# 安装 pnpm 和 wrangler
npm i -g pnpm wrangler

# 登录 Cloudflare
wrangler login
```

### 0.2 创建项目

```bash
# 用 Vite 初始化
pnpm create vite novelforge --template react-ts
cd novelforge

# 安装前端依赖
pnpm add react-router-dom
pnpm add @tanstack/react-query
pnpm add zustand
pnpm add react-hook-form @hookform/resolvers zod
pnpm add lucide-react
pnpm add novel
pnpm add react-markdown remark-gfm
pnpm add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities

# 安装后端依赖
pnpm add hono drizzle-orm
pnpm add @hono/zod-validator

# 安装开发依赖
pnpm add -D @cloudflare/workers-types wrangler
pnpm add -D tailwindcss postcss autoprefixer
pnpm add -D tailwindcss-animate
pnpm add -D drizzle-kit

# 初始化 Tailwind
npx tailwindcss init -p

# 初始化 shadcn（交互式：选 Default style、Slate、CSS variables、Yes to all）
pnpm dlx shadcn@latest init

# 安装 shadcn 组件
pnpm dlx shadcn@latest add button input textarea dialog sheet
pnpm dlx shadcn@latest add card badge select tabs tooltip separator
pnpm dlx shadcn@latest add dropdown-menu scroll-area form label
pnpm dlx shadcn@latest add sonner skeleton
```

### 0.3 创建 D1 数据库和 R2 存储桶

```bash
# 创建 D1 数据库（复制输出的 database_id）
wrangler d1 create novelforge

# 创建 R2 存储桶
wrangler r2 bucket create novelforge-storage
```

### 0.4 配置 wrangler.toml

```toml
# wrangler.toml
name = "novelforge"
pages_build_output_dir = "dist"
compatibility_date = "2025-04-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "novelforge"
database_id = "替换为你的-database-id"

[[r2_buckets]]
binding = "STORAGE"
bucket_name = "novelforge-storage"
preview_bucket_name = "novelforge-storage-dev"

[ai]
binding = "AI"
```

### 0.5 配置 TypeScript

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] },
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src", "server", "functions"]
}
```

### 0.6 配置 Vite

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
```

### 0.7 配置 Tailwind

```javascript
// tailwind.config.js
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter Variable', 'sans-serif'],
        serif: ['"Noto Serif SC"', 'serif'],  // 阅读器用
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}
```

### 0.8 本地开发命令

```bash
# 全栈单命令启动（静态文件 + Functions + D1/R2 本地模拟）
wrangler pages dev --local -- pnpm vite

# 访问 http://localhost:8788
```

> `wrangler pages dev -- pnpm vite` 的意思是：
> wrangler 代理前端 vite dev server，同时提供 /api/* 的 Functions 路由和 D1/R2 本地模拟。
> 前端请求 `/api/...` 直接命中 Functions，无跨域，无端口区分。

---

## Step 1 · D1 Schema 和迁移

**耗时：0.5 天**

### 1.1 创建迁移文件

```bash
mkdir -p server/db/migrations
```

将之前的 `novelforge-schema.sql` 内容放入：

```bash
cp novelforge-schema.sql server/db/migrations/0001_init.sql
```

### 1.2 执行本地迁移

```bash
# 本地
wrangler d1 migrations apply novelforge --local

# 验证
wrangler d1 execute novelforge --local --command "SELECT name FROM sqlite_master WHERE type='table'"
# 应该看到 9 张表
```

### 1.3 Drizzle Schema（`server/db/schema.ts`）

```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

const id = () =>
  text('id').primaryKey().$defaultFn(() => crypto.randomUUID().slice(0, 16))
const timestamps = {
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at').notNull().default(sql`(unixepoch())`),
}

export const novels = sqliteTable('novels', {
  id: id(),
  title: text('title').notNull(),
  description: text('description'),
  genre: text('genre'),
  status: text('status').notNull().default('draft'),
  coverR2Key: text('cover_r2_key'),
  wordCount: integer('word_count').notNull().default(0),
  chapterCount: integer('chapter_count').notNull().default(0),
  ...timestamps,
  deletedAt: integer('deleted_at'),
})

export const outlines = sqliteTable('outlines', {
  id: id(),
  novelId: text('novel_id').notNull(),
  parentId: text('parent_id'),
  type: text('type').notNull(), // world_setting | volume | chapter_outline | custom
  title: text('title').notNull(),
  content: text('content'),
  sortOrder: integer('sort_order').notNull().default(0),
  vectorId: text('vector_id'),
  indexedAt: integer('indexed_at'),
  ...timestamps,
  deletedAt: integer('deleted_at'),
})

export const volumes = sqliteTable('volumes', {
  id: id(),
  novelId: text('novel_id').notNull(),
  outlineId: text('outline_id'),
  title: text('title').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  summary: text('summary'),
  wordCount: integer('word_count').notNull().default(0),
  status: text('status').notNull().default('draft'),
  ...timestamps,
})

export const chapters = sqliteTable('chapters', {
  id: id(),
  novelId: text('novel_id').notNull(),
  volumeId: text('volume_id'),
  outlineId: text('outline_id'),
  title: text('title').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  content: text('content'),
  wordCount: integer('word_count').notNull().default(0),
  status: text('status').notNull().default('draft'),
  modelUsed: text('model_used'),
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  generationTime: integer('generation_time'),
  summary: text('summary'),
  summaryAt: integer('summary_at'),
  vectorId: text('vector_id'),
  indexedAt: integer('indexed_at'),
  ...timestamps,
  deletedAt: integer('deleted_at'),
})

export const characters = sqliteTable('characters', {
  id: id(),
  novelId: text('novel_id').notNull(),
  name: text('name').notNull(),
  aliases: text('aliases'),      // JSON string[]
  role: text('role'),
  description: text('description'),
  imageR2Key: text('image_r2_key'),
  attributes: text('attributes'), // JSON object
  vectorId: text('vector_id'),
  ...timestamps,
  deletedAt: integer('deleted_at'),
})

export const modelConfigs = sqliteTable('model_configs', {
  id: id(),
  novelId: text('novel_id'),     // null = 全局
  scope: text('scope').notNull().default('global'),
  stage: text('stage').notNull(), // outline_gen | chapter_gen | summary_gen | vision
  provider: text('provider').notNull(),
  modelId: text('model_id').notNull(),
  apiBase: text('api_base'),
  apiKeyEnv: text('api_key_env'), // 存 secret 名称，不存明文
  params: text('params'),         // JSON { temperature, max_tokens }
  isActive: integer('is_active').notNull().default(1),
  ...timestamps,
})
```

---

## Step 2 · Hono 后端路由

**耗时：1.5 天**

### 2.1 Env 类型定义

```typescript
// server/lib/types.ts
export type Env = {
  DB: D1Database
  STORAGE: R2Bucket
  AI: Ai
  // Secrets（wrangler secret put 设置）
  VOLCENGINE_API_KEY: string
  ANTHROPIC_API_KEY: string
  OPENAI_API_KEY: string
}
```

### 2.2 Hono App 入口

```typescript
// server/index.ts
import { Hono } from 'hono'
import type { Env } from './lib/types'
import { novels } from './routes/novels'
import { outlines } from './routes/outlines'
import { volumes } from './routes/volumes'
import { chapters } from './routes/chapters'
import { characters } from './routes/characters'
import { generate } from './routes/generate'
import { settings } from './routes/settings'

export const app = new Hono<{ Bindings: Env }>().basePath('/api')

app.route('/novels', novels)
app.route('/outlines', outlines)
app.route('/volumes', volumes)
app.route('/chapters', chapters)
app.route('/characters', characters)
app.route('/generate', generate)
app.route('/settings', settings)

app.get('/health', (c) => c.json({ ok: true, ts: Date.now() }))
```

### 2.3 Pages Functions 入口（唯一的胶水文件）

```typescript
// functions/api/[[route]].ts
import { handle } from 'hono/cloudflare-pages'
import { app } from '../../server/index'

export const onRequest = handle(app)
```

> 这是 functions 目录下唯一需要的文件。所有业务逻辑写在 server/ 里，functions 只做转接。

### 2.4 通用路由模式（以 novels 为例）

```typescript
// server/routes/novels.ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { drizzle } from 'drizzle-orm/d1'
import { novels as t } from '../db/schema'
import { eq, isNull, desc, sql } from 'drizzle-orm'
import type { Env } from '../lib/types'

const router = new Hono<{ Bindings: Env }>()

const CreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  genre: z.string().optional(),
})

// 列表
router.get('/', async (c) => {
  const db = drizzle(c.env.DB)
  const rows = await db.select().from(t)
    .where(isNull(t.deletedAt))
    .orderBy(desc(t.updatedAt))
  return c.json(rows)
})

// 详情
router.get('/:id', async (c) => {
  const db = drizzle(c.env.DB)
  const row = await db.select().from(t).where(eq(t.id, c.req.param('id'))).get()
  if (!row || row.deletedAt) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

// 创建
router.post('/', zValidator('json', CreateSchema), async (c) => {
  const db = drizzle(c.env.DB)
  const [row] = await db.insert(t).values(c.req.valid('json')).returning()
  return c.json(row, 201)
})

// 更新
router.patch('/:id', zValidator('json', CreateSchema.partial()), async (c) => {
  const db = drizzle(c.env.DB)
  const [row] = await db.update(t)
    .set({ ...c.req.valid('json'), updatedAt: sql`(unixepoch())` })
    .where(eq(t.id, c.req.param('id')))
    .returning()
  return c.json(row)
})

// 软删除
router.delete('/:id', async (c) => {
  const db = drizzle(c.env.DB)
  await db.update(t)
    .set({ deletedAt: sql`(unixepoch())` })
    .where(eq(t.id, c.req.param('id')))
  return c.json({ ok: true })
})

export { router as novels }
```

> `outlines`、`chapters`、`volumes`、`characters` 路由结构完全一样，替换表名和 Schema 即可。

### 2.5 outlines 路由额外接口（树形排序）

```typescript
// 批量更新排序（拖拽后调用）
router.patch('/sort', zValidator('json', z.array(z.object({
  id: z.string(),
  sortOrder: z.number(),
  parentId: z.string().nullable().optional(),
}))), async (c) => {
  const db = drizzle(c.env.DB)
  const items = c.req.valid('json')
  await Promise.all(items.map(item =>
    db.update(outlines).set({
      sortOrder: item.sortOrder,
      ...(item.parentId !== undefined ? { parentId: item.parentId } : {}),
    }).where(eq(outlines.id, item.id))
  ))
  return c.json({ ok: true })
})

// 查询某小说的所有大纲（带 novelId 过滤）
router.get('/', async (c) => {
  const novelId = c.req.query('novelId')
  if (!novelId) return c.json({ error: 'novelId required' }, 400)
  const db = drizzle(c.env.DB)
  const rows = await db.select().from(outlines)
    .where(and(eq(outlines.novelId, novelId), isNull(outlines.deletedAt)))
    .orderBy(outlines.sortOrder)
  return c.json(rows)
})
```

### 2.6 验证后端是否正常

```bash
wrangler pages dev --local -- pnpm vite

# 新开终端测试
curl http://localhost:8788/api/health
# {"ok":true,"ts":1234567890}

curl -X POST http://localhost:8788/api/novels \
  -H "Content-Type: application/json" \
  -d '{"title":"混沌元尊","genre":"玄幻"}'
# {"id":"abc123...","title":"混沌元尊",...}

curl http://localhost:8788/api/novels
# [{"id":"abc123...",...}]
```

---

## Step 3 · 前端基础配置

**耗时：0.5 天**

### 3.1 API 客户端（同域，无 BASE_URL）

```typescript
// src/lib/api.ts
// 同域部署，路径直接用相对路径
async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((err as any).error ?? res.statusText)
  }
  return res.json()
}

const j = (body: unknown) => JSON.stringify(body)

export const api = {
  novels: {
    list:   ()                    => req<Novel[]>('/api/novels'),
    get:    (id: string)          => req<Novel>(`/api/novels/${id}`),
    create: (body: NovelInput)    => req<Novel>('/api/novels', { method: 'POST', body: j(body) }),
    update: (id: string, body: Partial<NovelInput>) =>
                                     req<Novel>(`/api/novels/${id}`, { method: 'PATCH', body: j(body) }),
    delete: (id: string)          => req(`/api/novels/${id}`, { method: 'DELETE' }),
  },
  outlines: {
    list:   (novelId: string)     => req<Outline[]>(`/api/outlines?novelId=${novelId}`),
    create: (body: OutlineInput)  => req<Outline>('/api/outlines', { method: 'POST', body: j(body) }),
    update: (id: string, body: Partial<OutlineInput>) =>
                                     req<Outline>(`/api/outlines/${id}`, { method: 'PATCH', body: j(body) }),
    sort:   (items: SortItem[])   => req('/api/outlines/sort', { method: 'PATCH', body: j(items) }),
    delete: (id: string)          => req(`/api/outlines/${id}`, { method: 'DELETE' }),
  },
  chapters: {
    list:   (novelId: string)     => req<Chapter[]>(`/api/chapters?novelId=${novelId}`),
    get:    (id: string)          => req<Chapter>(`/api/chapters/${id}`),
    create: (body: ChapterInput)  => req<Chapter>('/api/chapters', { method: 'POST', body: j(body) }),
    update: (id: string, body: Partial<ChapterInput>) =>
                                     req<Chapter>(`/api/chapters/${id}`, { method: 'PATCH', body: j(body) }),
  },
  volumes: {
    list:   (novelId: string)     => req<Volume[]>(`/api/volumes?novelId=${novelId}`),
    create: (body: VolumeInput)   => req<Volume>('/api/volumes', { method: 'POST', body: j(body) }),
    update: (id: string, body: Partial<VolumeInput>) =>
                                     req<Volume>(`/api/volumes/${id}`, { method: 'PATCH', body: j(body) }),
  },
}

// SSE 流式生成
export function streamGenerate(
  payload: { chapterId: string; novelId: string },
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (e: Error) => void,
): () => void {
  const ctrl = new AbortController()
  ;(async () => {
    try {
      const res = await fetch('/api/generate/chapter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: j(payload),
        signal: ctrl.signal,
      })
      const reader = res.body!.getReader()
      const dec = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) { onDone(); return }
        for (const line of dec.decode(value).split('\n')) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]')
            onChunk(line.slice(6))
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') onError(e as Error)
    }
  })()
  return () => ctrl.abort()
}
```

### 3.2 共享类型（`src/lib/types.ts`）

```typescript
export interface Novel {
  id: string
  title: string
  description: string | null
  genre: string | null
  status: 'draft' | 'writing' | 'completed' | 'archived'
  wordCount: number
  chapterCount: number
  createdAt: number
  updatedAt: number
}

export interface Outline {
  id: string
  novelId: string
  parentId: string | null
  type: 'world_setting' | 'volume' | 'chapter_outline' | 'custom'
  title: string
  content: string | null
  sortOrder: number
}

export interface Volume {
  id: string
  novelId: string
  title: string
  sortOrder: number
  wordCount: number
  status: string
  summary: string | null
}

export interface Chapter {
  id: string
  novelId: string
  volumeId: string | null
  outlineId: string | null
  title: string
  sortOrder: number
  content: string | null
  wordCount: number
  status: 'draft' | 'generated' | 'revised'
  summary: string | null
}

// Input types（省略 id/timestamps）
export type NovelInput = Pick<Novel, 'title'> & Partial<Pick<Novel, 'description' | 'genre'>>
export type OutlineInput = Omit<Outline, 'id' | 'sortOrder'> & { sortOrder?: number }
export type VolumeInput = Omit<Volume, 'id' | 'wordCount' | 'status' | 'summary'>
export type ChapterInput = Omit<Chapter, 'id' | 'wordCount' | 'status' | 'summary'>
export type SortItem = { id: string; sortOrder: number; parentId?: string | null }
```

### 3.3 React Router 配置

```typescript
// src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from '@/components/ui/sonner'
import NovelsPage from '@/pages/NovelsPage'
import WorkspacePage from '@/pages/WorkspacePage'
import ReaderPage from '@/pages/ReaderPage'

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 1000 * 30 } },
})

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/novels" replace />} />
          <Route path="/novels" element={<NovelsPage />} />
          <Route path="/novels/:id" element={<WorkspacePage />} />
          <Route path="/novels/:id/read/:chapterId?" element={<ReaderPage />} />
        </Routes>
      </BrowserRouter>
      <Toaster richColors />
    </QueryClientProvider>
  )
}
```

---

## Step 4 · 小说列表页

**耗时：1 天**

### 4.1 页面结构

```
NovelsPage
├── Header
│   ├── 标题"我的小说"
│   └── 新建小说按钮
├── NovelGrid（网格布局）
│   └── NovelCard × N
│       ├── 封面色块（按 genre 取色）
│       ├── 标题 + 类型 Badge
│       ├── 字数 / 章节数 / 最后更新
│       └── DropdownMenu（进入工作台 / 编辑 / 删除）
└── CreateNovelDialog
    ├── 标题（必填）
    ├── 类型 Select（玄幻/仙侠/都市/科幻/其他）
    └── 简介 Textarea（选填）
```

### 4.2 TanStack Query 用法

```typescript
// 查询
const { data: novels, isLoading } = useQuery({
  queryKey: ['novels'],
  queryFn: api.novels.list,
})

// 创建（mutation 成功后自动刷新列表）
const queryClient = useQueryClient()
const createMutation = useMutation({
  mutationFn: api.novels.create,
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['novels'] })
    toast.success('小说已创建')
  },
})
```

### 4.3 Zustand Store

```typescript
// src/store/novelStore.ts
import { create } from 'zustand'

interface NovelStore {
  activeNovelId: string | null
  activeChapterId: string | null
  sidebarTab: 'outline' | 'chapters' | 'characters'
  setActiveNovel: (id: string) => void
  setActiveChapter: (id: string | null) => void
  setSidebarTab: (tab: NovelStore['sidebarTab']) => void
}

export const useNovelStore = create<NovelStore>((set) => ({
  activeNovelId: null,
  activeChapterId: null,
  sidebarTab: 'outline',
  setActiveNovel: (id) => set({ activeNovelId: id }),
  setActiveChapter: (id) => set({ activeChapterId: id }),
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
}))
```

---

## Step 5 · 工作台主界面

**耗时：2 天**

### 5.1 三栏布局

```typescript
// src/components/layout/AppLayout.tsx
// 左侧 260px 固定 | 中央 flex-1 | 右侧 320px（可折叠）

export function AppLayout({ left, center, right }: {
  left: React.ReactNode
  center: React.ReactNode
  right?: React.ReactNode
}) {
  const [rightOpen, setRightOpen] = useState(true)
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* 左侧导航 */}
      <aside className="w-64 shrink-0 border-r overflow-y-auto">
        {left}
      </aside>
      {/* 中央编辑区 */}
      <main className="flex-1 overflow-y-auto">
        {center}
      </main>
      {/* 右侧 AI 面板（可折叠）*/}
      {rightOpen && (
        <aside className="w-80 shrink-0 border-l overflow-y-auto">
          {right}
        </aside>
      )}
    </div>
  )
}
```

### 5.2 左侧面板 — Tab 切换

```
Sidebar
├── Tabs（大纲 / 章节 / 角色）
├── Tab: 大纲
│   └── OutlineTree（树形，可折叠，可拖拽）
├── Tab: 章节
│   └── ChapterList（按卷分组）
└── Tab: 角色
    └── CharacterList（后续完善）
```

### 5.3 大纲树实现要点

```typescript
// src/components/outline/OutlineTree.tsx
// 树形展示，用 @dnd-kit/sortable 支持拖拽排序

// 扁平数组转树形（后端返回扁平，前端转换）
function buildTree(flat: Outline[]): OutlineNode[] {
  const map = new Map(flat.map(o => [o.id, { ...o, children: [] as OutlineNode[] }]))
  const roots: OutlineNode[] = []
  for (const node of map.values()) {
    if (node.parentId) map.get(node.parentId)?.children.push(node)
    else roots.push(node)
  }
  const sort = (arr: OutlineNode[]) => {
    arr.sort((a, b) => a.sortOrder - b.sortOrder)
    arr.forEach(n => sort(n.children))
    return arr
  }
  return sort(roots)
}

// 节点右键菜单：新增子节点 / 编辑 / 删除
// 点击节点 → 右侧 Sheet 打开编辑器
```

### 5.4 章节编辑器（Novel.js 封装）

```typescript
// src/components/chapter/ChapterEditor.tsx
import { Editor } from 'novel'

export function ChapterEditor({ chapter }: { chapter: Chapter }) {
  const mutation = useMutation({ mutationFn: (content: string) =>
    api.chapters.update(chapter.id, { content })
  })

  // debounce 自动保存
  const save = useDebouncedCallback((content: string) => {
    mutation.mutate(content)
  }, 1500)

  return (
    <div className="max-w-3xl mx-auto px-8 py-12">
      {/* 章节标题 */}
      <h1 className="text-2xl font-bold mb-8">{chapter.title}</h1>

      {/* Novel 编辑器 */}
      <Editor
        defaultValue={chapter.content ?? ''}
        onUpdate={({ editor }) => save(editor.getHTML())}
        className="font-serif text-base leading-relaxed"
      />

      {/* 保存状态指示 */}
      <div className="text-xs text-muted-foreground mt-4">
        {mutation.isPending ? '保存中...' : '已保存'}
      </div>
    </div>
  )
}
```

### 5.5 右侧 AI 面板（Phase 1 最简版）

```
GeneratePanel
├── 当前章节大纲（只读展示）
├── [生成] 按钮
├── StreamOutput（流式文字滚动区）
└── [写入编辑器] 按钮（生成完成后出现）
```

```typescript
// src/hooks/useGenerate.ts
export function useGenerate() {
  const [output, setOutput] = useState('')
  const [status, setStatus] = useState<'idle' | 'generating' | 'done' | 'error'>('idle')
  const stopRef = useRef<(() => void) | null>(null)

  const generate = (chapterId: string, novelId: string) => {
    setOutput('')
    setStatus('generating')
    stopRef.current = streamGenerate(
      { chapterId, novelId },
      (chunk) => setOutput(prev => prev + chunk),
      () => setStatus('done'),
      (e) => { setStatus('error'); toast.error(e.message) }
    )
  }

  const stop = () => { stopRef.current?.(); setStatus('idle') }

  return { output, status, generate, stop }
}
```

---

## Step 6 · 生成路由（后端）

**耗时：1 天**

### 6.1 Phase 1 生成逻辑（无 RAG 版）

```typescript
// server/routes/generate.ts
import { Hono } from 'hono'
import { drizzle } from 'drizzle-orm/d1'
import { chapters, outlines } from '../db/schema'
import { eq } from 'drizzle-orm'
import type { Env } from '../lib/types'

const router = new Hono<{ Bindings: Env }>()

router.post('/chapter', async (c) => {
  const { chapterId, novelId } = await c.req.json()
  const db = drizzle(c.env.DB)

  // 1. 拉取章节 + 关联大纲
  const chapter = await db.select().from(chapters).where(eq(chapters.id, chapterId)).get()
  if (!chapter) return c.json({ error: 'Chapter not found' }, 404)

  const outline = chapter.outlineId
    ? await db.select().from(outlines).where(eq(outlines.id, chapter.outlineId)).get()
    : null

  // 2. 拉取上一章摘要
  const prevChapter = await db.select({ summary: chapters.summary })
    .from(chapters)
    .where(eq(chapters.novelId, novelId))
    // sortOrder < 当前章节，取最大的那个
    .all()
    .then(rows => rows.filter(r => r.summary).at(-1))

  // 3. 读取模型配置
  const config = await resolveModelConfig(c.env.DB, 'chapter_gen', novelId)
  const apiKey = (c.env as any)[config.apiKeyEnv ?? 'VOLCENGINE_API_KEY'] as string

  // 4. 组装 prompt
  const messages = [
    {
      role: 'system' as const,
      content: `你是一位专业的玄幻小说作家，文风流畅，情节紧凑。请严格按照章节大纲进行创作，不要偏离设定。`,
    },
    {
      role: 'user' as const,
      content: [
        outline ? `【本章大纲】\n${outline.content}` : '',
        prevChapter?.summary ? `【上一章摘要】\n${prevChapter.summary}` : '',
        `【要求】请创作《${chapter.title}》的正文，3000-5000字，第三人称，结尾留有悬念。`,
      ].filter(Boolean).join('\n\n'),
    },
  ]

  // 5. 流式调用 LLM，直接 pipe 给客户端
  const upstream = await fetch(`${config.apiBase}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: config.modelId,
      messages,
      stream: true,
      temperature: 0.85,
      max_tokens: 4096,
    }),
  })

  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
})

export { router as generate }
```

> Phase 1 最简策略：直接把上游 LLM 的 SSE 流 pipe 给前端，零解析开销。
> Phase 2 替换为 Agent 循环时，只改这个函数内部。

---

## Step 7 · 阅读器

**耗时：0.5 天**

### 7.1 功能

```
ReaderPage
├── 顶部栏（返回工作台 / 章节标题 / 阅读设置）
├── 正文区（react-markdown 渲染）
├── 底部导航（上一章 / 下一章）
└── ReaderSettings（字体大小 / 主题：白/暗/护眼）
```

### 7.2 阅读器设置（持久化到 localStorage）

```typescript
// src/store/readerStore.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface ReaderStore {
  fontSize: number
  theme: 'light' | 'dark' | 'sepia'
  fontFamily: 'serif' | 'sans'
  lineHeight: number
  setFontSize: (n: number) => void
  setTheme: (t: ReaderStore['theme']) => void
  setFontFamily: (f: ReaderStore['fontFamily']) => void
}

export const useReaderStore = create<ReaderStore>()(
  persist(
    (set) => ({
      fontSize: 18,
      theme: 'light',
      fontFamily: 'serif',
      lineHeight: 1.9,
      setFontSize: (n) => set({ fontSize: n }),
      setTheme: (t) => set({ theme: t }),
      setFontFamily: (f) => set({ fontFamily: f }),
    }),
    { name: 'reader-settings' }
  )
)
```

### 7.3 主题 CSS 变量（在 index.css 添加）

```css
.reader-light { --reader-bg: #fafaf8; --reader-text: #1a1a1a; }
.reader-dark  { --reader-bg: #1c1c1e; --reader-text: #e5e5e5; }
.reader-sepia { --reader-bg: #f4efe4; --reader-text: #3b3020; }
```

---

## Step 8 · 模型配置页

**耗时：0.5 天**

### 8.1 支持的 Provider（硬编码在前端）

```typescript
// src/lib/providers.ts
export const PROVIDERS = [
  {
    id: 'volcengine',
    name: '火山引擎（豆包）',
    apiBase: 'https://ark.cn-beijing.volces.com/api/v3',
    models: ['doubao-seed-2-pro', 'doubao-pro-32k', 'doubao-lite-32k'],
    keyEnv: 'VOLCENGINE_API_KEY',
  },
  {
    id: 'anthropic',
    name: 'Anthropic（Claude）',
    apiBase: 'https://api.anthropic.com/v1',
    models: ['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001'],
    keyEnv: 'ANTHROPIC_API_KEY',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    apiBase: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini'],
    keyEnv: 'OPENAI_API_KEY',
  },
  {
    id: 'custom',
    name: '自定义（OpenAI 兼容接口）',
    apiBase: '',
    models: [],
    keyEnv: 'CUSTOM_API_KEY',
  },
] as const
```

### 8.2 API Key 设置方式

```bash
# 本地开发：在项目根创建 .dev.vars（加入 .gitignore）
cat > .dev.vars << 'EOF'
VOLCENGINE_API_KEY=你的key
ANTHROPIC_API_KEY=你的key
EOF

# 生产环境
wrangler secret put VOLCENGINE_API_KEY
wrangler secret put ANTHROPIC_API_KEY
```

> `model_configs.api_key_env` 只存字符串如 `"VOLCENGINE_API_KEY"`
> 后端运行时通过 `c.env[config.apiKeyEnv]` 读取，**API Key 永远不入库、不传前端**。

---

## Step 9 · 部署

**耗时：0.5 天**

### 9.1 构建 + 部署

```bash
# 构建前端
pnpm build
# dist/ 目录就是 Pages 需要的静态文件

# 执行远端 D1 迁移
wrangler d1 migrations apply novelforge --remote

# 一键部署（静态文件 + Functions 同时上线）
wrangler pages deploy dist

# 设置生产 secret
wrangler secret put VOLCENGINE_API_KEY
```

### 9.2 后续推送自动部署

```bash
# 在 Cloudflare Pages 控制台设置 Git 集成
# Build command:    pnpm build
# Build output dir: dist
# Root dir:         /
# 推 main 分支自动触发构建部署
```

---

## 完成标准检查清单

**后端（先用 curl 验证，再做前端）：**
- [ ] `GET /api/health` 返回 `{"ok":true}`
- [ ] novels CRUD 全部跑通
- [ ] outlines CRUD + 排序接口跑通
- [ ] volumes / chapters CRUD 跑通
- [ ] `POST /api/generate/chapter` SSE 流式输出正常

**前端：**
- [ ] `/novels` 小说列表可以新建/编辑/删除
- [ ] 进入工作台，左侧大纲树可以增删改拖拽
- [ ] 中央编辑器可以输入内容并自动保存
- [ ] 右侧点击生成，看到流式文字输出
- [ ] 生成内容可以写入编辑器
- [ ] `/novels/:id/read` 阅读器正常渲染，可上下翻章
- [ ] 模型配置页可以切换 provider 和 model

**部署：**
- [ ] `wrangler pages deploy` 成功
- [ ] 线上访问功能与本地一致

---

## 关键依赖版本

```json
{
  "hono": "^4.4.0",
  "drizzle-orm": "^0.30.0",
  "@hono/zod-validator": "^0.2.0",
  "zod": "^3.22.0",
  "react": "^18.3.0",
  "react-router-dom": "^6.23.0",
  "@tanstack/react-query": "^5.40.0",
  "zustand": "^4.5.0",
  "novel": "^0.5.0",
  "react-markdown": "^9.0.0",
  "remark-gfm": "^4.0.0",
  "@dnd-kit/core": "^6.1.0",
  "@dnd-kit/sortable": "^8.0.0",
  "tailwindcss": "^3.4.0",
  "wrangler": "^3.60.0"
}
```
