/**
 * @file schema.ts
 * @description 数据库Schema定义文件，使用Drizzle ORM定义所有数据表结构和索引
 * @version 2.1.0
 * @modified 2026-04-21 - P0修复：统一ID策略、补全索引、软删除一致性
 */
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

const id = () =>
  text('id').primaryKey().$defaultFn(() =>
    Array.from(crypto.getRandomValues(new Uint8Array(8)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  )
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
  targetWordCount: integer('target_word_count'),
  targetChapterCount: integer('target_chapter_count'),
  ...timestamps,
  deletedAt: integer('deleted_at'),
}, (table) => [
  index('idx_novels_status').on(table.status).where(sql`${table.deletedAt} IS NULL`),
  index('idx_novels_updated').on(sql`${table.updatedAt} DESC`).where(sql`${table.deletedAt} IS NULL`),
])

// ============================================================
// 2. 总纲表（替代原 outlines 多层结构）
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
}, (table) => [
  index('idx_master_outline_novel').on(table.novelId).where(sql`${table.deletedAt} IS NULL`),
])

// ============================================================
// 3. 创作规则表（最高准则）
// ============================================================
export const writingRules = sqliteTable('writing_rules', {
  id: id(),
  novelId: text('novel_id').notNull(),
  category: text('category').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  priority: integer('priority').notNull().default(3),
  isActive: integer('is_active').notNull().default(1),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestamps,
  deletedAt: integer('deleted_at'),
}, (table) => [
  index('idx_writing_rules_novel').on(table.novelId, table.category).where(sql`${table.deletedAt} IS NULL`),
  index('idx_writing_rules_priority').on(table.priority).where(sql`${table.isActive} = 1`),
])

// ============================================================
// 4. 小说设定表（统一管理所有世界设定）
// ============================================================
export const novelSettings = sqliteTable('novel_settings', {
  id: id(),
  novelId: text('novel_id').notNull(),
  type: text('type').notNull(),
  category: text('category'),
  name: text('name').notNull(),
  content: text('content').notNull(),
  summary: text('summary'),
  attributes: text('attributes'),
  parentId: text('parent_id'),
  importance: text('importance').notNull().default('normal'),
  relatedIds: text('related_ids'),
  vectorId: text('vector_id'),
  indexedAt: integer('indexed_at'),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestamps,
  deletedAt: integer('deleted_at'),
}, (table) => [
  index('idx_novel_settings_novel').on(table.novelId, table.type).where(sql`${table.deletedAt} IS NULL`),
  index('idx_novel_settings_type').on(table.type, table.category),
  index('idx_novel_settings_parent').on(table.parentId),
  index('idx_novel_settings_importance').on(table.novelId, table.importance).where(sql`${table.deletedAt} IS NULL`),
])

// ============================================================
// 5. 卷表（增强版）
// ============================================================
export const volumes = sqliteTable('volumes', {
  id: id(),
  novelId: text('novel_id').notNull(),
  title: text('title').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  
  eventLine: text('event_line'),
  blueprint: text('blueprint'),
  summary: text('summary'),
  status: text('status').notNull().default('draft'),
  
  wordCount: integer('word_count').notNull().default(0),
  chapterCount: integer('chapter_count').notNull().default(0),
  targetWordCount: integer('target_word_count'),
  targetChapterCount: integer('target_chapter_count'),
  notes: text('notes'),
  
  ...timestamps,
  deletedAt: integer('deleted_at'),
}, (table) => [
  index('idx_volumes_novel').on(table.novelId).where(sql`${table.deletedAt} IS NULL`),
])

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
}, (table) => [
  index('idx_chapters_novel').on(table.novelId, table.sortOrder).where(sql`${table.deletedAt} IS NULL`),
  index('idx_chapters_volume').on(table.volumeId, table.sortOrder).where(sql`${table.deletedAt} IS NULL`),
  index('idx_chapters_status').on(table.novelId, table.status).where(sql`${table.deletedAt} IS NULL`),
])

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
  powerLevel: text('power_level'),
  vectorId: text('vector_id'),
  ...timestamps,
  deletedAt: integer('deleted_at'),
}, (table) => [
  index('idx_characters_novel').on(table.novelId).where(sql`${table.deletedAt} IS NULL`),
  index('idx_characters_role').on(table.novelId, table.role).where(sql`${table.deletedAt} IS NULL`),
])

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
}, (table) => [
  index('idx_foreshadowing_novel').on(table.novelId, table.status).where(sql`${table.deletedAt} IS NULL`),
  index('idx_foreshadowing_chapter').on(table.chapterId),
  index('idx_foreshadowing_importance').on(table.importance).where(sql`${table.status} = 'open'`),
])

// ============================================================
// 8.1 伏笔推进记录表（追踪伏笔在章节中的渐进式推进）
// ============================================================
export const foreshadowingProgress = sqliteTable('foreshadowing_progress', {
  id: id(),
  foreshadowingId: text('foreshadowing_id').notNull(),
  chapterId: text('chapter_id').notNull(),
  progressType: text('progress_type').notNull(),
  summary: text('summary'),
  mentionedKeywords: text('mentioned_keywords'),
  ...timestamps,
}, (table) => [
  index('idx_progress_foreshadowing').on(table.foreshadowingId),
  index('idx_progress_chapter').on(table.chapterId),
])

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
  apiKey: text('api_key'),
  params: text('params'),
  isActive: integer('is_active').notNull().default(1),
  ...timestamps,
}, (table) => [
  index('idx_model_configs_lookup').on(table.scope, table.stage, table.novelId),
])

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
}, (table) => [
  index('idx_gen_logs_chapter').on(table.chapterId),
  index('idx_gen_logs_novel').on(table.novelId, sql`${table.createdAt} DESC`),
])

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
}, (table) => [
  index('idx_exports_novel').on(table.novelId, sql`${table.createdAt} DESC`),
])

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
}, (table) => [
  index('idx_vector_source').on(table.sourceType, table.sourceId, table.chunkIndex),
  index('idx_vector_novel').on(table.novelId),
])

// ============================================================
// 13. 总索引表（串联所有实体形成树形结构）
// ============================================================
export const entityIndex = sqliteTable('entity_index', {
  id: id(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  novelId: text('novel_id').notNull(),
  parentId: text('parent_id'),
  title: text('title').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  depth: integer('depth').notNull().default(0),
  meta: text('meta'),
  ...timestamps,
  deletedAt: integer('deleted_at'),
}, (table) => [
  index('idx_entity_lookup').on(table.entityType, table.entityId),
  index('idx_entity_novel').on(table.novelId).where(sql`${table.deletedAt} IS NULL`),
  index('idx_entity_parent').on(table.parentId),
  index('idx_entity_depth').on(table.novelId, table.depth),
])

// ============================================================
// 14. 创作工坊会话表（Phase 3 - 对话式创作引擎）
// ============================================================
export const workshopSessions = sqliteTable('workshop_sessions', {
  id: id(),
  title: text('title'),
  novelId: text('novel_id'),
  stage: text('stage').notNull(),
  messages: text('messages').notNull().default('[]'),
  extractedData: text('extracted_data').notNull().default('{}'),
  status: text('status').notNull().default('active'),
  ...timestamps,
  deletedAt: integer('deleted_at'),
}, (table) => [
  index('idx_workshop_status').on(table.status),
  index('idx_workshop_novel').on(table.novelId),
  index('idx_workshop_stage').on(table.stage),
])

// ============================================================
// 15. 用户表（认证系统）
// ============================================================
export const users = sqliteTable('users', {
  id: id(),
  username: text('username').notNull().unique(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('user'),
  status: text('status').notNull().default('active'),
  inviteCodeId: text('invite_code_id'),
  lastLoginAt: integer('last_login_at'),
  ...timestamps,
  deletedAt: integer('deleted_at'),
}, (table) => [
  index('idx_users_username').on(table.username),
  index('idx_users_email').on(table.email),
  index('idx_users_status').on(table.status).where(sql`${table.deletedAt} IS NULL`),
])

// ============================================================
// 16. 邀请码表
// ============================================================
export const inviteCodes = sqliteTable('invite_codes', {
  id: id(),
  code: text('code').notNull().unique(),
  createdBy: text('created_by').notNull(),
  maxUses: integer('max_uses').notNull().default(1),
  usedCount: integer('used_count').notNull().default(0),
  expiresAt: integer('expires_at'),
  status: text('status').notNull().default('active'),
  ...timestamps,
}, (table) => [
  index('idx_invite_codes_code').on(table.code),
  index('idx_invite_codes_status').on(table.status),
])

// ============================================================
// 17. 系统设置表
// ============================================================
export const systemSettings = sqliteTable('system_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  description: text('description'),
  updatedAt: integer('updated_at').notNull().default(sql`(unixepoch())`),
})

// ============================================================
// 19. 章节检查日志表
// ============================================================
export const checkLogs = sqliteTable('check_logs', {
  id: id(),
  novelId: text('novel_id').notNull(),
  chapterId: text('chapter_id').notNull(),
  checkType: text('check_type').notNull(), // 'character_consistency' | 'chapter_coherence' | 'combined' | 'volume_progress'
  score: integer('score').notNull().default(100),
  status: text('status').notNull().default('success'), // 'success' | 'failed' | 'error'
  characterResult: text('character_result'), // JSON
  coherenceResult: text('coherence_result'), // JSON
  volumeProgressResult: text('volume_progress_result'), // JSON: 卷完成度检查结果
  issuesCount: integer('issues_count').notNull().default(0),
  errorMessage: text('error_message'),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
}, (table) => [
  index('idx_check_logs_chapter').on(table.chapterId, sql`${table.createdAt} DESC`),
  index('idx_check_logs_novel').on(table.novelId, sql`${table.createdAt} DESC`),
  index('idx_check_logs_type').on(table.chapterId, table.checkType, sql`${table.createdAt} DESC`),
])

// ============================================================
// 18. 队列任务日志表
// ============================================================
export const queueTaskLogs = sqliteTable('queue_task_logs', {
  id: text('id').primaryKey(),
  novelId: text('novel_id'),
  taskType: text('task_type').notNull(),
  status: text('status').notNull().default('pending'),
  payload: text('payload'),
  errorMsg: text('error_msg'),
  retryCount: integer('retry_count').notNull().default(0),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
  finishedAt: integer('finished_at'),
}, (table) => [
  index('idx_queue_logs_novel').on(table.novelId, table.createdAt),
  index('idx_queue_logs_status').on(table.status, table.createdAt),
])
