import type { Novel, Outline, Volume, Chapter, Character, SortItem, NovelInput, OutlineInput, ChapterInput, VolumeInput, ModelConfig } from './types'

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

export const api = {
  novels: {
    list:   ()                    => req<Novel[]>('/api/novels'),
    get:    (id: string)          => req<Novel>(`/api/novels/${id}`),
    create: (body: NovelInput)    => req<Novel>('/api/novels', { method: 'POST', body: j(body) }),
    update: (id: string, body: Partial<NovelInput>) =>
                                     req<Novel>(`/api/novels/${id}`, { method: 'PATCH', body: j(body) }),
    delete: (id: string)          => req(`/api/novels/${id}`, { method: 'DELETE' }),
  },
  outlines: {
    list:   (novelId: string)     => req<Outline[]>(`/api/outlines?novelId=${novelId}`),
    create: (body: OutlineInput)  => req<Outline>('/api/outlines', { method: 'POST', body: j(body) }),
    update: (id: string, body: Partial<OutlineInput>) =>
                                     req<Outline>(`/api/outlines/${id}`, { method: 'PATCH', body: j(body) }),
    sort:   (items: SortItem[])   => req('/api/outlines/sort', { method: 'PATCH', body: j(items) }),
    delete: (id: string)          => req(`/api/outlines/${id}`, { method: 'DELETE' }),
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
    create: (body: VolumeInput)   => req<Volume>('/api/volumes', { method: 'POST', body: j(body) }),
    update: (id: string, body: Partial<VolumeInput>) =>
                                     req<Volume>(`/api/volumes/${id}`, { method: 'PATCH', body: j(body) }),
  },
  characters: {
    list:   (novelId: string)     => req<Character[]>(`/api/characters?novelId=${novelId}`),
    create: (body: any)           => req<Character>('/api/characters', { method: 'POST', body: j(body) }),
    delete: (id: string)          => req(`/api/characters/${id}`, { method: 'DELETE' }),
  },
  settings: {
    list:   (novelId?: string)    => novelId
      ? req<ModelConfig[]>(`/api/settings?novelId=${novelId}`)
      : req<ModelConfig[]>('/api/settings'),
    create: (body: any)           => req<ModelConfig>('/api/settings', { method: 'POST', body: j(body) }),
    delete: (id: string)          => req(`/api/settings/${id}`, { method: 'DELETE' }),
  },
}

export function streamGenerate(
  payload: { chapterId: string; novelId: string },
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (e: Error) => void,
): () => void {
  const ctrl = new AbortController()
  ;(async () => {
    try {
      const res = await fetch('/api/generate/chapter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: j(payload),
        signal: ctrl.signal,
      })
      const reader = res.body!.getReader()
      const dec = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) { onDone(); return }
        for (const line of dec.decode(value).split('\n')) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]')
            onChunk(line.slice(6))
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') onError(e as Error)
    }
  })()
  return () => ctrl.abort()
}
