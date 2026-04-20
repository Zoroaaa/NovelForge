/**
 * NovelForge · 前端类型定义
 *
 * 与后端数据库schema保持一致
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

export interface Outline {
  id: string
  novelId: string
  parentId: string | null
  type: 'world_setting' | 'volume' | 'chapter_outline' | 'custom'
  title: string
  content: string | null
  sortOrder: number
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export interface Volume {
  id: string
  novelId: string
  title: string
  sortOrder: number
  wordCount: number
  status: string
  summary: string | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
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
  status: 'draft' | 'generated' | 'revised' | 'published'
  summary: string | null
  summaryAt: number | null
  summaryModel: string | null
  modelUsed: string | null
  promptTokens: number | null
  completionTokens: number | null
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
  sourceType: 'outline' | 'chapter' | 'summary' | 'character'
  sourceId: string
  chunkIndex: number
  contentHash: string | null
  createdAt: number
}

// Input types
export type NovelInput = Pick<Novel, 'title'> & Partial<Pick<Novel, 'description' | 'genre'>>
export type OutlineInput = Omit<Outline, 'id' | 'sortOrder' | 'createdAt' | 'updatedAt' | 'deletedAt'> & { sortOrder?: number }
export type VolumeInput = Omit<Volume, 'id' | 'wordCount' | 'status' | 'summary' | 'createdAt' | 'updatedAt' | 'deletedAt'>
export type ChapterInput = Omit<Chapter, 'id' | 'wordCount' | 'status' | 'summary' | 'summaryAt' | 'summaryModel' | 'modelUsed' | 'promptTokens' | 'completionTokens' | 'createdAt' | 'updatedAt' | 'deletedAt'>
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
export type ExportFormat = 'md' | 'txt' | 'epub' | 'pdf' | 'zip'

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
