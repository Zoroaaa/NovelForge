/**
 * @file api.ts
 * @description API客户端模块，封装所有后端API调用，提供类型安全的请求方法
 * @version 2.0.0
 * @modified 2026-04-22 - 添加用户认证系统
 */
import type {
  Novel, Volume, Chapter, Character,
  NovelInput, ChapterInput, VolumeInput, CharacterInput, ModelConfig, GenerateOptions,
  MasterOutline, WritingRule, NovelSetting, ForeshadowingItem,
  ForeshadowingProgress, ForeshadowingHealthReport, ForeshadowingSuggestion, ForeshadowingStats,
  PowerLevelDetectionResult, PowerLevelBatchResult, PowerLevelHistoryItem,
  PowerLevelValidationResult, PowerLevelApplyResult
} from './types'

const TOKEN_KEY = 'auth_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function removeToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

async function req<T>(
  path: string,
  init?: RequestInit & { timeout?: number; signal?: AbortSignal }
): Promise<T> {
  const controller = new AbortController()
  const timeout = init?.timeout ?? 30000

  const timer = setTimeout(() => controller.abort(), timeout)

  const token = getToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  try {
    const res = await fetch(path, {
      headers,
      signal: init?.signal || controller.signal,
      ...init,
    })

    if (!res.ok) {
      if (res.status === 401) {
        removeToken()
        window.location.href = '/login'
        throw new Error('未授权，请重新登录')
      }
      const err = await res.json().catch(() => ({ error: res.statusText }))
      const errorMessage = (err as Record<string, unknown>).error ? String((err as Record<string, unknown>).error) : res.statusText
      const apiError = new Error(errorMessage)
      Object.assign(apiError, {
        status: res.status,
        code: (err as Record<string, unknown>).code,
        details: (err as Record<string, unknown>).message || (err as Record<string, unknown>).details
      })
      throw apiError
    }

    return res.json()
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('请求超时，请检查网络连接后重试')
    }

    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new Error('网络连接失败，请检查网络设置')
    }

    throw error
  } finally {
    clearTimeout(timer)
  }
}

const j = (body: unknown) => JSON.stringify(body)

/**
 * 流式生成章节内容（SSE）
 * @description 通过Server-Sent Events接收AI生成的内容流
 * @param {GenerateOptions} payload - 生成选项
 * @param {Function} onChunk - 每次收到内容块的回调
 * @param {Function} onDone - 生成完成的回调
 * @param {Function} onError - 发生错误的回调
 * @returns {Function} 取消生成的函数
 */
export function streamGenerate(
  payload: GenerateOptions,
  onChunk: (data: unknown) => void,
  onDone: () => void,
  onError: (e: Error) => void,
): () => void {
  const controller = new AbortController()

  const token = getToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  fetch('/api/generate/chapter', {
    method: 'POST',
    headers,
    body: j(payload),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok || !res.body) {
        throw new Error(`生成失败: ${res.status}`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              onChunk(data)
            } catch {}
          }
        }
      }

      onDone()
    })
    .catch((err) => {
      if ((err as Error).name !== 'AbortError') {
        onError(err as Error)
      }
    })

  return () => controller.abort()
}

/**
 * API客户端对象
 * @description 封装所有后端API调用的命名空间对象
 */
export const api = {
  /**
   * 小说相关API
   */
  novels: {
    /** 获取小说列表 */
    list:   ()                    => req<{ data: Novel[]; total: number; page: number; perPage: number }>('/api/novels'),
    /** 获取单个小说详情 */
    get:    (id: string)          => req<Novel>(`/api/novels/${id}`),
    /** 创建新小说 */
    create: (body: NovelInput)    => req<Novel>('/api/novels', { method: 'POST', body: j(body) }),
    /** 更新小说信息 */
    update: (id: string, body: Partial<NovelInput>) =>
                                   req<Novel>(`/api/novels/${id}`, { method: 'PATCH', body: j(body) }),
    /** 删除小说 */
    delete: (id: string)          => req(`/api/novels/${id}`, { method: 'DELETE' }),
    /** 恢复已删除的小说 */
    restore: (id: string)         => req<Novel>(`/api/novels/${id}/restore`, { method: 'PATCH' }),
    /** 上传小说封面 */
    uploadCover: (id: string, formData: FormData) =>
      fetch(`/api/novels/${id}/cover`, {
        method: 'POST',
        headers: { ...((getToken() && { 'Authorization': `Bearer ${getToken()}` }) || {}) },
        body: formData,
      }),
    trash: {
      list: (novelId: string)       => req<{ ok: boolean; tables: Array<{ key: string; label: string; icon: string; count: number; items: Record<string, unknown>[] }>; total: number }>(`/api/novels/${novelId}/trash`),
      all: () => req<{ ok: boolean; novels: Array<{ id: string; title: string; genre?: string; status: string; wordCount: number; chapterCount: number; deletedAt: number; createdAt: number; updatedAt: number }>; total: number }>('/api/novels/trash'),
      clean: (novelId: string, table?: string) => req<{ ok: boolean; deleted: number }>(`/api/novels/${novelId}/trash${table ? `?table=${table}` : ''}`, { method: 'DELETE' }),
      destroy: (novelId: string) => req<{ ok: boolean; deleted: number }>(`/api/novels/trash?id=${novelId}`, { method: 'DELETE' }),
    },
  },
  
  /**
   * 总纲管理API（v2.0）
   */
  masterOutline: {
    /** 获取最新版本总纲 */
    get:    (novelId: string)      => req<{ exists: boolean; outline: MasterOutline | null }>(`/api/master-outline/${novelId}`),
    /** 创建新版本总纲 */
    create: (body: { novelId: string; title: string; content: string; summary?: string }) =>
                                   req<MasterOutline>('/api/master-outline', { method: 'POST', body: j(body) }),
    /** 更新总纲内容 */
    update: (id: string, body: { title?: string; content?: string; summary?: string }) =>
                                   req<MasterOutline>(`/api/master-outline/${id}`, { method: 'PUT', body: j(body) }),
    /** 获取历史版本列表 */
    history: (novelId: string)     => req<{ history: MasterOutline[] }>(`/api/master-outline/${novelId}/history`),
    /** 删除总纲版本 */
    delete: (id: string)          => req(`/api/master-outline/${id}`, { method: 'DELETE' }),
  },

  // v2.0: 小说设定管理
  settings: {
    list:   (novelId: string, params?: { type?: string; importance?: string }) =>
                                  req<{ settings: NovelSetting[]; total: number }>(`/api/settings/${novelId}${params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : ''}`),
    get:    (novelId: string, id: string) => req<{ setting: NovelSetting }>(`/api/settings/${novelId}/${id}`),
    create: (body: { novelId: string; type: string; name: string; content: string; summary?: string; attributes?: string }) =>
                                  req<NovelSetting>('/api/settings', { method: 'POST', body: j(body) }),
    update: (id: string, body: Partial<Pick<NovelSetting, 'type' | 'category' | 'name' | 'content' | 'summary' | 'importance' | 'sortOrder' | 'attributes'>>) =>
                                  req<NovelSetting>(`/api/settings/${id}`, { method: 'PUT', body: j(body) }),
    delete: (id: string) => req(`/api/settings/${id}`, { method: 'DELETE' }),
    generateSummary: (id: string) => req<{ ok: boolean; summary?: string; error?: string }>(`/api/settings/${id}/generate-summary`, { method: 'POST', timeout: 120000 }),
    tree:   (novelId: string)     => req<{ tree: Record<string, unknown>[]; stats: Record<string, number>; total: number }>(`/api/settings/tree/${novelId}`),
  },

  // v2.0: 创作规则管理
  rules: {
    list:   (novelId: string, params?: { category?: string; activeOnly?: boolean }) =>
                                   req<{ rules: WritingRule[] }>(`/api/rules/${novelId}${params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : ''}`),
    create: (body: { novelId: string; category: string; title: string; content: string; priority?: number }) =>
                                   req<WritingRule>('/api/rules', { method: 'POST', body: j(body) }),
    update: (id: string, body: Partial<Pick<WritingRule, 'category' | 'title' | 'content' | 'priority' | 'isActive' | 'sortOrder'>>) =>
                                   req<WritingRule>(`/api/rules/${id}`, { method: 'PUT', body: j(body) }),
    delete: (id: string)          => req(`/api/rules/${id}`, { method: 'DELETE' }),
    toggle: (id: string)           => req<{ ok: boolean; isActive: number }>(`/api/rules/${id}/toggle`, { method: 'PATCH' }),
  },

  chapters: {
    list:   (novelId: string)     => req<Chapter[]>(`/api/chapters?novelId=${novelId}`),
    get:    (id: string)          => req<Chapter>(`/api/chapters/${id}`),
    create: (body: ChapterInput)  => req<Chapter>('/api/chapters', { method: 'POST', body: j(body) }),
    update: (id: string, body: Partial<ChapterInput>) =>
                                   req<Chapter>(`/api/chapters/${id}`, { method: 'PATCH', body: j(body) }),
    delete: (id: string)          => req(`/api/chapters/${id}`, { method: 'DELETE' }),
  },

  volumes: {
    list:   (novelId: string)     => req<Volume[]>(`/api/volumes?novelId=${novelId}`),
    get:    (id: string)          => req<Volume>(`/api/volumes/${id}`),
    create: (body: VolumeInput)   => req<Volume>('/api/volumes', { method: 'POST', body: j(body) }),
    update: (id: string, body: Partial<VolumeInput>) =>
                                   req<Volume>(`/api/volumes/${id}`, { method: 'PATCH', body: j(body) }),
    delete: (id: string)          => req(`/api/volumes/${id}`, { method: 'DELETE' }),
  },

  characters: {
    list:   (novelId: string)     => req<Character[]>(`/api/characters?novelId=${novelId}`),
    create: (body: CharacterInput) => req<Character>('/api/characters', { method: 'POST', body: j(body) }),
    update: (id: string, body: Partial<CharacterInput>) =>
                                   req<Character>(`/api/characters/${id}`, { method: 'PATCH', body: j(body) }),
    delete: (id: string)          => req(`/api/characters/${id}`, { method: 'DELETE' }),
    uploadImage: (characterId: string, formData: FormData) =>
      fetch(`/api/characters/${characterId}/image`, {
        method: 'POST',
        headers: { ...((getToken() && { 'Authorization': `Bearer ${getToken()}` }) || {}) },
        body: formData,
      }),
  },

  // 数据导出 API
  export: {
    getFormats: () =>
      req<{ formats: Array<{ id: string; name: string; description: string; extensions: string[] }> }>('/api/export/formats'),
    exportData: (body: { novelId: string; format: string; options?: Record<string, unknown> }) =>
      req<{ ok: boolean; downloadUrl?: string; message?: string }>('/api/export', { method: 'POST', body: j(body) }),
  },

  // Phase 1.2 / v2.0: 伏笔追踪
  foreshadowing: {
    list:   (novelId: string, params?: { status?: string }) =>
                                   req<{ foreshadowing: ForeshadowingItem[] }>(`/api/foreshadowing/${novelId}${params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : ''}`),
    create: (body: { novelId: string; chapterId?: string; title: string; description?: string; importance?: 'high' | 'normal' | 'low' }) =>
                                   req<ForeshadowingItem>('/api/foreshadowing', { method: 'POST', body: j(body) }),
    update: (id: string, body: Partial<Pick<ForeshadowingItem, 'title' | 'description' | 'status' | 'importance' | 'resolvedChapterId'>>) =>
                                   req<ForeshadowingItem>(`/api/foreshadowing/${id}`, { method: 'PUT', body: j(body) }),
    delete: (id: string)          => req(`/api/foreshadowing/${id}`, { method: 'DELETE' }),
    getProgress: (id: string)     => req<{ progresses: Array<ForeshadowingProgress & { chapterTitle: string }> }>(`/api/foreshadowing/${id}/progress`),
    getStale: (novelId: string, threshold?: number) =>
                                   req<{ foreshadowing: ForeshadowingItem[]; threshold: number }>(
                                     `/api/foreshadowing/${novelId}/stale${threshold ? '?threshold=' + threshold : ''}`
                                   ),
    check: (novelId: string, params?: { recentChaptersCount?: number; staleThreshold?: number }) =>
                                   req<ForeshadowingHealthReport>(`/api/foreshadowing/${novelId}/check`, {
                                     method: 'POST', body: j(params || {}), timeout: 120000
                                   }),
    suggest: (novelId: string, body: { chapterContext: string; topK?: number }) =>
                                   req<{ suggestions: ForeshadowingSuggestion[]; query: string }>(`/api/foreshadowing/${novelId}/suggest`, {
                                     method: 'POST', body: j(body), timeout: 120000
                                   }),
    getStats: (novelId: string)   => req<ForeshadowingStats>(`/api/foreshadowing/${novelId}/stats`),
  },

  powerLevel: {
    detect:    (body: { chapterId: string; novelId: string }) =>
                                   req<{ ok: boolean; hasBreakthrough: boolean; updates: PowerLevelDetectionResult['updates']; chapterTitle: string }>('/api/power-level/detect', { method: 'POST', body: j(body) }),
    batchDetect:(body: { novelId: string; chapterIds?: string[] }) =>
                                   req<PowerLevelBatchResult>('/api/power-level/batch-detect', { method: 'POST', body: j(body), timeout: 300000 }),
    history:   (novelId: string)     => req<{ history: PowerLevelHistoryItem[] }>(`/api/power-level/history/${novelId}`),
    character: (characterId: string) => req<{ characterId: string; characterName: string; hasData: boolean; data: PowerLevelHistoryItem | null }>(`/api/power-level/character/${characterId}`),
    validate:  (body: { characterId: string; novelId: string; recentChapterCount?: number }) =>
                                   req<PowerLevelValidationResult>('/api/power-level/validate', { method: 'POST', body: j(body), timeout: 120000 }),
    applySuggestion: (body: { characterId: string; novelId: string; suggestedCurrent: string; suggestedSystem?: string; note?: string }) =>
                                   req<PowerLevelApplyResult>('/api/power-level/apply-suggestion', { method: 'POST', body: j(body) }),
  },

  // 全文搜索 API
  search: {
    search: (query: string, novelId?: string) => {
      const params = novelId ? `?q=${encodeURIComponent(query)}&novelId=${novelId}` : `?q=${encodeURIComponent(query)}`
      return req<{
        results: Array<{ id: string; novelId: string; title: string; chapterNumber: number; summary: string | null; snippet: string }>
      }>(`/api/search${params}`)
    },
  },

  // v2.0: 总索引（树形结构）
  entities: {
    tree:    (novelId: string)     => req<Record<string, unknown>>(`/api/entities/${novelId}`),
    children: (novelId: string, parentId: string) => req<{ children: Record<string, unknown>[] }>(`/api/entities/${novelId}/children/${parentId}`),
    rebuild: (body: { novelId: string }) => req<Record<string, unknown>>('/api/entities/rebuild', { method: 'POST', body: j(body) }),
  },

  // AI 监控中心：向量索引管理
  vectorize: {
    getStats: (novelId: string) =>
      req<{
        total: number
        byType: Record<string, number>
        lastIndexedAt: number | null
        unindexedCounts: { settings: number; characters: number; foreshadowing: number }
      }>(`/api/vectorize/stats/${novelId}`),
    search: (query: string, novelId?: string) => {
      const params = novelId ? `?q=${encodeURIComponent(query)}&novelId=${novelId}` : `?q=${encodeURIComponent(query)}`
      return req<{
        ok: boolean
        query: string
        resultsCount: number
        results: Array<{ id: string; score: number; title: string; sourceType: string; preview: string }>
      }>(`/api/vectorize/search${params}`)
    },
    reindexAll: (body: { novelId: string; types?: string[]; clearExisting?: boolean }) =>
      req<{ ok: boolean; message: string; novelId: string }>('/api/vectorize/reindex-all', { method: 'POST', body: j(body) }),
    indexMissing: (body: { novelId: string; types?: string[] }) =>
      req<{ ok: boolean; message: string; novelId: string; stats: { settings: number; characters: number; foreshadowing: number } }>('/api/vectorize/index-missing', { method: 'POST', body: j(body) }),
    getStatus: () =>
      req<{ status: string; message: string; embeddingModel?: string; dimensions?: number }>('/api/vectorize/status'),
  },

  // 模型配置管理
  modelConfigs: {
    list:   (params?: { novelId?: string; stage?: string }) => {
      const searchParams = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : ''
      return req<ModelConfig[]>(`/api/config${searchParams}`)
    },
    create: (body: { stage: string; provider: string; modelId: string; scope: string; apiBase?: string; apiKey?: string; novelId?: string }) =>
                                   req<ModelConfig>('/api/config', { method: 'POST', body: j(body) }),
    update: (id: string, body: Partial<ModelConfig>) =>
                                   req<ModelConfig>(`/api/config/${id}`, { method: 'PATCH', body: j(body) }),
    toggle: (id: string, isActive: boolean) =>
                                   req<ModelConfig>(`/api/config/${id}/toggle`, { method: 'PATCH', body: j({ isActive }) }),
    delete: (id: string)          => req<{ ok: boolean }>(`/api/config/${id}`, { method: 'DELETE' }),
  },

  generate: {
    chapter: (): (() => void) => { return () => {} },
    nextChapter: (body: { volumeId: string; novelId: string }) =>
      req<{
        ok: boolean
        chapterTitle?: string
        summary?: string
        error?: string
      }>('/api/generate/next-chapter', { method: 'POST', body: j(body), timeout: 120000 }),
    masterOutlineSummary: (body: { novelId: string }) =>
      req<{
        ok: boolean
        summary?: string
        error?: string
      }>('/api/generate/master-outline-summary', { method: 'POST', body: j(body), timeout: 120000 }),
    volumeSummary: (body: { volumeId: string; novelId: string }) =>
      req<{
        ok: boolean
        summary?: string
        error?: string
      }>('/api/generate/volume-summary', { method: 'POST', body: j(body), timeout: 120000 }),
    previewContext: (novelId: string, chapterId: string) =>
      req<{
        ok: boolean
        contextBundle: Record<string, unknown>
        buildTimeMs: number
        summary: {
          totalLayers: number
          coreLayerCount: number
          dynamicLayerCount: number
          ragResultCount: number
          ragQueryTimeMs?: number
        }
        error?: string
      }>('/api/generate/preview-context', { method: 'POST', body: j({ novelId, chapterId }), timeout: 120000 }),
    checkCoherence: (body: { chapterId: string; novelId: string }) =>
      req<{
        score: number
        issues: Array<{ severity: 'error' | 'warning'; category?: string; message: string; suggestion?: string }>
        error?: string
      }>('/api/generate/coherence-check', { method: 'POST', body: j(body), timeout: 120000 }),
    checkCharacterConsistency: (body: { characterIds: string[]; chapterId: string }) =>
      req<{
        conflicts: Array<{ characterName: string; conflict: string; excerpt: string }>
        warnings: string[]
        error?: string
      }>('/api/generate/check-character-consistency', { method: 'POST', body: j(body), timeout: 120000 }),
    checkVolumeProgress: (body: { chapterId: string; novelId: string }) =>
      req<{
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
        error?: string
      }>('/api/generate/volume-progress-check', { method: 'POST', body: j(body), timeout: 120000 }),
    getLogs: (novelId?: string, limit?: number) =>
      req<{
        logs: Array<{
          id: string
          novelId: string
          chapterId: string | null
          stage: string
          modelId: string
          promptTokens: number
          completionTokens: number
          totalTokens: number
          generationTime: number
          wordCount: number
          createdAt: number
        }>
      }>(`/api/generate/logs?novelId=${novelId || ''}&limit=${limit || 200}`),
    getCheckLogsLatest: (chapterId: string, checkType?: string) =>
      req<{
        log?: {
          id: string
          chapterId: string
          checkType: string
          characterResult?: Record<string, unknown>
          coherenceResult?: { score: number; issues: Array<{ severity: string; message: string }> }
          score: number
          createdAt: number
        }
      }>(`/api/generate/check-logs/latest?chapterId=${chapterId}${checkType ? `&checkType=${checkType}` : ''}`),
    getCheckLogsHistory: (chapterId: string, limit?: number) =>
      req<{
        logs: Array<{
          id: string
          chapterId: string
          checkType: string
          characterResult?: Record<string, unknown>
          coherenceResult?: { score: number; issues: Array<{ severity: string; message: string }> }
          score: number
          createdAt: number
        }>
      }>(`/api/generate/check-logs/history?chapterId=${chapterId}&limit=${limit || 20}`),
    combinedCheck: (body: { chapterId: string; novelId: string }) =>
      req<{
        characterCheck: { conflicts: Array<{ characterName: string; conflict: string; excerpt: string }>; warnings: string[] }
        coherenceCheck: { score: number; issues: Array<{ severity: string; message: string }> }
        score: number
      }>('/api/generate/combined-check', { method: 'POST', body: j(body), timeout: 180000 }),
  },

  // 认证系统API
  auth: {
    login: (body: { username: string; password: string }) =>
      req<{ success: boolean; data: { token: string; user: UserInfo } }>('/api/auth/login', { method: 'POST', body: j(body) }),
    
    register: (body: { username: string; email: string; password: string; inviteCode: string }) =>
      req<{ success: boolean; data: { token: string; user: UserInfo } }>('/api/auth/register', { method: 'POST', body: j(body) }),
    
    getMe: () =>
      req<{ success: boolean; data: UserInfo }>('/api/auth/me'),
    
    changePassword: (body: { currentPassword: string; newPassword: string }) =>
      req<{ success: boolean; message: string }>('/api/auth/password', { method: 'PUT', body: j(body) }),
    
    deleteAccount: () =>
      req<{ success: boolean; message: string }>('/api/auth/account', { method: 'DELETE' }),
  },

  // 邀请码管理API（管理员）
  inviteCodes: {
    list: (params?: { page?: number; pageSize?: number; status?: string }) => {
      const searchParams = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : ''
      return req<{ success: boolean; data: { items: InviteCode[]; pagination: PaginationInfo } }>(`/api/invite-codes${searchParams}`)
    },
    create: (body: { maxUses?: number; expiresInDays?: number }) =>
      req<InviteCode>('/api/invite-codes', { method: 'POST', body: j(body) }),
    updateStatus: (id: string, status: string) =>
      req<{ success: boolean; message: string }>(`/api/invite-codes/${id}/status`, { method: 'PATCH', body: j({ status }) }),
    delete: (id: string) =>
      req<{ success: boolean; message: string }>(`/api/invite-codes/${id}`, { method: 'DELETE' }),
  },

  // AI 创作工坊 API
  workshop: {
    createSession: (body: { novelId?: string; stage?: string }) =>
      req<{ ok: boolean; session: { id: string; stage: string; status: string; createdAt: number } }>('/api/workshop/session', { method: 'POST', body: j(body) }),
    getSession: (sessionId: string) =>
      req<{ ok: boolean; session: { id: string; novelId?: string; stage: string; status: string; messages: unknown[]; extractedData: Record<string, unknown>; createdAt: number; updatedAt: number } }>(`/api/workshop/session/${sessionId}`),
    listSessions: () =>
      req<{ ok: boolean; sessions: Array<{ id: string; title?: string; stage: string; status: string; updatedAt: number }> }>('/api/workshop/sessions'),
    deleteSession: (sessionId: string) =>
      req<{ ok: boolean; message: string }>(`/api/workshop/session/${sessionId}`, { method: 'DELETE' }),
    updateSession: (sessionId: string, body: { title?: string; stage?: string }) =>
      req<{ ok: boolean; message: string }>(`/api/workshop/session/${sessionId}`, { method: 'PATCH', body: j(body) }),
    sendMessage: (sessionId: string, body: { message: string; stage: string }) =>
      fetch(`/api/workshop/session/${sessionId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...((getToken() && { 'Authorization': `Bearer ${getToken()}` }) || {}) },
        body: j(body),
      }),
    commitSession: (sessionId: string) =>
      req<{ ok: boolean; novelId?: string; message?: string }>(`/api/workshop/session/${sessionId}/commit`, { method: 'POST' }),
  },

  // AI 创作工坊数据导入 API
  workshopImport: {
    listExisting: (novelId: string, targetModule: string) =>
      req<{ items: Record<string, unknown>[] }>(`/api/workshop-import/list/${targetModule}?novelId=${novelId}`),
    import: (params: { module: string; data: Record<string, unknown>; novelId: string; importMode: string }) =>
      req<{ ok: boolean; message?: string }>('/api/workshop-import/import', { method: 'POST', body: j(params) }),
  },

  // AI 创作工坊格式化导入 API
  workshopFormatImport: {
    format: (content: string, module: string) =>
      req<{ module: string; data: Record<string, unknown> | Record<string, unknown>[]; rawContent: string; parseStatus: string; parseMessage?: string }>(
        '/api/workshop-format-import/format-import',
        { method: 'POST', body: j({ content, module }) }
      ),
  },

  // 系统设置API（管理员）
  systemSettings: {
    getRegistrationStatus: () =>
      req<{ success: boolean; data: { registrationEnabled: boolean } }>('/api/system-settings/registration'),
    updateRegistrationStatus: (enabled: boolean) =>
      req<{ success: boolean; data: { registrationEnabled: boolean }; message: string }>('/api/system-settings/registration', { method: 'PUT', body: j({ enabled }) }),
  },

  // 系统初始化API（首次部署）
  setup: {
    checkStatus: () =>
      req<{ success: boolean; data: { initialized: boolean; adminExists: boolean } }>('/api/setup/status'),
    initialize: (body: { username: string; email: string; password: string }) =>
      req<{ success: boolean; data: { token: string; user: UserInfo }; message: string }>('/api/setup', { method: 'POST', body: j(body) }),
  },
}

export interface UserInfo {
  id: string
  username: string
  email: string
  role: string
  status: string
  created_at: number
  last_login_at: number | null
}

export interface InviteCode {
  id: string
  code: string
  created_by: string
  max_uses: number
  used_count: number
  expires_at: number | null
  status: string
  created_at: number
  updated_at: number
  created_by_username?: string
}

export interface PaginationInfo {
  page: number
  pageSize: number
  total: number
  totalPages: number
}
