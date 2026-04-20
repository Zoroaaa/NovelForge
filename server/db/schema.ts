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
  type: text('type').notNull(),
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
  summaryModel: text('summary_model'),
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
  aliases: text('aliases'),
  role: text('role'),
  description: text('description'),
  imageR2Key: text('image_r2_key'),
  attributes: text('attributes'),
  vectorId: text('vector_id'),
  ...timestamps,
  deletedAt: integer('deleted_at'),
})

export const modelConfigs = sqliteTable('model_configs', {
  id: id(),
  novelId: text('novel_id'),
  scope: text('scope').notNull().default('global'),
  stage: text('stage').notNull(),
  provider: text('provider').notNull(),
  modelId: text('model_id').notNull(),
  apiBase: text('api_base'),
  apiKeyEnv: text('api_key_env'),
  params: text('params'),
  isActive: integer('is_active').notNull().default(1),
  ...timestamps,
})

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

export const vectorIndex = sqliteTable('vector_index', {
  id: text('id').primaryKey(),
  novelId: text('novel_id').notNull(),
  sourceType: text('source_type').notNull(),
  sourceId: text('source_id').notNull(),
  chunkIndex: integer('chunk_index').notNull().default(0),
  contentHash: text('content_hash'),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
})
