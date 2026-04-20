import type { 
  Novel, Volume, Chapter, Character, SortItem, 
  NovelInput, ChapterInput, VolumeInput, ModelConfig, GenerateOptions,
  MasterOutline, WritingRule, NovelSetting, ForeshadowingItem
} from './types'

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
 */
export function streamGenerate(
  payload: GenerateOptions,
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (e: Error) => void,
): () => void {
  const controller = new AbortController()

  fetch('/api/v1/generate/chapter', {
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

export const api = {
  novels: {
    list:   ()                    => req<Novel[]>('/api/v1/novels'),
    get:    (id: string)          => req<Novel>(`/api/v1/novels/${id}`),
    create: (body: NovelInput)    => req<Novel>('/api/v1/novels', { method: 'POST', body: j(body) }),
    update: (id: string, body: Partial<NovelInput>) =>
                                   req<Novel>(`/api/v1/novels/${id}`, { method: 'PATCH', body: j(body) }),
    delete: (id: string)          => req(`/api/v1/novels/${id}`, { method: 'DELETE' }),
  },
  
  // v2.0: 总纲管理（替代原 outlines）
  masterOutline: {
    get:    (novelId: string)      => req<{ exists: boolean; outline: MasterOutline | null }>(`/api/v1/master-outline/${novelId}`),
    create: (body: { novelId: string; title: string; content: string; summary?: string }) =>
                                   req<MasterOutline>('/api/v1/master-outline', { method: 'POST', body: j(body) }),
    update: (id: string, body: { title?: string; content?: string; summary?: string }) =>
                                   req<MasterOutline>(`/api/v1/master-outline/${id}`, { method: 'PUT', body: j(body) }),
    history: (novelId: string)     => req<MasterOutline[]>(`/api/v1/master-outline/${novelId}/history`),
    delete: (id: string)          => req(`/api/v1/master-outline/${id}`, { method: 'DELETE' }),
  },

  // v2.0: 小说设定管理
  settings: {
    list:   (novelId: string, params?: { type?: string; importance?: string }) =>
                                   req<{ settings: NovelSetting[]; total: number }>(`/api/v1/settings/${novelId}${params ? '?' + new URLSearchParams(params as any).toString() : ''}`),
    get:    (novelId: string, id: string) => req<{ setting: NovelSetting }>(`/api/v1/settings/${novelId}/${id}`),
    create: (body: { novelId: string; type: string; name: string; content: string }) =>
                                   req<NovelSetting>('/api/v1/settings', { method: 'POST', body: j(body) }),
    update: (id: string, body: Partial<Pick<NovelSetting, 'type' | 'category' | 'name' | 'content' | 'importance' | 'sortOrder'>>) =>
                                   req<NovelSetting>(`/api/v1/settings/${id}`, { method: 'PUT', body: j(body) }),
    delete: (id: string)          => req(`/api/v1/settings/${id}`, { method: 'DELETE' }),
    tree:   (novelId: string)     => req<{ tree: any[]; stats: Record<string, number>; total: number }>(`/api/v1/settings/tree/${novelId}`),
  },

  // v2.0: 创作规则管理
  rules: {
    list:   (novelId: string, params?: { category?: string; activeOnly?: boolean }) =>
                                   req<{ rules: WritingRule[] }>(`/api/v1/rules/${novelId}${params ? '?' + new URLSearchParams(params as any).toString() : ''}`),
    create: (body: { novelId: string; category: string; title: string; content: string; priority?: number }) =>
                                   req<WritingRule>('/api/v1/rules', { method: 'POST', body: j(body) }),
    update: (id: string, body: Partial<Pick<WritingRule, 'category' | 'title' | 'content' | 'priority' | 'isActive' | 'sortOrder'>>) =>
                                   req<WritingRule>(`/api/v1/rules/${id}`, { method: 'PUT', body: j(body) }),
    delete: (id: string)          => req(`/api/v1/rules/${id}`, { method: 'DELETE' }),
    toggle: (id: string)           => req<{ ok: boolean; isActive: number }>(`/api/v1/rules/${id}/toggle`, { method: 'PATCH' }),
  },

  chapters: {
    list:   (novelId: string)     => req<Chapter[]>(`/api/v1/chapters?novelId=${novelId}`),
    get:    (id: string)          => req<Chapter>(`/api/v1/chapters/${id}`),
    create: (body: ChapterInput)  => req<Chapter>('/api/v1/chapters', { method: 'POST', body: j(body) }),
    update: (id: string, body: Partial<ChapterInput>) =>
                                   req<Chapter>(`/api/v1/chapters/${id}`, { method: 'PATCH', body: j(body) }),
    delete: (id: string)          => req(`/api/v1/chapters/${id}`, { method: 'DELETE' }),
  },

  volumes: {
    list:   (novelId: string)     => req<Volume[]>(`/api/v1/volumes?novelId=${novelId}`),
    get:    (id: string)          => req<Volume>(`/api/v1/volumes/${id}`),
    create: (body: VolumeInput)   => req<Volume>('/api/v1/volumes', { method: 'POST', body: j(body) }),
    update: (id: string, body: Partial<VolumeInput>) =>
                                   req<Volume>(`/api/v1/volumes/${id}`, { method: 'PATCH', body: j(body) }),
    delete: (id: string)          => req(`/api/v1/volumes/${id}`, { method: 'DELETE' }),
  },

  characters: {
    list:   (novelId: string)     => req<Character[]>(`/api/v1/characters?novelId=${novelId}`),
    create: (body: any)           => req<Character>('/api/v1/characters', { method: 'POST', body: j(body) }),
    update: (id: string, body: any) => req<Character>(`/api/v1/characters/${id}`, { method: 'PATCH', body: j(body) }),
    delete: (id: string)          => req(`/api/v1/characters/${id}`, { method: 'DELETE' }),
  },

  // Phase 1.2 / v2.0: 伏笔追踪
  foreshadowing: {
    list:   (novelId: string, params?: { status?: string }) =>
                                   req<{ foreshadowing: ForeshadowingItem[] }>(`/api/v1/foreshadowing/${novelId}${params ? '?' + new URLSearchParams(params as any).toString() : ''}`),
    create: (body: { novelId: string; chapterId?: string; title: string; description?: string; importance?: 'high' | 'normal' | 'low' }) =>
                                   req<ForeshadowingItem>('/api/v1/foreshadowing', { method: 'POST', body: j(body) }),
    update: (id: string, body: Partial<Pick<ForeshadowingItem, 'title' | 'description' | 'status' | 'importance' | 'resolvedChapterId'>>) =>
                                   req<ForeshadowingItem>(`/api/v1/foreshadowing/${id}`, { method: 'PUT', body: j(body) }),
    delete: (id: string)          => req(`/api/v1/foreshadowing/${id}`, { method: 'DELETE' }),
  },

  // v2.0: 总索引（树形结构）
  entities: {
    tree:    (novelId: string)     => req<any>(`/api/v1/entities/${novelId}`),
    children: (novelId: string, parentId: string) => req<{ children: any[] }>(`/api/v1/entities/${novelId}/children/${parentId}`),
    rebuild: (body: { novelId: string }) => req<any>('/api/v1/entities/rebuild', { method: 'POST', body: j(body) }),
  },

  generate: {
    chapter: (payload: GenerateOptions, onChunk: (text: string) => void, onDone: () => void, onError: (e: Error) => void): (() => void) => { return () => {} },
  }
}
