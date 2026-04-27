/**
 * @file workshop/extract.ts
 * @description 创作工坊 - 数据提取
 */
import type { WorkshopExtractedData } from './types'

export function safeParseJSON(raw: string): unknown {
  try { return JSON.parse(raw) } catch {}
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
  return JSON.parse(result)
}

export function extractStructuredData(
  aiResponse: string,
  stage: string,
  currentData: WorkshopExtractedData
): WorkshopExtractedData {
  const newData: WorkshopExtractedData = {}

  const allJsonMatches = [...aiResponse.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)]

  const jsonMatch = allJsonMatches.length > 0 ? allJsonMatches[allJsonMatches.length - 1] : null
  if (jsonMatch) {
    try {
      const parsed = safeParseJSON(jsonMatch[1].trim()) as Record<string, unknown>

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
            const validatedVolumes = (parsed.volumes as Array<any>).map((vol: any) => {
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
    }
  } else {
  }

  return newData
}
