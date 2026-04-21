/**
 * @file types.ts
 * @description 前端类型定义文件，与后端数据库schema保持一致
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
export interface Novel {
  id: string
  title: string
  description: string | null
  genre: string | null
  coverR2Key: string | null
  status: 'draft' | 'writing' | 'completed' | 'archived'
  wordCount: number
  chapterCount: number
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

// v2.0: Outline 接口已废弃，使用 MasterOutline / Volume / NovelSetting 替代

export interface Volume {
  id: string
  novelId: string
  title: string
  sortOrder: number
  wordCount: number
  status: string
  summary: string | null
  outline: string | null
  blueprint: string | null
  targetWordCount: number | null
  notes: string | null
  chapterCount: number
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export interface Chapter {
  id: string
  novelId: string
  volumeId: string | null
  title: string
  sortOrder: number
  content: string | null
  wordCount: number
  status: 'draft' | 'generated' | 'revised' | 'published'
  summary: string | null
  summaryAt: number | null
  summaryModel: string | null
  modelUsed: string | null
  promptTokens: number | null
  completionTokens: number | null
  generationTime: number | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export interface Character {
  id: string
  novelId: string
  name: string
  aliases: string | null
  role: string | null
  description: string | null
  attributes: string | null
  imageR2Key: string | null
  powerLevel: string | null
  vectorId: string | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export interface ModelConfig {
  id: string
  novelId: string | null
  scope: 'global' | 'novel'
  stage: 'outline_gen' | 'chapter_gen' | 'summary_gen' | 'embedding' | 'vision'
  provider: string
  modelId: string
  apiBase: string | null
  apiKeyEnv: string | null
  apiKey: string | null
  params: string | null
  isActive: number
  createdAt: number
  updatedAt: number
}

export interface GenerationLog {
  id: string
  novelId: string
  chapterId: string | null
  stage: string
  modelId: string
  contextSnapshot: string | null
  promptTokens: number | null
  completionTokens: number | null
  durationMs: number | null
  status: 'success' | 'error'
  errorMsg: string | null
  createdAt: number
}

export interface ExportRecord {
  id: string
  novelId: string
  format: string
  scope: string
  scopeMeta: string | null
  r2Key: string | null
  fileSize: number | null
  status: 'pending' | 'processing' | 'done' | 'error'
  errorMsg: string | null
  createdAt: number
  expiresAt: number | null
}

export interface VectorIndexRecord {
  id: string
  novelId: string
  sourceType: 'outline' | 'chapter' | 'summary' | 'character' | 'setting'
  sourceId: string
  chunkIndex: number
  contentHash: string | null
  createdAt: number
}

// Input types
export type NovelInput = Pick<Novel, 'title'> & Partial<Pick<Novel, 'description' | 'genre' | 'status'>>

// v2.0: OutlineInput 已废弃，使用 MasterOutline / NovelSetting / VolumeInput 替代

export type VolumeInput = Omit<Volume, 'id' | 'wordCount' | 'createdAt' | 'updatedAt' | 'deletedAt'>
export type ChapterInput = Omit<Chapter, 'id' | 'wordCount' | 'status' | 'summary' | 'summaryAt' | 'summaryModel' | 'modelUsed' | 'promptTokens' | 'completionTokens' | 'generationTime' | 'createdAt' | 'updatedAt' | 'deletedAt'>
export type CharacterInput = Omit<Character, 'id' | 'imageR2Key' | 'createdAt' | 'updatedAt' | 'deletedAt'>
export type SortItem = { id: string; sortOrder: number; parentId?: string | null }

// API Response types
export interface ApiResponse<T> {
  data?: T
  error?: string
  message?: string
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

// Generate types
export interface GenerateOptions {
  chapterId: string
  novelId: string
  mode?: 'generate' | 'continue' | 'rewrite'  // Phase 1.6: 生成模式
  existingContent?: string                     // Phase 1.6: 已有内容（续写/重写用）
  options?: {
    enableRAG?: boolean
    enableAutoSummary?: boolean
  }
}

export interface GenerateChunk {
  content?: string
  type?: 'context' | 'done' | 'error'
  context?: ContextBundle
  usage?: {
    prompt_tokens: number
    completion_tokens: number
  }
}

export interface ContextBundle {
  novelId: string
  chapterId: string
  chapterTitle: string
  outlineContext: string
  characterContext: string
  recentSummaries: string[]
  ragResults: Array<{
    title: string
    content: string
    score: number
  }>
  tokenBudget: {
    used: number
    total: number
    remaining: number
  }
  debug?: {
    buildTimeMs: number
    ragHitsCount: number
  }
}

// Export types
export type ExportFormat = 'md' | 'txt' | 'epub' | 'html' | 'zip'

export interface ExportOptions {
  novelId: string
  format: ExportFormat
  volumeIds?: string[]
  includeTOC?: boolean
  includeMeta?: boolean
}

// Settings types
export interface ProviderConfig {
  id: string
  name: string
  models: string[]
  requiresApiKey: boolean
  defaultApiBase?: string
}

export interface ModelParams {
  temperature?: number
  max_tokens?: number
  top_p?: number
  frequency_penalty?: number
  presence_penalty?: number
}

// ============================================================
// v2.0 新增类型定义（与后端 schema v2.0 对齐）
// ============================================================

/**
 * 总纲表 (master_outline)
 */
export interface MasterOutline {
  id: string
  novelId: string
  title: string
  content: string | null
  version: number
  summary: string | null
  wordCount: number
  vectorId: string | null
  indexedAt: number | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

/**
 * 创作规则表 (writing_rules)
 */
export interface WritingRule {
  id: string
  novelId: string
  category: 'style' | 'pacing' | 'character' | 'plot' | 'world' | 'taboo' | 'custom'
  title: string
  content: string
  priority: number       // 1=最高, 5=最低
  isActive: number        // 0 or 1
  sortOrder: number
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

/**
 * 小说设定表 (novel_settings)
 * 统一管理世界观/境界体系/势力组织/地理/宝物功法杂录等
 */
export interface NovelSetting {
  id: string
  novelId: string
  type: 'worldview' | 'power_system' | 'faction' | 'geography' | 'item_skill' | 'misc'
  category: string | null    // 子分类
  name: string               // 设定名称
  content: string            // 详细描述 (Markdown)
  attributes: string | null  // JSON: 额外结构化数据
  parentId: string | null    // 支持层级
  importance: 'high' | 'normal' | 'low'
  relatedIds: string | null  // JSON array: 关联 ID
  vectorId: string | null
  indexedAt: number | null
  sortOrder: number
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

/**
 * 伏笔追踪表 (foreshadowing)
 */
export interface ForeshadowingItem {
  id: string
  novelId: string
  chapterId: string | null
  title: string
  description: string | null
  status: 'open' | 'resolved' | 'abandoned'
  resolvedChapterId: string | null
  importance: 'high' | 'normal' | 'low'
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

/**
 * 总索引节点 (entity_index)
 * 用于构建前端树形结构
 */
export interface EntityIndexNode {
  id: string
  entityType: 'novel' | 'volume' | 'chapter' | 'character' | 'setting' | 'rule' | 'foreshadowing'
  entityId: string
  novelId: string
  parentId: string | null
  title: string
  sortOrder: number
  depth: number
  meta: string | null          // JSON: 元数据
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

/**
 * 树形结构响应
 */
export interface EntityTreeResponse {
  tree: Array<{
    id: string
    type: string
    entityId: string
    title: string
    depth: number
    meta: any
    children: any[]
  }>
  stats: Record<string, number>
  totalNodes: number
}
