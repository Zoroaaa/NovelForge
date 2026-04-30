/**
 * @file workshop/types.ts
 * @description 创作工坊 - 类型定义
 */
import type { Env } from '../../lib/types'

export interface WorkshopMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export interface WorkshopExtractedData {
  title?: string
  genre?: string
  description?: string
  coreAppeal?: string[]
  targetWordCount?: string
  targetChapters?: string
  worldSettings?: Array<{ type: string; title: string; content: string; importance?: string }>
  masterOutline?: string
  characters?: Array<{
    name: string
    role: string
    description: string
    aliases?: string[]
    powerLevel?: string
    attributes?: Record<string, any>
    relationships?: string[]
  }>
  volumes?: Array<{
    title: string
    summary?: string
    blueprint?: string
    chapterCount?: number
    eventLine?: string[]
    notes?: string[]
    foreshadowingSetup?: string[]
    foreshadowingResolve?: string[]
    targetWordCount?: number | null
    targetChapterCount?: number | null
  }>
  writingRules?: Array<{
    category: string
    title: string
    content: string
    priority?: number
  }>
}

export type { Env }
