/**
 * @file api.ts
 * @description API客户端模块，封装所有后端API调用，提供类型安全的请求方法
 * @version 2.0.0
 * @modified 2026-04-22 - 添加用户认证系统
 */
import type {
  Novel, Volume, Chapter, Character, SortItem,
  NovelInput, ChapterInput, VolumeInput, CharacterInput, ModelConfig, GenerateOptions,
  MasterOutline, WritingRule, NovelSetting, ForeshadowingItem
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
    
    if (res.status === 401) {
      removeToken()
      window.location.href = '/login'
      throw new Error('未授权，请重新登录')
    }
    
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error((err as any).error ?? res.statusText)
    }
    return res.json()
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
                                  req<{ settings: NovelSetting[]; total: number }>(`/api/settings/${novelId}${params ? '?' + new URLSearchParams(params as any).toString() : ''}`),
    get:    (novelId: string, id: string) => req<{ setting: NovelSetting }>(`/api/settings/${novelId}/${id}`),
    create: (body: { novelId: string; type: string; name: string; content: string; attributes?: string }) =>
                                  req<NovelSetting>('/api/settings', { method: 'POST', body: j(body) }),
    update: (id: string, body: Partial<Pick<NovelSetting, 'type' | 'category' | 'name' | 'content' | 'importance' | 'sortOrder' | 'attributes'>>) =>
                                  req<NovelSetting>(`/api/settings/${id}`, { method: 'PUT', body: j(body) }),
    delete: (id: string)          => req(`/api/settings/${id}`, { method: 'DELETE' }),
    tree:   (novelId: string)     => req<{ tree: any[]; stats: Record<string, number>; total: number }>(`/api/settings/tree/${novelId}`),
  },

  // v2.0: 创作规则管理
  rules: {
    list:   (novelId: string, params?: { category?: string; activeOnly?: boolean }) =>
                                   req<{ rules: WritingRule[] }>(`/api/rules/${novelId}${params ? '?' + new URLSearchParams(params as any).toString() : ''}`),
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
  },

  // Phase 1.2 / v2.0: 伏笔追踪
  foreshadowing: {
    list:   (novelId: string, params?: { status?: string }) =>
                                   req<{ foreshadowing: ForeshadowingItem[] }>(`/api/foreshadowing/${novelId}${params ? '?' + new URLSearchParams(params as any).toString() : ''}`),
    create: (body: { novelId: string; chapterId?: string; title: string; description?: string; importance?: 'high' | 'normal' | 'low' }) =>
                                   req<ForeshadowingItem>('/api/foreshadowing', { method: 'POST', body: j(body) }),
    update: (id: string, body: Partial<Pick<ForeshadowingItem, 'title' | 'description' | 'status' | 'importance' | 'resolvedChapterId'>>) =>
                                   req<ForeshadowingItem>(`/api/foreshadowing/${id}`, { method: 'PUT', body: j(body) }),
    delete: (id: string)          => req(`/api/foreshadowing/${id}`, { method: 'DELETE' }),
  },

  // v2.0: 总索引（树形结构）
  entities: {
    tree:    (novelId: string)     => req<any>(`/api/entities/${novelId}`),
    children: (novelId: string, parentId: string) => req<{ children: any[] }>(`/api/entities/${novelId}/children/${parentId}`),
    rebuild: (body: { novelId: string }) => req<any>('/api/entities/rebuild', { method: 'POST', body: j(body) }),
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
    reindexAll: (body: { novelId: string; types?: string[] }) =>
      req<{ ok: boolean; indexed: number; failed: number; details: string[]; message: string }>('/api/vectorize/reindex-all', { method: 'POST', body: j(body), timeout: 300000 }),
    getStatus: () =>
      req<{ status: string; message: string; embeddingModel?: string; dimensions?: number }>('/api/vectorize/status'),
  },

  // 模型配置管理
  modelConfigs: {
    list:   (params?: { novelId?: string; stage?: string }) => {
      const searchParams = params ? '?' + new URLSearchParams(params as any).toString() : ''
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
    chapter: (payload: GenerateOptions, onChunk: (text: string) => void, onDone: () => void, onError: (e: Error) => void): (() => void) => { return () => {} },
    outlineBatch: (body: { volumeId: string; novelId: string; chapterCount?: number; context?: string }) =>
      req<{
        ok: boolean
        message?: string
        outlines?: Array<{ index: number; chapterTitle: string; summary: string }>
        totalRequested?: number
        successCount?: number
        error?: string
      }>('/api/generate/outline-batch', { method: 'POST', body: j(body), timeout: 300000 }),
    confirmBatchChapters: (body: { volumeId: string; novelId: string; chapterPlans: Array<{ chapterTitle: string; summary: string }> }) =>
      req<{
        ok: boolean
        message?: string
        createdChapters?: Array<{ id: string; title: string; sortOrder: number }>
        error?: string
      }>('/api/generate/confirm-batch-chapters', { method: 'POST', body: j(body) }),
    nextChapter: (body: { volumeId: string; novelId: string }) =>
      req<{
        ok: boolean
        chapterTitle?: string
        summary?: string
        error?: string
      }>('/api/generate/next-chapter', { method: 'POST', body: j(body) }),
    masterOutlineSummary: (body: { novelId: string }) =>
      req<{
        ok: boolean
        summary?: string
        error?: string
      }>('/api/generate/master-outline-summary', { method: 'POST', body: j(body) }),
    volumeSummary: (body: { volumeId: string; novelId: string }) =>
      req<{
        ok: boolean
        summary?: string
        error?: string
      }>('/api/generate/volume-summary', { method: 'POST', body: j(body) }),
    previewContext: (novelId: string, chapterId: string) =>
      req<{
        ok: boolean
        contextBundle: any
        buildTimeMs: number
        summary: {
          totalLayers: number
          coreLayerCount: number
          dynamicLayerCount: number
          ragResultCount: number
          ragQueryTimeMs?: number
        }
        error?: string
      }>('/api/generate/preview-context', { method: 'POST', body: j({ novelId, chapterId }) }),
  },

  // 认证系统API
  auth: {
    login: (body: { username: string; password: string }) =>
      req<{ success: boolean; data: { token: string; user: UserInfo } }>('/api/auth/login', { method: 'POST', body: j(body) }),
    
    register: (body: { username: string; email: string; password: string; inviteCode?: string }) =>
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
      const searchParams = params ? '?' + new URLSearchParams(params as any).toString() : ''
      return req<{ success: boolean; data: { items: InviteCode[]; pagination: PaginationInfo } }>(`/api/invite-codes${searchParams}`)
    },
    create: (body: { maxUses?: number; expiresInDays?: number }) =>
      req<InviteCode>('/api/invite-codes', { method: 'POST', body: j(body) }),
    updateStatus: (id: string, status: string) =>
      req<{ success: boolean; message: string }>(`/api/invite-codes/${id}/status`, { method: 'PATCH', body: j({ status }) }),
    delete: (id: string) =>
      req<{ success: boolean; message: string }>(`/api/invite-codes/${id}`, { method: 'DELETE' }),
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
