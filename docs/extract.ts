/**
 * @file workshop/extract.ts
 * @description 创作工坊 - 数据提取
 *
 * safeParseJSON：先尝试直接 JSON.parse，失败则修复字符串内真实换行后重试。
 * extractVolumesRobust：当 JSON.parse 仍失败时（AI 生成的 blueprint 等字段
 * 含未转义双引号导致结构破损），用状态机逐字段提取，完全绕过 JSON.parse。
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

/** 从 pos 开始提取一个 JSON 字符串值（pos 指向开头引号） */
function extractStringValue(str: string, pos: number): { value: string; end: number } | null {
  if (str[pos] !== '"') return null
  let i = pos + 1
  let result = ''
  while (i < str.length) {
    const ch = str[i]
    if (ch === '\\') {
      const next = str[i + 1]
      if (next === 'n') { result += '\n'; i += 2; continue }
      if (next === 'r') { result += '\r'; i += 2; continue }
      if (next === 't') { result += '\t'; i += 2; continue }
      if (next === '"') { result += '"'; i += 2; continue }
      if (next === '\\') { result += '\\'; i += 2; continue }
      result += next; i += 2; continue
    }
    if (ch === '"') return { value: result, end: i + 1 }
    // 真实换行也接受（容错）
    if (ch === '\n' || ch === '\r') { result += ch; i++; continue }
    result += ch
    i++
  }
  return null
}

/** 从 pos 开始提取字符串数组 */
function extractStringArray(str: string, pos: number): { value: string[]; end: number } {
  if (str[pos] !== '[') return { value: [], end: pos }
  let i = pos + 1
  const result: string[] = []
  while (i < str.length) {
    while (i < str.length && ' \n\r\t,'.includes(str[i])) i++
    if (str[i] === ']') return { value: result, end: i + 1 }
    if (str[i] === '"') {
      const r = extractStringValue(str, i)
      if (!r) break
      result.push(r.value)
      i = r.end
    } else {
      i++
    }
  }
  return { value: result, end: i }
}

/** 找字段名后的值起始位置（跳过 ": " 等） */
function findFieldValueStart(str: string, searchFrom: number, fieldName: string): number {
  const pattern = `"${fieldName}"`
  const idx = str.indexOf(pattern, searchFrom)
  if (idx === -1) return -1
  let i = idx + pattern.length
  while (i < str.length && ' \n\r\t:'.includes(str[i])) i++
  return i
}

/** 当 JSON.parse 失败时，用状态机逐字段提取 volumes 数组（容忍 blueprint 等字段的结构损坏） */
function extractVolumesRobust(jsonStr: string): WorkshopExtractedData['volumes'] {
  const volArrayIdx = jsonStr.indexOf('"volumes"')
  if (volArrayIdx === -1) return undefined

  let i = volArrayIdx + '"volumes"'.length
  while (i < jsonStr.length && jsonStr[i] !== '[') i++
  i++ // 跳过 [

  const volumes: NonNullable<WorkshopExtractedData['volumes']> = []

  while (i < jsonStr.length) {
    while (i < jsonStr.length && ' \n\r\t,'.includes(jsonStr[i])) i++
    if (jsonStr[i] === ']') break
    if (jsonStr[i] !== '{') { i++; continue }

    const volStart = i
    const vol: Record<string, unknown> = {}

    // 字符串字段
    for (const field of ['title', 'summary', 'blueprint'] as const) {
      const fp = findFieldValueStart(jsonStr, volStart, field)
      if (fp > 0 && fp < volStart + 30000 && jsonStr[fp] === '"') {
        const r = extractStringValue(jsonStr, fp)
        if (r) vol[field] = r.value
      }
    }

    // 字符串数组字段
    for (const field of ['eventLine', 'notes', 'foreshadowingSetup', 'foreshadowingResolve'] as const) {
      const fp = findFieldValueStart(jsonStr, volStart, field)
      if (fp > 0 && fp < volStart + 300000 && jsonStr[fp] === '[') {
        const r = extractStringArray(jsonStr, fp)
        vol[field] = r.value
      }
    }

    // 数字字段
    for (const field of ['targetWordCount', 'targetChapterCount'] as const) {
      const fp = findFieldValueStart(jsonStr, volStart, field)
      if (fp > 0 && fp < volStart + 30000) {
        const m = jsonStr.slice(fp, fp + 20).match(/^(\d+)/)
        if (m) vol[field] = parseInt(m[1])
      }
    }

    volumes.push(vol as NonNullable<WorkshopExtractedData['volumes']>[number])

    // 推进 i：跳到 targetChapterCount 值之后，再找下一个 {
    const tcFp = findFieldValueStart(jsonStr, volStart, 'targetChapterCount')
    if (tcFp > 0) {
      const m = jsonStr.slice(tcFp, tcFp + 20).match(/^(\d+)/)
      i = tcFp + (m ? m[0].length : 5)
    } else {
      i = volStart + 500
    }
  }

  return volumes.length > 0 ? volumes : undefined
}

export function extractStructuredData(
  aiResponse: string,
  stage: string,
  currentData: WorkshopExtractedData
): WorkshopExtractedData {
  const newData: WorkshopExtractedData = {}

  const allJsonMatches = [...aiResponse.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)]
  const jsonMatch = allJsonMatches.length > 0 ? allJsonMatches[allJsonMatches.length - 1] : null
  if (!jsonMatch) return newData

  const rawBlock = jsonMatch[1].trim()
  let parsed: Record<string, unknown> | null = null

  try {
    parsed = safeParseJSON(rawBlock) as Record<string, unknown>
  } catch {
    // JSON 结构损坏，对 volume_outline 阶段用逐字段提取兜底
    if (stage === 'volume_outline') {
      const volumes = extractVolumesRobust(rawBlock)
      if (volumes) newData.volumes = volumes
    }
    return newData
  }

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

  return newData
}
