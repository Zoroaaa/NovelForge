export interface Novel {
  id: string
  title: string
  description: string | null
  genre: string | null
  status: 'draft' | 'writing' | 'completed' | 'archived'
  wordCount: number
  chapterCount: number
  createdAt: number
  updatedAt: number
}

export interface Outline {
  id: string
  novelId: string
  parentId: string | null
  type: 'world_setting' | 'volume' | 'chapter_outline' | 'custom'
  title: string
  content: string | null
  sortOrder: number
}

export interface Volume {
  id: string
  novelId: string
  title: string
  sortOrder: number
  wordCount: number
  status: string
  summary: string | null
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
  status: 'draft' | 'generated' | 'revised'
  summary: string | null
}

export interface Character {
  id: string
  novelId: string
  name: string
  aliases: string | null
  role: string | null
  description: string | null
  attributes: string | null
  imageUrl: string | null
}

export interface ModelConfig {
  id: string
  novelId: string | null
  scope: string
  stage: string
  provider: string
  modelId: string
  apiBase: string | null
  apiKeyEnv: string
  params: string | null
  isActive: number
}

export type NovelInput = Pick<Novel, 'title'> & Partial<Pick<Novel, 'description' | 'genre'>>
export type OutlineInput = Omit<Outline, 'id' | 'sortOrder'> & { sortOrder?: number }
export type VolumeInput = Omit<Volume, 'id' | 'wordCount' | 'status' | 'summary'>
export type ChapterInput = Omit<Chapter, 'id' | 'wordCount' | 'status' | 'summary'>
export type SortItem = { id: string; sortOrder: number; parentId?: string | null }
