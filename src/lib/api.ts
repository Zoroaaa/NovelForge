/**
 * @file api.ts
 * @description API客户端模块，封装所有后端API调用，提供类型安全的请求方法
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import type { 
  Novel, Volume, Chapter, Character, SortItem, 
  NovelInput, ChapterInput, VolumeInput, ModelConfig, GenerateOptions,
  MasterOutline, WritingRule, NovelSetting, ForeshadowingItem
} from './types'

/**
 * 通用请求函数
 * @description 封装fetch请求，统一处理响应和错误
 * @template T - 响应数据类型
 * @param {string} path - API路径
 * @param {RequestInit} [init] - fetch初始化选项
 * @returns {Promise<T>} 响应数据
 * @throws {Error} 请求失败时抛出错误
 */
async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((err as any).error ?? res.statusText)
  }
  return res.json()
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
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (e: Error) => void,
): () => void {
  const controller = new AbortController()

  fetch('/api/generate/chapter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
    list:   ()                    => req<Novel[]>('/api/novels'),
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
    history: (novelId: string)     => req<MasterOutline[]>(`/api/master-outline/${novelId}/history`),
    /** 删除总纲版本 */
    delete: (id: string)          => req(`/api/master-outline/${id}`, { method: 'DELETE' }),
  },

  // v2.0: 小说设定管理
  settings: {
    list:   (novelId: string, params?: { type?: string; importance?: string }) =>
                                   req<{ settings: NovelSetting[]; total: number }>(`/api/settings/${novelId}${params ? '?' + new URLSearchParams(params as any).toString() : ''}`),
    get:    (novelId: string, id: string) => req<{ setting: NovelSetting }>(`/api/settings/${novelId}/${id}`),
    create: (body: { novelId: string; type: string; name: string; content: string }) =>
                                   req<NovelSetting>('/api/settings', { method: 'POST', body: j(body) }),
    update: (id: string, body: Partial<Pick<NovelSetting, 'type' | 'category' | 'name' | 'content' | 'importance' | 'sortOrder'>>) =>
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
    create: (body: any)           => req<Character>('/api/characters', { method: 'POST', body: j(body) }),
    update: (id: string, body: any) => req<Character>(`/api/characters/${id}`, { method: 'PATCH', body: j(body) }),
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

  // 模型配置管理
  modelConfigs: {
    list:   (params?: { novelId?: string; stage?: string }) => {
      const searchParams = params ? '?' + new URLSearchParams(params as any).toString() : ''
      return req<ModelConfig[]>(`/api/config${searchParams}`)
    },
  },

  generate: {
    chapter: (payload: GenerateOptions, onChunk: (text: string) => void, onDone: () => void, onError: (e: Error) => void): (() => void) => { return () => {} },
  }
}
