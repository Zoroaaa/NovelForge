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
    outline: string
    blueprint: string
    chapterCount: number
    summary?: string
    eventLine?: string[]
    notes?: string[]
    keyEvents?: string[]
    foreshadowingSetup?: string[]
    foreshadowingResolve?: string[]
    targetWordCount?: number | null
    targetChapterCount?: number | null
  }>
  chapters?: Array<{
    title: string
    outline: string
    summary?: string
    characters?: string[]
    foreshadowingActions?: Array<{
      action: string
      target: string
      description: string
    }>
    keyScenes?: string[]
  }>
  writingRules?: Array<{
    category: string
    title: string
    content: string
    priority?: number
  }>
}

export type { Env }
