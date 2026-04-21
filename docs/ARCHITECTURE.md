# NovelForge · 系统架构设计

> 本文档详细描述了 NovelForge 的系统架构、技术选型、数据流设计和核心模块实现原理。

---

## 📋 目录

- [总体架构](#总体架构)
- [技术栈详解](#技术栈详解)
- [数据模型设计](#数据模型设计)
- [核心服务模块](#核心服务模块)
- [AI 工作流](#ai-工作流)
- [性能优化策略](#性能优化策略)
- [安全考虑](#安全考虑)

---

## 总体架构

### 架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Client Browser                               │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Cloudflare Pages CDN                            │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Static Assets (dist/)                                         │  │
│  │  - index.html                                                  │  │
│  │  - assets/index-*.js                                           │  │
│  │  - assets/index-*.css                                          │  │
│  └───────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Functions /api/[[route]]                                      │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │         Hono Application (server/index.ts)               │  │  │
│  │  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐       │  │  │
│  │  │  │ novels  │ │volumes  │ │chapters │ │characters│      │  │  │
│  │  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘       │  │  │
│  │  │  ┌─────────┐ ┌──────────┐ ┌─────────┐ ┌──────────┐    │  │  │
│  │  │  │generate │ │  export  │ │settings │ │  health  │    │  │  │
│  │  │  └─────────┘ └──────────┘ └─────────┘ └──────────┘    │  │  │
│  │  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐      │  │  │
│  │  │  │foreshadowing│ │writing-rules│ │master-outline│     │  │  │
│  │  │  └─────────────┘ └─────────────┘ └─────────────┘      │  │  │
│  │  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐      │  │  │
│  │  │  │novel-settings│ │   search   │ │  vectorize  │      │  │  │
│  │  │  └─────────────┘ └─────────────┘ └─────────────┘      │  │  │
│  │  │  ┌─────────────┐                                        │  │  │
│  │  │  │     mcp     │  (MCP Server for Claude Desktop)      │  │  │
│  │  │  └─────────────┘                                        │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                    │                     │                    │
        ┌───────────┘                     │                    └──────┐
        │                                 │                           │
┌───────▼──────────┐            ┌────────▼────────┐        ┌─────────▼──────┐
│   D1 Database    │            │  Vectorize      │        │   R2 Bucket    │
│  (SQLite Edge)   │            │ (Vector Search) │        │  (Object Store)│
├──────────────────┤            ├─────────────────┤        ├────────────────┤
│ - novels         │            │ - embeddings    │        │ - character    │
│ - master_outline │            │   (768 dim)     │        │   images       │
│ - writing_rules  │            │ - metadata      │        │ - exports      │
│ - novel_settings │            │   indexing      │        │ - covers       │
│ - volumes        │            └─────────────────┘        └────────────────┘
│ - chapters       │
│ - characters     │
│ - foreshadowing  │
│ - model_configs  │
│ - generation_logs│
│ - exports        │
│ - vector_index   │
│ - entity_index   │
└──────────────────┘
        │
        ▼
┌──────────────────┐
│  Workers AI      │
│  (Edge Inference)│
├──────────────────┤
│ - BGE Base zh    │ (Embedding)
│ - LLaVA 1.5 7B   │ (Vision)
│ - Doubao/Claude  │ (LLM via API)
└──────────────────┘
```

### 架构特点

1. **边缘优先 (Edge-First)**
   - 所有计算都在 Cloudflare 边缘网络运行
   - 全球 300+ 数据中心自动路由，延迟最低化
   - 无服务器冷启动问题

2. **单包架构 (Monorepo-free)**
   - 前端和后端在同一仓库
   - `functions/` 目录作为唯一后端入口
   - `server/` 目录存放业务逻辑，被 functions 引用

3. **类型安全 (Type-Safe)**
   - TypeScript 端到端类型覆盖
   - Drizzle ORM 提供数据库类型安全
   - Zod 运行时验证

4. **扁平化数据模型 (v2.0)**
   - 避免深层嵌套的树形结构
   - 总纲表替代多层大纲树
   - 设定表统一管理世界观/境界/势力/地理/宝物功法
   - 总索引表串联所有实体形成树形结构

---

## 技术栈详解

### 前端技术栈

| 技术 | 版本 | 用途 | 选择理由 |
|------|------|------|----------|
| **React** | 19.2 | UI 框架 | 成熟的组件生态，Hooks 模式 |
| **TypeScript** | 6.0 | 类型系统 | 端到端类型安全 |
| **Vite** | 8.0 | 构建工具 | 极速 HMR，生产优化 |
| **React Router** | 7.14 | 路由 | 声明式路由，嵌套布局 |
| **Zustand** | 5.0 | 状态管理 | 轻量级，无需 Provider 嵌套 |
| **TanStack Query** | 5.99 | 服务端状态 | 缓存、重试、乐观更新 |
| **shadcn/ui** | - | UI 组件 | 可定制，基于 Radix |
| **Tailwind CSS** | 3.4 | 样式 | 原子化 CSS，开发效率 |
| **Novel.js** | 1.0 | 编辑器 | Tiptap 封装，AI 友好 |
| **Lucide React** | 1.8 | 图标 | 统一图标库，Tree-shaking |

### 后端技术栈

| 技术 | 版本 | 用途 | 选择理由 |
|------|------|------|----------|
| **Hono** | 4.12 | Web 框架 | 超轻量，Cloudflare 原生 |
| **Drizzle ORM** | 0.45 | ORM | SQL-like 语法，Type-safe |
| **Zod** | 4.3 | 验证 | 运行时类型安全 |
| **@hono/zod-validator** | 0.7 | 验证中间件 | Hono + Zod 集成 |

### 基础设施

| 服务 | 用途 | 配额 | 成本 |
|------|------|------|------|
| **Cloudflare Pages** | 静态托管 + Functions | 100GB/月带宽 | 免费 |
| **D1** | 关系数据库 | 100 万读/日，10 万写/日 | 免费 |
| **R2** | 对象存储 | 10GB 存储，100 万 A 类操作 | 免费 |
| **Vectorize** | 向量搜索 | 1000 索引/账户 | 免费 |
| **Workers AI** | AI 推理 | 10 万 秒/日 | 免费 |

---

## 数据模型设计

### ER 图

```
┌─────────────┐       ┌──────────────┐       ┌─────────────┐
│   novels    │1─────n│   volumes    │1─────n│   chapters  │
├─────────────┤       ├──────────────┤       ├─────────────┤
│ id          │       │ id           │       │ id          │
│ title       │       │ novelId      │◄──────┤ novelId     │
│ description │       │ title        │       │ volumeId    │
│ genre       │       │ outline      │       │ title       │
│ status      │       │ blueprint    │       │ content     │
│ coverR2Key  │       │ summary      │       │ wordCount   │
│ wordCount   │       │ wordCount    │       │ status      │
│ chapterCount│       │ status       │       │ summary     │
│ created_at  │       │ created_at   │       │ vectorId    │
│ updated_at  │       │ updated_at   │       │ created_at  │
│ deletedAt   │       └──────────────┘       │ updated_at  │
└─────────────┘                              │ deletedAt   │
     │                                       └─────────────┘
     │                                                    │
     │ n                                                  │ n
     │                        ┌──────────────┐            │
     └───────────────────────►│  characters  │            │
                              ├──────────────┤            │
                              │ id           │            │
                              │ novelId      │◄───────────┘
                              │ name         │
                              │ aliases      │
                              │ role         │
                              │ description  │
                              │ imageR2Key   │
                              │ powerLevel   │◄── 境界信息 (JSON)
                              │ vectorId     │
                              │ created_at   │
                              │ deletedAt    │
                              └──────────────┘

┌─────────────────┐       ┌────────────────┐       ┌─────────────────┐
│ master_outline  │       │ writing_rules  │       │ novel_settings  │
├─────────────────┤       ├────────────────┤       ├─────────────────┤
│ id              │       │ id             │       │ id              │
│ novelId         │       │ novelId        │       │ novelId         │
│ title           │       │ category       │       │ type            │
│ content         │       │ title          │       │ category        │
│ version         │       │ content        │       │ name            │
│ summary         │       │ priority       │       │ content         │
│ wordCount       │       │ isActive       │       │ attributes      │
│ vectorId        │       │ sortOrder      │       │ parentId        │
│ created_at      │       │ created_at     │       │ importance      │
│ deletedAt       │       │ deletedAt      │       │ vectorId        │
└─────────────────┘       └────────────────┘       └─────────────────┘

┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│ foreshadowing   │       │ generation_logs │       │   vector_index  │
├─────────────────┤       ├─────────────────┤       ├─────────────────┤
│ id              │       │ id              │       │ id              │
│ novelId         │       │ novelId         │       │ novelId         │
│ chapterId       │       │ chapterId       │       │ sourceType      │
│ title           │       │ stage           │       │ sourceId        │
│ description     │       │ modelId         │       │ chunkIndex      │
│ status          │       │ promptTokens    │       │ contentHash     │
│ resolvedChapterId│      │ completionTokens│       │ created_at      │
│ importance      │       │ durationMs      │       └─────────────────┘
│ created_at      │       │ status          │
│ deletedAt       │       │ created_at      │
└─────────────────┘       └─────────────────┘

┌─────────────────┐       ┌─────────────────┐
│  entity_index   │       │  model_configs  │
├─────────────────┤       ├─────────────────┤
│ id              │       │ id              │
│ entityType      │       │ novelId         │
│ entityId        │       │ scope           │
│ novelId         │       │ stage           │
│ parentId        │       │ provider        │
│ title           │       │ modelId         │
│ sortOrder       │       │ apiBase         │
│ depth           │       │ apiKeyEnv       │
│ meta            │       │ params          │
│ created_at      │       │ isActive        │
│ updated_at      │       │ created_at      │
└─────────────────┘       └─────────────────┘
```

### 核心表说明

#### `novels` - 小说主表
```sql
CREATE TABLE novels (
  id TEXT PRIMARY KEY,           -- UUID (前 16 字符)
  title TEXT NOT NULL,           -- 标题
  description TEXT,              -- 简介
  genre TEXT,                    -- 类型：玄幻/仙侠/都市...
  status TEXT DEFAULT 'draft',   -- draft/writing/completed/archived
  cover_r2_key TEXT,             -- 封面图片 R2 路径
  word_count INTEGER DEFAULT 0,  -- 总字数
  chapter_count INTEGER DEFAULT 0,-- 章节数
  created_at INTEGER,            -- Unix 时间戳
  updated_at INTEGER,
  deletedAt INTEGER              -- 软删除标记
);
```

#### `master_outline` - 总纲表（v2.0 新增）
```sql
CREATE TABLE master_outline (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT,                  -- 总纲内容 (Markdown)
  version INTEGER DEFAULT 1,     -- 版本号
  summary TEXT,                  -- 摘要
  word_count INTEGER DEFAULT 0,
  vector_id TEXT,                -- Vectorize 索引 ID
  indexed_at INTEGER,
  created_at INTEGER,
  updated_at INTEGER,
  deletedAt INTEGER
);
```

#### `writing_rules` - 创作规则表（v2.0 新增）
```sql
CREATE TABLE writing_rules (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  category TEXT NOT NULL,        -- style/pacing/character/plot/world/taboo/custom
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  priority INTEGER DEFAULT 3,    -- 1=最高 5=最低
  is_active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER,
  updated_at INTEGER,
  deletedAt INTEGER
);
```

#### `novel_settings` - 小说设定表（v2.0 新增）
```sql
CREATE TABLE novel_settings (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  type TEXT NOT NULL,            -- worldview/power_system/faction/geography/item_skill/misc
  category TEXT,                 -- 子分类
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  attributes TEXT,               -- JSON
  parent_id TEXT,                -- 层级结构
  importance TEXT DEFAULT 'normal',
  related_ids TEXT,              -- JSON 关联 ID 列表
  vector_id TEXT,
  indexed_at INTEGER,
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER,
  updated_at INTEGER,
  deletedAt INTEGER
);
```

#### `volumes` - 卷表（增强版）
```sql
CREATE TABLE volumes (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  title TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  outline TEXT,                  -- 卷大纲 (Markdown)
  blueprint TEXT,                -- 卷蓝图 (JSON)
  summary TEXT,                  -- 卷概要/摘要
  status TEXT DEFAULT 'draft',
  word_count INTEGER DEFAULT 0,
  chapter_count INTEGER DEFAULT 0,
  target_word_count INTEGER,
  notes TEXT,                    -- 作者笔记
  created_at INTEGER,
  updated_at INTEGER,
  deletedAt INTEGER
);
```

#### `chapters` - 章节
```sql
CREATE TABLE chapters (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  volume_id TEXT,
  title TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  content TEXT,                  -- 正文内容 (HTML)
  word_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'draft',   -- draft/generated/revised
  model_used TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  generation_time INTEGER,
  summary TEXT,
  summary_model TEXT,
  summary_at INTEGER,
  vector_id TEXT,
  indexed_at INTEGER,
  snapshot_keys TEXT,            -- 快照存储路径
  created_at INTEGER,
  updated_at INTEGER,
  deletedAt INTEGER
);
```

#### `characters` - 角色
```sql
CREATE TABLE characters (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  name TEXT NOT NULL,
  aliases TEXT,                  -- JSON string[]
  role TEXT,                     -- protagonist/antagonist/supporting
  description TEXT,
  image_r2_key TEXT,
  attributes TEXT,               -- JSON 属性对象
  power_level TEXT,              -- JSON 境界信息 (v2.0 新增)
  vector_id TEXT,
  created_at INTEGER,
  deletedAt INTEGER
);
```

#### `foreshadowing` - 伏笔追踪表（v2.0 新增）
```sql
CREATE TABLE foreshadowing (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  chapter_id TEXT,               -- 埋下伏笔的章节
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'open',    -- open/resolved/abandoned
  resolved_chapter_id TEXT,      -- 收尾章节
  importance TEXT DEFAULT 'normal', -- high/normal/low
  created_at INTEGER,
  updated_at INTEGER,
  deletedAt INTEGER
);
```

#### `model_configs` - 模型配置
```sql
CREATE TABLE model_configs (
  id TEXT PRIMARY KEY,
  novel_id TEXT,                 -- NULL = 全局配置
  scope TEXT DEFAULT 'global',   -- global/novel
  stage TEXT NOT NULL,           -- outline_gen/chapter_gen/summary_gen/vision
  provider TEXT NOT NULL,        -- volcengine/anthropic/openai
  model_id TEXT NOT NULL,
  api_base TEXT,
  api_key_env TEXT,              -- 环境变量名（不存明文）
  api_key TEXT,                  -- 可选：直接存储（不推荐）
  params TEXT,                   -- JSON {temperature, max_tokens...}
  is_active INTEGER DEFAULT 1,
  created_at INTEGER,
  updated_at INTEGER
);
```

#### `generation_logs` - 生成任务日志（v2.0 新增）
```sql
CREATE TABLE generation_logs (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  chapter_id TEXT,
  stage TEXT NOT NULL,
  model_id TEXT NOT NULL,
  context_snapshot TEXT,         -- 上下文快照
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  duration_ms INTEGER,
  status TEXT DEFAULT 'success',
  error_msg TEXT,
  created_at INTEGER
);
```

#### `vector_index` - 向量索引追踪（v2.0 新增）
```sql
CREATE TABLE vector_index (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  source_type TEXT NOT NULL,     -- outline/chapter/character/summary
  source_id TEXT NOT NULL,
  chunk_index INTEGER DEFAULT 0,
  content_hash TEXT,
  created_at INTEGER
);
```

#### `entity_index` - 总索引表（v2.0 新增）
```sql
CREATE TABLE entity_index (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,     -- novel/volume/chapter/character/setting/rule/foreshadowing
  entity_id TEXT NOT NULL,
  novel_id TEXT NOT NULL,
  parent_id TEXT,
  title TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  depth INTEGER DEFAULT 0,
  meta TEXT,                     -- JSON 元数据
  created_at INTEGER,
  updated_at INTEGER
);
```

---

## 核心服务模块

### 1. LLM 服务 (`/server/services/llm.ts`)

**职责**: 统一 LLM API 调用接口，支持多提供商切换

**核心功能**:
- 流式生成 (`streamGenerate`) - SSE 实时输出
- 非流式生成 (`generate`) - 用于摘要等场景
- 配置解析 (`resolveConfig`) - 优先级：小说级 > 全局 > Fallback

**支持的提供商**:
```typescript
{
  volcengine: {
    base: 'https://ark.cn-beijing.volces.com/api/v3',
    models: ['doubao-seed-2-pro', 'doubao-pro-32k']
  },
  anthropic: {
    base: 'https://api.anthropic.com/v1',
    models: ['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001']
  },
  openai: {
    base: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini']
  }
}
```

**代码示例**:
```typescript
// 流式生成
await streamGenerate(config, messages, {
  onChunk: (text) => console.log(text),
  onDone: (usage) => console.log(usage),
  onError: (err) => console.error(err)
})
```

---

### 2. Agent 系统 (`/server/services/agent.ts`)

**职责**: 基于 ReAct 模式的智能章节生成

**ReAct 流程**:
```
1. 接收章节 ID → 构建上下文 (ContextBuilder)
2. 组装 System Prompt（角色设定 + 写作风格）
3. 调用 LLM 流式生成
4. 支持多轮工具调用（queryOutline/queryCharacter/searchSemantic）
5. 生成完成后自动触发摘要生成
```

**Agent 配置**:
```typescript
interface AgentConfig {
  maxIterations?: number    // 最大迭代次数 (默认 3)
  enableRAG?: boolean       // 启用 RAG (默认 true)
  enableAutoSummary?: boolean // 自动摘要 (默认 true)
}
```

---

### 3. 上下文组装器 (`/server/services/contextBuilder.ts`)

**职责**: 为 LLM 组装最优上下文组合

**Token 预算分配**:
```
Total: 12,000 tokens
├─ System Prompt: 2,000
├─ Mandatory: 6,000
│  ├─ Chapter Outline
│  ├─ Previous Chapter Summary
│  ├─ Volume Summary
│  └─ Protagonist Cards
└─ RAG: 4,000
   └─ Semantic Similarity Hits
```

**强制注入内容**:
- 总纲内容（来自 `master_outline.content`）
- 创作规则（来自 `writing_rules`，按优先级排序）
- 本章大纲（来自 `novel_settings` 或卷大纲）
- 上一章摘要（来自 `chapters.summary`）
- 当前卷概要（来自 `volumes.summary`）
- 主角卡片（来自 `characters`，包含描述、属性和境界信息）

**RAG 检索**:
- 使用本章大纲作为 query
- 在 Vectorize 中检索 top-20 相似片段
- 按 token 预算截断（超过 4000 tokens 的丢弃）

---

### 4. 嵌入服务 (`/server/services/embedding.ts`)

**模型**: `@cf/baai/bge-base-zh-v1.5`
- 维度：768
- 语言：中文优化
- 场景：语义相似度

**功能**:
```typescript
// 文本向量化
const vector = await embedText(ai, text)

// 相似度搜索
const results = await searchSimilar(vectorize, queryVector, {
  topK: 20,
  filter: { novelId }
})
```

---

### 5. 视觉服务 (`/server/services/vision.ts`)

**模型**: `@cf/llava-hf/llava-1.5-7b-hf`

**功能**:
- 上传图片到 R2
- 分析角色图片，提取：
  - 外貌描述（发型、五官、服饰）
  - 气质特征（冷峻、温暖、神秘）
  - 性格推测
  - 标签（3-5 个关键词）

**Prompt 设计**:
```
请仔细观察这张角色图片，用中文详细描述：
1. 外貌特征：发型、发色、眼睛、面部轮廓、体型、穿着
2. 气质特点：整体感觉（冷峻/温暖/神秘...）
3. 性格推测：从外貌和表情推测
4. 标签：3-5 个关键词

请以 JSON 格式返回：
{
  "description": "...",
  "appearance": "...",
  "traits": [...],
  "tags": [...]
}
```

---

### 6. 导出服务 (`/server/services/export.ts`)

**支持的格式**:
| 格式 | 库 | 特点 |
|------|-----|------|
| Markdown | 自定义 | `.md` 文件，保留层级 |
| TXT | 自定义 | `.txt` 纯文本 |
| EPUB | `epub-gen-memory` | 电子书格式，含目录 |
| ZIP | `jszip` | 打包所有章节 |

**EPUB 元数据**:
```typescript
{
  title: novel.title,
  author: config.author || 'Unknown',
  language: 'zh-CN',
  creator: 'NovelForge',
  generator: 'NovelForge v1.4.0'
}
```

---

### 7. 伏笔追踪服务 (`/server/services/foreshadowing.ts`) (v2.0 新增)

**职责**: 自动从章节内容中提取伏笔，追踪伏笔状态

**核心功能**:
- `extractForeshadowingFromChapter()` - 从章节提取伏笔
- 自动检测已收尾的伏笔
- 支持重要性分级（high/normal/low）

**工作流程**:
```
1. 章节生成完成后触发
2. 获取章节内容和当前未收尾伏笔列表
3. 调用 LLM 分析章节内容
4. 识别新伏笔和已收尾伏笔
5. 写入数据库并更新状态
```

---

### 8. 境界追踪服务 (`/server/services/powerLevel.ts`) (v2.0 新增)

**职责**: 自动检测角色境界突破事件，记录成长历程

**核心功能**:
- `detectPowerLevelBreakthrough()` - 检测境界突破
- 自动更新角色 `powerLevel` 字段
- 记录突破历史

**PowerLevel 数据结构**:
```typescript
interface PowerLevelData {
  system: string           // 境界体系名称（如"修仙境界"）
  current: string          // 当前境界（如"金丹期初期"）
  breakthroughs: Array<{
    chapterId: string
    from: string           // 突破前境界
    to: string             // 突破后境界
    note?: string          // 突破说明
    timestamp?: number     // 突破时间戳
  }>
  nextMilestone?: string   // 下一阶段目标
}
```

---

## AI 工作流

### 章节生成完整流程

```mermaid
sequenceDiagram
    participant User as 用户
    participant FE as 前端
    participant BE as 后端 API
    participant Agent as Agent Service
    participant CB as ContextBuilder
    participant DB as D1 Database
    participant V as Vectorize
    participant LLM as LLM Service
    participant AI as Workers AI

    User->>FE: 点击"生成章节"
    FE->>BE: POST /api/generate/chapter
    BE->>Agent: generateChapter()
    Agent->>CB: buildChapterContext()
    CB->>DB: 查询总纲/规则/摘要/角色
    DB-->>CB: 返回强制注入内容
    CB->>V: 语义检索 (topK=20)
    V-->>CB: 返回相关片段
    CB-->>Agent: ContextBundle
    Agent->>LLM: streamGenerate(messages)
    LLM->>LLM: 组装消息 (System+User)
    LLM->>LLM: 调用火山引擎 API
    LLM-->>Agent: SSE 流
    Agent-->>BE: Pipe SSE
    BE-->>FE: SSE 流
    FE-->>User: 实时渲染文字
    
    Note over Agent,DB: 生成完成后
    Agent->>LLM: 生成摘要 (非流式)
    LLM-->>Agent: 摘要文本
    Agent->>DB: UPDATE chapters SET summary
    Agent->>Agent: extractForeshadowingFromChapter()
    Agent->>Agent: detectPowerLevelBreakthrough()
```

### 自动向量化流程

```
触发时机:
- 总纲内容更新 (onMasterOutlineSave)
- 章节摘要生成 (onSummaryComplete)
- 角色描述更新 (onCharacterUpdate)
- 小说设定更新 (onNovelSettingsUpdate)

流程:
1. 检测内容变化
2. 调用 embedText() 生成向量
3. VECTORIZE.upsert({
     id: content.id,
     values: vector,
     metadata: {
       sourceType: 'master_outline'|'chapter'|'character'|'setting',
       novelId,
       title,
       content
     }
   })
4. 更新数据库 vectorId 字段
5. 更新 vector_index 追踪表
```

---

## 性能优化策略

### 1. 边缘缓存

```typescript
// 健康检查接口缓存
app.get('/health', (c) => {
  c.header('Cache-Control', 'no-cache')
  return c.json({ ok: true, ts: Date.now() })
})
```

### 2. Token 预算控制

```typescript
// 防止超长输入
const MAX_RAG_TOKENS = 4000
let usedTokens = 0
for (const chunk of ragResults) {
  const tokens = estimateTokens(chunk.content)
  if (usedTokens + tokens > MAX_RAG_TOKENS) break
  usedTokens += tokens
  selectedChunks.push(chunk)
}
```

### 3. 并发请求

```typescript
// 并行拉取强制注入内容
const [outline, prevSummary, volumeSummary, protagonists] =
  await Promise.all([
    fetchChapterOutline(db, chapterId),
    fetchPrevChapterSummary(db, chapterId),
    fetchVolumeSummary(db, chapterId),
    fetchProtagonistCards(db, chapterId)
  ])
```

### 4. 懒加载

```typescript
// TanStack Query 配置
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,  // 30 秒内不重新获取
      refetchOnWindowFocus: false
    }
  }
})
```

---

## 安全考虑

### 1. API Key 管理

**❌ 错误做法**:
```typescript
// 不要把 API Key 存入数据库！
const config = { apiKey: 'sk-xxx' }
db.insert(config)
```

**✅ 正确做法**:
```typescript
// 只存环境变量名，运行时读取
const config = { apiKeyEnv: 'VOLCENGINE_API_KEY' }
const apiKey = c.env[config.apiKeyEnv]  // 从 Secret 读取
```

### 2. 输入验证

```typescript
import { zValidator } from '@hono/zod-validator'

router.post('/', zValidator('json', CreateSchema), async (c) => {
  // Zod 自动验证，无效请求直接返回 400
  const data = c.req.valid('json')
})
```

### 3. 软删除

```typescript
// 永远不要物理删除！
await db.update(novels)
  .set({ deletedAt: sql`(unixepoch())` })
  .where(eq(novels.id, id))
```

### 4. CORS 配置

```typescript
// Hono 中间件
app.use('*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*')
  c.header('Access-Control-Allow-Headers', 'Content-Type')
  c.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE')
  await next()
})
```

---

## 监控与日志

### 健康检查

```bash
curl https://your-domain.pages.dev/api/health
# {"ok":true,"ts":1234567890,"phase":3}
```

### 错误日志

```typescript
try {
  await someOperation()
} catch (error) {
  console.error('Operation failed:', error)  // 写入 Workers 日志
  throw error
}
```

### Token 使用统计

```typescript
// 记录每次生成的 token 消耗
await db.update(chapters).set({
  promptTokens: usage.prompt_tokens,
  completionTokens: usage.completion_tokens
})
```

---

## 扩展性设计

### 1. 插件化 Provider

```typescript
// 新增 Provider 只需：
// 1. 在 llm.ts 添加 provider 配置
// 2. 实现对应的 API 适配层
// 3. 在前端 providers.ts 添加选项
```

### 2. 模块化 Services

```
services/
├── llm.ts           # LLM 调用（可替换）
├── embedding.ts     # 向量化（可换模型）
├── vision.ts        # 视觉分析（可换模型）
├── agent.ts         # Agent 逻辑（可改策略）
├── contextBuilder.ts # 上下文组装（可调参数）
└── export.ts        # 导出（可加格式）
```

### 3. 配置驱动

```typescript
// 所有行为都可通过 model_configs 调整
// 无需修改代码即可：
// - 切换模型
// - 调整 temperature
// - 设置 max_tokens
```

---

## 总结

NovelForge 采用现代化的边缘计算架构，充分利用 Cloudflare 生态的能力：

- **零运维**: 完全 Serverless，自动扩缩容
- **低延迟**: 全球边缘节点，用户就近访问
- **低成本**: 免费额度充足个人使用
- **高可用**: Cloudflare 99.99% SLA
- **易扩展**: 模块化设计，功能易于扩展

未来可扩展方向：
- Phase 4: 多用户 SaaS 化
- MCP 集成：接入 Claude Desktop
- PDF 导出：Cloudflare Browser Rendering
- 语音朗读：Workers AI TTS
