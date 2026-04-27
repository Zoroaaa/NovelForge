/**
 * @file workshop/extract.ts
 * @description 创作工坊 - 数据提取
 */
import type { WorkshopExtractedData } from './types'

export function safeParseJSON(raw: string): unknown {
  try { return JSON.parse(raw) } catch { /* 首次尝试，失败后进行修复 */ }
  let inString = false
  let escaped = false
  let result = ''
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (escaped) { escaped = false; result += ch; continue }
    if (ch === '\\') { escaped = true; result += ch; continue }
    if (ch === '"') { inString = !inString; result += ch; continue }
    if (inString) {
      if (ch === '\n') { result += '\\n'; continue }
      if (ch === '\r') { result += '\\r'; continue }
      if (ch === '\t') { result += '\\t'; continue }
    }
    result += ch
  }
  try {
    return JSON.parse(result)
  } catch (e) {
    console.warn('[workshop/extract] safeParseJSON 二次解析仍失败, 原因:', (e as Error).message, '| 原始长度:', raw.length, '| 前100字符:', raw.slice(0, 100))
    throw e
  }
}

const STAGE_FIELD_MAP: Record<string, string[]> = {
  concept: ['title', 'genre', 'description', 'coreAppeal', 'targetWordCount', 'targetChapters', 'writingRules'],
  worldbuild: ['worldSettings'],
  character_design: ['characters'],
  volume_outline: ['volumes'],
  chapter_outline: ['chapters'],
}

function findBestJsonBlock(aiResponse: string, stage: string): string | null {
  const greedyMatches = [...aiResponse.matchAll(/```(?:json)?\s*([\s\S]*)```/g)]

  if (greedyMatches.length === 0) {
    return null
  }

  const stageFields = STAGE_FIELD_MAP[stage] || []

  for (let i = greedyMatches.length - 1; i >= 0; i--) {
    const content = greedyMatches[i][1].trim()

    if (stageFields.length > 0 && stageFields.some(field => content.includes(`"${field}"`))) {
      return content
    }
  }

  return greedyMatches[greedyMatches.length - 1][1].trim()
}

interface VolumeRaw {
  title: string
  targetWordCount?: number
  targetChapterCount?: number
  eventLine?: string[]
  [key: string]: unknown
}

export function extractStructuredData(
  aiResponse: string,
  stage: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _currentData: WorkshopExtractedData
): WorkshopExtractedData {
  const newData: WorkshopExtractedData = {}

  const jsonContent = findBestJsonBlock(aiResponse, stage)

  if (!jsonContent) {
    console.warn('[workshop/extract] 未找到 JSON 代码块, stage:', stage, '| 回复长度:', aiResponse.length)
    return newData
  }

  try {
    const parsed = safeParseJSON(jsonContent) as Record<string, unknown>

    switch (stage) {
      case 'concept':
        if (parsed.title) newData.title = parsed.title as string
        if (parsed.genre) newData.genre = parsed.genre as string
        if (parsed.description) newData.description = parsed.description as string
        if (parsed.coreAppeal) newData.coreAppeal = parsed.coreAppeal as string[]
        if (parsed.targetWordCount) newData.targetWordCount = parsed.targetWordCount as string
        if (parsed.targetChapters) newData.targetChapters = parsed.targetChapters as string
        if (parsed.writingRules) newData.writingRules = parsed.writingRules as Array<{ category: string; title: string; content: string; priority?: number }>
        break

      case 'worldbuild':
        if (parsed.worldSettings) newData.worldSettings = parsed.worldSettings as Array<{ type: string; title: string; content: string; importance?: string }>
        break

      case 'character_design':
        if (parsed.characters) newData.characters = parsed.characters as Array<{ name: string; role: string; description: string; aliases?: string[]; powerLevel?: string; attributes?: Record<string, unknown>; relationships?: string[] }>
        break

      case 'volume_outline':
        if (parsed.volumes) {
          const validatedVolumes = (parsed.volumes as VolumeRaw[]).map((vol) => {
            const PER_CHAPTER_MIN = 3000
            const PER_CHAPTER_MAX = 5000

            if (vol.targetWordCount && vol.targetChapterCount) {
              const expectedChapters = Math.round(vol.targetWordCount / ((PER_CHAPTER_MIN + PER_CHAPTER_MAX) / 2))
              if (Math.abs(vol.targetChapterCount - expectedChapters) > expectedChapters * 0.3) {
                vol.targetChapterCount = expectedChapters
              }
            } else if (vol.targetWordCount && !vol.targetChapterCount) {
              vol.targetChapterCount = Math.round(vol.targetWordCount / ((PER_CHAPTER_MIN + PER_CHAPTER_MAX) / 2))
            } else if (vol.targetChapterCount && !vol.targetWordCount) {
              vol.targetWordCount = vol.targetChapterCount * ((PER_CHAPTER_MIN + PER_CHAPTER_MAX) / 2)
            }

            if (vol.eventLine && Array.isArray(vol.eventLine) && vol.targetChapterCount) {
              if (vol.eventLine.length !== vol.targetChapterCount) {
                console.warn(`[workshop] 卷"${vol.title}" eventLine 条数(${vol.eventLine.length})与 targetChapterCount(${vol.targetChapterCount})不符，已校正`)
                vol.eventLine = vol.eventLine.slice(0, vol.targetChapterCount)
              }
            }

            return vol
          })
          newData.volumes = validatedVolumes as typeof newData.volumes
        }
        break

      case 'chapter_outline':
        if (parsed.chapters) newData.chapters = parsed.chapters as Array<{ title: string; outline: string; summary?: string; characters?: string[]; foreshadowingActions?: Array<{ action: string; target: string; description: string }>; keyScenes?: string[] }>
        break
    }
  } catch (e) {
    console.error('[workshop/extract] JSON 解析失败, stage:', stage, '| 错误:', (e as Error).message, '| JSON内容长度:', jsonContent.length, '| 前200字符:', jsonContent.slice(0, 200))

    if (stage === 'volume_outline') {
      const openBraceCount = (jsonContent.match(/\{/g) || []).length
      const closeBraceCount = (jsonContent.match(/\}/g) || []).length
      const openBracketCount = (jsonContent.match(/\[/g) || []).length
      const closeBracketCount = (jsonContent.match(/\]/g) || []).length
      console.error('[workshop/extract] 卷纲 JSON 括号不匹配:', {
        '{': openBraceCount, '}': closeBraceCount,
        '[': openBracketCount, ']': closeBracketCount,
        '可能截断': openBraceCount !== closeBraceCount || openBracketCount !== closeBracketCount,
        '末尾100字符': jsonContent.slice(-100),
      })
    }
  }

  return newData
}
