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
  targetWordCount: number | null
  targetChapterCount: number | null
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
  eventLine: string | null
  blueprint: string | null
  targetWordCount: number | null
  targetChapterCount: number | null
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
  stage: 'chapter_gen' | 'summary_gen' | 'embedding' | 'analysis' | 'workshop'
  provider: string
  modelId: string
  apiBase: string | null
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
export type NovelInput = Pick<Novel, 'title'> & Partial<Pick<Novel, 'description' | 'genre' | 'status' | 'targetWordCount' | 'targetChapterCount'>>

// v2.0: OutlineInput 已废弃，使用 MasterOutline / NovelSetting / VolumeInput 替代

export type VolumeInput = Omit<Volume, 'id' | 'wordCount' | 'createdAt' | 'updatedAt' | 'deletedAt'>
export type ChapterInput = Omit<Chapter, 'id' | 'wordCount' | 'status' | 'summaryAt' | 'summaryModel' | 'modelUsed' | 'promptTokens' | 'completionTokens' | 'generationTime' | 'createdAt' | 'updatedAt' | 'deletedAt'>
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
  mode?: 'generate' | 'continue' | 'rewrite'
  existingContent?: string
  targetWords?: number
  issuesContext?: string[]
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
  summary: string | null     // 摘要（用于 RAG 索引，≤400字）
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

export interface ForeshadowingProgress {
  id: string
  foreshadowingId: string
  chapterId: string
  progressType: 'hint' | 'advance' | 'partial_reveal'
  summary: string | null
  mentionedKeywords: string | null
  createdAt: number
}

export interface ForeshadowingHealthReport {
  totalOpen: number
  staleItems: Array<{
    id: string
    title: string
    importance: string
    chaptersSinceLastProgress: number
    lastProgressChapterTitle?: string
    suggestion: string
  }>
  atRiskOfContradiction: Array<{
    id: string
    title: string
    riskReason: string
  }>
  resolutionSuggestions: Array<{
    id: string
    title: string
    suggestedResolution: string
  }>
}

export interface ForeshadowingSuggestion {
  foreshadowing: { id: string; title: string; description: string | null; importance: string }
  relevanceScore: number
  suggestAction: 'weave_in' | 'advance' | 'resolve' | 'hint'
  reason: string
}

export interface ForeshadowingStats {
  overview: {
    total: number
    open: number
    resolved: number
    abandoned: number
    resolutionRate: number
    avgLifespan: number
  }
  byImportance: Record<string, { total: number; open: number; resolved: number }>
  byAge: Array<{ range: string; count: number; ids: string[] }>
  hotChapters: Array<{
    chapterId: string
    chapterTitle: string
    plantedCount: number
    resolvedCount: number
    progressedCount: number
  }>
}

export interface PowerLevelData {
  system: string
  current: string
  breakthroughs: Array<{
    chapterId: string
    from: string
    to: string
    note?: string
    timestamp?: number
  }>
  nextMilestone?: string
}

export interface PowerLevelHistoryBreakthrough {
  chapterId: string
  chapterTitle: string
  from: string
  to: string
  note?: string
  timestamp: number
}

export interface PowerLevelHistoryItem {
  characterId: string
  characterName: string
  system: string
  currentLevel: string
  nextMilestone?: string
  breakthroughs: PowerLevelHistoryBreakthrough[]
  totalBreakthroughs: number
}

export interface PowerLevelDetectionResult {
  hasBreakthrough: boolean
  updates: Array<{
    characterId: string
    characterName: string
    previousPowerLevel?: PowerLevelData
    newPowerLevel: PowerLevelData
    breakthroughNote?: string
  }>
}

export interface PowerLevelBatchResult {
  ok: boolean
  totalChapters: number
  totalBreakthroughs: number
  errorCount: number
  results: Array<{
    chapterId: string
    chapterTitle: string
    hasBreakthrough: boolean
    updatesCount: number
    error?: string
  }>
}

export interface PowerLevelValidationResult {
  ok: boolean
  characterId: string
  characterName: string
  isConsistent: boolean
  dbLevel: { system: string; current: string } | null
  assessedLevel: { system: string; current: string } | null
  confidence: 'high' | 'medium' | 'low'
  reasoning: string
  suggestion: string
  analyzedChapters: number
}

export interface PowerLevelApplyResult {
  ok: boolean
  characterId: string
  characterName: string
  previousLevel: string
  newLevel: string
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
    meta: Record<string, unknown>
    children: Record<string, unknown>[]
  }>
  stats: Record<string, number>
  totalNodes: number
}

export interface VolumeProgressResult {
  volumeId: string
  currentChapter: number
  targetChapter: number | null
  currentWordCount: number
  targetWordCount: number | null
  chapterProgress: number
  wordProgress: number
  healthStatus: 'healthy' | 'ahead' | 'behind' | 'critical'
  risk: 'early_ending' | 'late_ending' | null
  suggestion: string
  raw?: string
}
