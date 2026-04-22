# Queues 集成方案

## 一、为什么要加 Queues

现状的 `safeWaitUntil` 有两个硬伤：

1. **Worker 请求生命周期绑定**：`waitUntil` 只是延长当前请求的生命周期，CF Pages Functions 在某些部署模式下根本不保证执行完成
2. **无重试**：`embedText` 调用失败（AI 服务抖动、限流）直接丢弃，没有任何重试机制，这就是为什么 vector_index 是空的另一个可能原因

Queues 解决的问题：把"需要后台跑的任务"从请求链路彻底解耦，失败自动重试，有消息持久化。

---

## 二、任务分类

哪些走 Queue，哪些不走：

| 操作 | 是否走 Queue | 原因 |
|------|------------|------|
| 单条内容索引（设定/角色/章节保存触发） | ✅ | embed API 耗时不定，不应阻塞写操作 |
| 全量重建索引（reindex-all） | ✅ | 可能几百条，必须后台分批跑 |
| 章节摘要生成（章节生成完毕触发） | ✅ | 已有，改走 Queue 更可靠 |
| 实体树重建（entity rebuild） | ✅ | 纯 DB 操作但量大时也需要后台 |
| 伏笔/境界自动提取（章节生成后） | ✅ | 非关键路径，适合异步 |
| 章节生成本身（SSE 流式） | ❌ | 需要实时流式返回，不能走 Queue |
| RAG 上下文构建 | ❌ | 生成前同步需要，不能异步 |

---

## 三、Queue 消息格式设计

所有任务共用一个 Queue（`novelforge-tasks`），用 `type` 字段区分任务类型：

```ts
// server/lib/queue.ts（新建）

export type QueueMessage =
  | {
      type: 'index_content'
      payload: {
        sourceType: 'setting' | 'character' | 'outline' | 'foreshadowing' | 'summary' | 'chapter'
        sourceId: string
        novelId: string
        title: string
        content: string
        extraMetadata?: Record<string, string>  // settingType, importance 等
      }
    }
  | {
      type: 'reindex_all'
      payload: {
        novelId: string
        types?: Array<'setting' | 'character' | 'outline' | 'foreshadowing'>
        clearExisting?: boolean
      }
    }
  | {
      type: 'generate_summary'
      payload: {
        chapterId: string
        novelId: string
        chapterTitle: string
      }
    }
  | {
      type: 'rebuild_entity_index'
      payload: {
        novelId: string
      }
    }
  | {
      type: 'extract_foreshadowing'
      payload: {
        chapterId: string
        novelId: string
        chapterContent: string
      }
    }
```

---

## 四、改动清单

### 4.1 `wrangler.toml` — 新增 Queue 绑定

```toml
[[queues.producers]]
binding = "TASK_QUEUE"
queue = "novelforge-tasks"

[[queues.consumers]]
queue = "novelforge-tasks"
max_batch_size = 10          # 每批最多处理10条消息
max_batch_timeout = 5        # 最多等5秒凑批
max_retries = 3              # 失败最多重试3次
dead_letter_queue = "novelforge-tasks-dlq"  # 死信队列，重试耗尽后转入
```

创建 Queue 命令（部署前执行）：
```bash
wrangler queues create novelforge-tasks
wrangler queues create novelforge-tasks-dlq
```

### 4.2 `server/lib/types.ts` — 扩展 Env

```ts
import type { QueueMessage } from './queue'

export type Env = {
  DB: D1Database
  STORAGE: R2Bucket
  AI: Ai
  VECTORIZE?: VectorizeIndex
  TASK_QUEUE?: Queue<QueueMessage>   // 新增，可选（本地开发无 Queue）
  // ...原有字段不变
}
```

### 4.3 `server/lib/queue.ts` — 新建入队工具函数

```ts
// 安全入队：Queue 不可用时降级为 waitUntil 直接执行
export async function enqueue(
  env: Env,
  c: any,  // Hono context，用于 waitUntil fallback
  message: QueueMessage
): Promise<void> {
  if (env.TASK_QUEUE) {
    await env.TASK_QUEUE.send(message)
  } else {
    // 本地开发降级：直接 waitUntil 执行
    safeWaitUntil(c, executeTask(env, message))
  }
}

// 直接入队（无 fallback，用于不在请求上下文中的场景）
export async function enqueueRaw(
  env: Env,
  message: QueueMessage
): Promise<void> {
  if (env.TASK_QUEUE) {
    await env.TASK_QUEUE.send(message)
  }
  // 没有 Queue 时静默忽略（或 throw，取决于调用方是否关键）
}
```

### 4.4 `server/queue-handler.ts` — 新建 Queue consumer

这是核心文件，处理所有消息类型：

```ts
// server/queue-handler.ts
import type { Env } from './lib/types'
import type { QueueMessage } from './lib/queue'
import { indexContent, deindexContent } from './services/embedding'
import { rebuildEntityIndex } from './services/entity-index'
import { drizzle } from 'drizzle-orm/d1'
import { novelSettings, characters, masterOutline, foreshadowing, chapters } from './db/schema'
import { eq, and, sql } from 'drizzle-orm'

export default {
  async queue(
    batch: MessageBatch<QueueMessage>,
    env: Env
  ): Promise<void> {
    for (const message of batch.messages) {
      try {
        await handleMessage(env, message.body)
        message.ack()
      } catch (error) {
        console.error(`Queue task failed [${message.body.type}]:`, error)
        message.retry()  // 触发重试，最多 max_retries 次
      }
    }
  }
}

async function handleMessage(env: Env, msg: QueueMessage): Promise<void> {
  switch (msg.type) {

    case 'index_content': {
      const { sourceType, sourceId, novelId, title, content, extraMetadata } = msg.payload
      await indexContent(env, sourceType, sourceId, novelId, title, content, extraMetadata)
      break
    }

    case 'reindex_all': {
      await handleReindexAll(env, msg.payload)
      break
    }

    case 'generate_summary': {
      // 把 agent.ts 中的 generateChapterSummary 逻辑移到这里调用
      const { generateChapterSummary } = await import('./services/agent')
      await generateChapterSummary(env, msg.payload.chapterId, msg.payload.novelId)
      break
    }

    case 'rebuild_entity_index': {
      await rebuildEntityIndex(env, msg.payload.novelId)
      break
    }

    case 'extract_foreshadowing': {
      const { extractForeshadowingFromChapter } = await import('./services/foreshadowing')
      await extractForeshadowingFromChapter(
        env,
        msg.payload.chapterId,
        msg.payload.novelId,
        msg.payload.chapterContent
      )
      break
    }
  }
}

async function handleReindexAll(
  env: Env,
  payload: Extract<QueueMessage, { type: 'reindex_all' }>['payload']
): Promise<void> {
  const { novelId, types = ['setting', 'character', 'outline', 'foreshadowing'], clearExisting } = payload
  const db = drizzle(env.DB)

  // reindex_all 本身作为一条消息进来，它内部把每条记录拆成独立的 index_content 消息
  // 这样每条失败可以独立重试，不会因为一条失败导致整批重来
  const messages: QueueMessage[] = []

  if (types.includes('setting')) {
    const settings = await db.select({
      id: novelSettings.id, novelId: novelSettings.novelId,
      name: novelSettings.name, content: novelSettings.content,
      type: novelSettings.type, importance: novelSettings.importance,
    })
    .from(novelSettings)
    .where(and(eq(novelSettings.novelId, novelId), sql`${novelSettings.deletedAt} IS NULL`, sql`${novelSettings.content} IS NOT NULL`))
    .all()

    for (const s of settings) {
      if (!s.content) continue
      messages.push({
        type: 'index_content',
        payload: {
          sourceType: 'setting', sourceId: s.id,
          novelId: s.novelId, title: s.name, content: s.content,
          extraMetadata: { settingType: s.type, importance: s.importance }
        }
      })
    }
  }

  if (types.includes('character')) {
    const chars = await db.select({
      id: characters.id, novelId: characters.novelId,
      name: characters.name, description: characters.description,
    })
    .from(characters)
    .where(and(eq(characters.novelId, novelId), sql`${characters.deletedAt} IS NULL`, sql`${characters.description} IS NOT NULL`))
    .all()

    for (const ch of chars) {
      if (!ch.description) continue
      messages.push({
        type: 'index_content',
        payload: { sourceType: 'character', sourceId: ch.id, novelId: ch.novelId, title: ch.name, content: ch.description }
      })
    }
  }

  if (types.includes('foreshadowing')) {
    const items = await db.select({
      id: foreshadowing.id, novelId: foreshadowing.novelId,
      title: foreshadowing.title, description: foreshadowing.description,
      importance: foreshadowing.importance,
    })
    .from(foreshadowing)
    .where(and(eq(foreshadowing.novelId, novelId), sql`${foreshadowing.deletedAt} IS NULL`, sql`${foreshadowing.description} IS NOT NULL`))
    .all()

    for (const f of items) {
      if (!f.description) continue
      messages.push({
        type: 'index_content',
        payload: {
          sourceType: 'foreshadowing', sourceId: f.id,
          novelId: f.novelId, title: f.title, content: f.description,
          extraMetadata: { importance: f.importance }
        }
      })
    }
  }

  // 批量发送，每次最多 100 条（Queue 单次 sendBatch 限制）
  if (env.TASK_QUEUE && messages.length > 0) {
    const BATCH_SIZE = 100
    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      await env.TASK_QUEUE.sendBatch(
        messages.slice(i, i + BATCH_SIZE).map(body => ({ body }))
      )
    }
  }

  console.log(`✅ reindex_all enqueued ${messages.length} tasks for novel ${novelId}`)
}
```

### 4.5 `functions/api/[[route]].ts` — 注册 queue handler

Cloudflare Pages Functions 的入口文件，需要同时导出 `queue` handler：

```ts
// 现有的 fetch handler 保持不变
export { onRequest } from '../../server/index'

// 新增 queue handler 导出
export { default as queue } from '../../server/queue-handler'
// 注意：这里的导出名必须是 queue，CF 会识别
```

> ⚠️ Pages Functions 和 Workers 的 queue consumer 注册方式略有不同。  
> Pages Functions 支持通过 `wrangler.toml` 的 `[[queues.consumers]]` + 在 `functions/` 目录下的文件暴露 `queue` 导出实现。  
> 具体参考：https://developers.cloudflare.com/queues/reference/pages-functions/

### 4.6 各路由改写：`safeWaitUntil` → `enqueue`

以 `novel-settings.ts` 为例（其他路由同理）：

```ts
// 改前
safeWaitUntil(c, indexContent(c.env, 'setting', id, novelId, name, content))

// 改后
import { enqueue } from '../lib/queue'

await enqueue(c.env, c, {
  type: 'index_content',
  payload: {
    sourceType: 'setting',
    sourceId: newSetting.id,
    novelId: newSetting.novelId,
    title: newSetting.name,
    content: newSetting.content,
    extraMetadata: {
      settingType: newSetting.type,
      importance: newSetting.importance,
    }
  }
})
```

需要改写的路由：
- `server/routes/novel-settings.ts`（POST、PUT）
- `server/routes/characters.ts`（POST、PUT，已有 safeWaitUntil 改写）
- `server/routes/master-outline.ts`（PUT）
- `server/routes/foreshadowing.ts`（POST、PUT）
- `server/routes/chapters.ts`（safeWaitUntil 触发的向量化 + 摘要生成改 enqueue）
- `server/routes/vectorize.ts`（`POST /reindex-all` 改为入队 `reindex_all` 消息）

### 4.7 `server/services/embedding.ts` — indexContent 支持 extraMetadata

```ts
export async function indexContent(
  env: Env,
  sourceType: VectorMetadata['sourceType'],
  sourceId: string,
  novelId: string,
  title: string,
  content: string | null,
  extraMetadata?: Record<string, string>   // 新增
): Promise<string[]> {
  // ...现有逻辑不变，upsertVector 调用处改为：
  await upsertVector(env.VECTORIZE, vectorId, values, {
    novelId, sourceType, sourceId,
    title: i === 0 ? title : `${title} (Part ${i + 1})`,
    content: chunks[i],
    ...extraMetadata,   // 合并 settingType、importance 等
  })
}
```

---

## 五、本地开发降级

本地 `wrangler dev` 没有 Queue，`enqueue` 函数会自动降级为 `safeWaitUntil` 直接执行，开发体验不变。

---

## 六、前端监控页面对接

AI 监控中心的「任务队列」Tab（之前方案 Tab4 扩充）新增：

**需要新增后端接口** `GET /api/queue/stats`：
- 调用 `env.TASK_QUEUE` 没有直接的统计 API，改用 D1 新建一张 `queue_task_logs` 表记录任务状态

**`queue_task_logs` 表（新增 migration）：**

```sql
CREATE TABLE queue_task_logs (
  id TEXT PRIMARY KEY,
  novel_id TEXT,
  task_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending / success / failed
  payload TEXT,                             -- JSON，调试用
  error_msg TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  finished_at INTEGER
);
CREATE INDEX idx_queue_logs_novel ON queue_task_logs(novel_id, created_at DESC);
CREATE INDEX idx_queue_logs_status ON queue_task_logs(status, created_at DESC);
```

在 `queue-handler.ts` 的 `handleMessage` 开始/结束时写入日志，前端就能查到任务历史和失败原因。

---

## 七、改动文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `wrangler.toml` | 修改 | 新增 queues producer + consumer |
| `server/lib/types.ts` | 修改 | Env 增加 TASK_QUEUE |
| `server/lib/queue.ts` | 新建 | QueueMessage 类型 + enqueue 工具函数 |
| `server/queue-handler.ts` | 新建 | Queue consumer，处理所有任务类型 |
| `functions/api/[[route]].ts` | 修改 | 导出 queue handler |
| `server/services/embedding.ts` | 修改 | indexContent 增加 extraMetadata 参数 |
| `server/routes/novel-settings.ts` | 修改 | POST/PUT 改用 enqueue |
| `server/routes/characters.ts` | 修改 | POST/PUT 改用 enqueue |
| `server/routes/master-outline.ts` | 修改 | PUT 改用 enqueue |
| `server/routes/foreshadowing.ts` | 修改 | POST/PUT 改用 enqueue |
| `server/routes/chapters.ts` | 修改 | triggerVectorization + 摘要生成改用 enqueue |
| `server/routes/vectorize.ts` | 修改 | reindex-all 改为入队 reindex_all 消息 |
| `server/db/migrations/0006_queue_logs.sql` | 新建 | queue_task_logs 表 |

---

## 八、部署顺序

```bash
# 1. 创建 Queue
wrangler queues create novelforge-tasks
wrangler queues create novelforge-tasks-dlq

# 2. 跑新 migration
wrangler d1 execute novelforge --file=server/db/migrations/0006_queue_logs.sql

# 3. 部署
wrangler pages deploy dist
```
