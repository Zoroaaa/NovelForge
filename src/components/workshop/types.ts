import { LucideIcon } from 'lucide-react'
import {
  Sparkles,
  Globe,
  Users,
  Layers,
  FileText,
} from 'lucide-react'

export interface WorkshopMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export interface WritingRule {
  category: string
  title: string
  content: string
  priority?: number
}

export interface WorldSetting {
  type: string
  title: string
  content: string
  importance?: string
}

export interface Character {
  name: string
  role: 'protagonist' | 'supporting' | 'antagonist' | 'minor'
  description: string
  aliases?: string[]
  attributes?: Record<string, unknown>
  powerLevel?: string
}

export interface Volume {
  title: string
  summary?: string
  blueprint?: string
  eventLine?: string[]
  notes?: string[]
  foreshadowingSetup?: string[]
  foreshadowingResolve?: string[]
  chapterCount?: number
  targetWordCount?: number | null
  targetChapterCount?: number | null
}

export interface Chapter {
  title: string
  summary?: string
  outline?: string
  characters?: string[]
  foreshadowingActions?: Array<{ action: 'setup' | 'resolve'; target: string; description: string }>
  keyScenes?: string[]
}

export interface ExtractedData {
  title?: string
  genre?: string
  description?: string
  coreAppeal?: string[]
  targetWordCount?: string
  targetChapters?: string
  writingRules?: WritingRule[]
  worldSettings?: WorldSetting[]
  characters?: Character[]
  volumes?: Volume[]
  chapters?: Chapter[]
}

export interface SessionListItem {
  id: string
  title: string
  updatedAt: number
  stage?: string
}

export interface Stage {
  id: string
  label: string
  icon: LucideIcon
  description: string
}

export const STAGES: Stage[] = [
  { id: 'concept', label: '概念构思', icon: Sparkles, description: '确定小说类型、核心设定' },
  { id: 'worldbuild', label: '世界观构建', icon: Globe, description: '建立完整的世界观体系' },
  { id: 'character_design', label: '角色设计', icon: Users, description: '设计主要角色和关系' },
  { id: 'volume_outline', label: '卷纲规划', icon: Layers, description: '规划分卷和事件线' },
]

export function getStageName(s: string): string {
  const names: Record<string, string> = {
    concept: '概念构思',
    worldbuild: '世界观构建',
    character_design: '角色设计',
    volume_outline: '卷纲规划',
  }
  return names[s] || s
}
