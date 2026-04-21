/**
 * @file schema.ts
 * @description 数据库Schema定义文件，使用Drizzle ORM定义所有数据表结构
 * @version 2.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

const id = () =>
  text('id').primaryKey().$defaultFn(() => crypto.randomUUID().slice(0, 16))
const timestamps = {
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at').notNull().default(sql`(unixepoch())`),
}

// ============================================================
// 1. 小说主表
// ============================================================
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

// ============================================================
// 2. 总纲表（替代原 outlines 多层结构）
// 用途：记录小说的整体总纲，不再有 world/volume/chapter 的层级
// ============================================================
export const masterOutline = sqliteTable('master_outline', {
  id: id(),
  novelId: text('novel_id').notNull(),
  title: text('title').notNull(),
  content: text('content'),
  version: integer('version').notNull().default(1),
  summary: text('summary'),
  wordCount: integer('word_count').notNull().default(0),
  vectorId: text('vector_id'),
  indexedAt: integer('indexed_at'),
  ...timestamps,
  deletedAt: integer('deleted_at'),
})

// ============================================================
// 3. 创作规则表（最高准则）
// 用途：规范小说创作的最高准则，包括文风、节奏、禁忌等
// ============================================================
export const writingRules = sqliteTable('writing_rules', {
  id: id(),
  novelId: text('novel_id').notNull(),
  category: text('category').notNull(),     // style | pacing | character | plot | world | taboo | custom
  title: text('title').notNull(),
  content: text('content').notNull(),
  priority: integer('priority').notNull().default(3),  // 1=最高 5=最低
  isActive: integer('is_active').notNull().default(1),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestamps,
  deletedAt: integer('deleted_at'),
})

// ============================================================
// 4. 小说设定表（统一管理所有世界设定）
// 包含：世界观、境界体系、势力组织、地理、宝物功法杂录等
// ============================================================
export const novelSettings = sqliteTable('novel_settings', {
  id: id(),
  novelId: text('novel_id').notNull(),
  type: text('type').notNull(),             // worldview | power_system | faction | geography | item_skill | misc
  category: text('category'),              // 子分类
  name: text('name').notNull(),
  content: text('content').notNull(),
  attributes: text('attributes'),           // JSON
  parentId: text('parent_id'),
  importance: text('importance').notNull().default('normal'),
  relatedIds: text('related_ids'),
  vectorId: text('vector_id'),
  indexedAt: integer('indexed_at'),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestamps,
  deletedAt: integer('deleted_at'),
})

// ============================================================
// 5. 卷表（增强版）
// 支持记载卷大纲、卷蓝图、卷概要等丰富信息
// ============================================================
export const volumes = sqliteTable('volumes', {
  id: id(),
  novelId: text('novel_id').notNull(),
  title: text('title').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  
  outline: text('outline'),                // 卷大纲 (Markdown)
  blueprint: text('blueprint'),            // 卷蓝图 (JSON)
  summary: text('summary'),               // 卷概要/摘要
  status: text('status').notNull().default('draft'),
  
  wordCount: integer('word_count').notNull().default(0),
  chapterCount: integer('chapter_count').notNull().default(0),
  targetWordCount: integer('target_word_count'),
  notes: text('notes'),                   // 作者笔记
  
  ...timestamps,
  deletedAt: integer('deleted_at'),
})

// ============================================================
// 6. 章节表
// ============================================================
export const chapters = sqliteTable('chapters', {
  id: id(),
  novelId: text('novel_id').notNull(),
  volumeId: text('volume_id'),
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
  summaryModel: text('summary_model'),
  summaryAt: integer('summary_at'),
  vectorId: text('vector_id'),
  indexedAt: integer('indexed_at'),
  snapshotKeys: text('snapshot_keys'),
  ...timestamps,
  deletedAt: integer('deleted_at'),
})

// ============================================================
// 7. 角色表
// ============================================================
export const characters = sqliteTable('characters', {
  id: id(),
  novelId: text('novel_id').notNull(),
  name: text('name').notNull(),
  aliases: text('aliases'),
  role: text('role'),
  description: text('description'),
  imageR2Key: text('image_r2_key'),
  attributes: text('attributes'),
  powerLevel: text('power_level'),          // JSON 格式存储境界信息
  vectorId: text('vector_id'),
  ...timestamps,
  deletedAt: integer('deleted_at'),
})

// ============================================================
// 8. 伏笔追踪表
// ============================================================
export const foreshadowing = sqliteTable('foreshadowing', {
  id: id(),
  novelId: text('novel_id').notNull(),
  chapterId: text('chapter_id'),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').notNull().default('open'),
  resolvedChapterId: text('resolved_chapter_id'),
  importance: text('importance').notNull().default('normal'),
  ...timestamps,
  deletedAt: integer('deleted_at'),
})

// ============================================================
// 9. 模型配置表
// ============================================================
export const modelConfigs = sqliteTable('model_configs', {
  id: id(),
  novelId: text('novel_id'),
  scope: text('scope').notNull().default('global'),
  stage: text('stage').notNull(),
  provider: text('provider').notNull(),
  modelId: text('model_id').notNull(),
  apiBase: text('api_base'),
  apiKeyEnv: text('api_key_env'),
  apiKey: text('api_key'),
  params: text('params'),
  isActive: integer('is_active').notNull().default(1),
  ...timestamps,
})

// ============================================================
// 10. 生成任务日志
// ============================================================
export const generationLogs = sqliteTable('generation_logs', {
  id: id(),
  novelId: text('novel_id').notNull(),
  chapterId: text('chapter_id'),
  stage: text('stage').notNull(),
  modelId: text('model_id').notNull(),
  contextSnapshot: text('context_snapshot'),
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  durationMs: integer('duration_ms'),
  status: text('status').notNull().default('success'),
  errorMsg: text('error_msg'),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
})

// ============================================================
// 11. 导出记录
// ============================================================
export const exports = sqliteTable('exports', {
  id: id(),
  novelId: text('novel_id').notNull(),
  format: text('format').notNull(),
  scope: text('scope').notNull(),
  scopeMeta: text('scope_meta'),
  r2Key: text('r2_key'),
  fileSize: integer('file_size'),
  status: text('status').notNull().default('pending'),
  errorMsg: text('error_msg'),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
  expiresAt: integer('expires_at'),
})

// ============================================================
// 12. 向量索引追踪
// ============================================================
export const vectorIndex = sqliteTable('vector_index', {
  id: text('id').primaryKey(),
  novelId: text('novel_id').notNull(),
  sourceType: text('source_type').notNull(),
  sourceId: text('source_id').notNull(),
  chunkIndex: integer('chunk_index').notNull().default(0),
  contentHash: text('content_hash'),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
})

// ============================================================
// 13. 总索引表（串联所有实体形成树形结构）
// ============================================================
export const entityIndex = sqliteTable('entity_index', {
  id: id(),
  entityType: text('entity_type').notNull(),   // novel | volume | chapter | character | setting | rule | foreshadowing
  entityId: text('entity_id').notNull(),
  novelId: text('novel_id').notNull(),
  parentId: text('parent_id'),
  title: text('title').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  depth: integer('depth').notNull().default(0),
  meta: text('meta'),
  ...timestamps,
})

// ============================================================
// 14. 创作工坊会话表（Phase 3 - 对话式创作引擎）
// 用途：记录用户与 AI 的多轮对话，提取结构化小说数据
// ============================================================
export const workshopSessions = sqliteTable('workshop_sessions', {
  id: id(),
  novelId: text('novel_id'),                    // 关联的小说ID（可选，创建时可为空）
  stage: text('stage').notNull(),               // 当前阶段：concept | worldbuild | characters | volumes | chapters
  messages: text('messages').notNull(),          // JSON 对话历史 [{role, content, timestamp}]
  extractedData: text('extracted_data'),        // JSON 当前提取的结构化数据 {title, genre, outline, characters, ...}
  status: text('status').notNull().default('active'), // active | committed | abandoned
  ...timestamps,
})
