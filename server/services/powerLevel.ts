/**
 * @file powerLevel.ts
 * @description 境界/成长体系追踪服务模块，提供境界突破检测和角色成长管理功能
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { drizzle } from 'drizzle-orm/d1'
import { characters, chapters } from '../db/schema'
import { eq, and } from 'drizzle-orm'
import type { Env } from '../lib/types'
import { resolveConfig, generateWithMetrics } from './llm'
import type { LLMCallResult } from './llm'
import { enqueue } from '../lib/queue'

export interface PowerLevelData {
  system: string           // 境界体系名称（如"修仙境界"）
  current: string          // 当前境界（如"金丹期初期"）
  breakthroughs: Array<{
    chapterId: string
    from: string           // 突破前境界
    to: string             // 突破后境界
    note?: string          // 突破说明
    timestamp?: number     // 突破时间戳
  }>
  nextMilestone?: string   // 下一阶段目标
}

export interface PowerLevelDetectionResult {
  hasBreakthrough: boolean
  updates: Array<{
    characterId: string
    characterName: string
    previousPowerLevel?: PowerLevelData
    newPowerLevel: PowerLevelData
    breakthroughNote?: string
  }>
  metrics?: LLMCallResult
}

/**
 * 从章节内容中自动检测境界突破事件
 * 使用轻量模型分析章节内容，识别角色是否发生了境界提升/突破
 */
export async function detectPowerLevelBreakthrough(
  env: Env,
  chapterId: string,
  novelId: string
): Promise<PowerLevelDetectionResult> {
  const db = drizzle(env.DB)

  try {
    // 获取章节内容
    const chapter = await db
      .select({
        title: chapters.title,
        content: chapters.content,
      })
      .from(chapters)
      .where(eq(chapters.id, chapterId))
      .get()

    if (!chapter?.content) {
      console.log('No content to detect power level breakthrough')
      return { hasBreakthrough: false, updates: [] }
    }

    // 获取小说的所有主角角色及其当前境界
    const protagonists = await db
      .select({
        id: characters.id,
        name: characters.name,
        role: characters.role,
        powerLevel: characters.powerLevel,
        description: characters.description,
      })
      .from(characters)
      .where(
        and(
          eq(characters.novelId, novelId),
          eq(characters.role, 'protagonist')
        )
      )
      .all()

    if (protagonists.length === 0) {
      return { hasBreakthrough: false, updates: [] }
    }

    // 构建当前角色境界信息文本
    const characterPowerInfo = protagonists.map(p => {
      let info = `- ${p.name}`
      if (p.powerLevel) {
        try {
          const powerData = JSON.parse(p.powerLevel)
          info += `：${powerData.system || '未知体系'} - 当前${powerData.current || '未知'}`
        } catch {
          info += '：无境界信息'
        }
      } else {
        info += '：无境界信息'
      }
      return info
    }).join('\n')

    // 解析模型配置
    let detectionConfig
    try {
      detectionConfig = await resolveConfig(db, 'analysis', novelId)
      detectionConfig.apiKey = detectionConfig.apiKey || ''
    } catch (error) {
      throw new Error(`❌ 未配置"智能分析"模型！请在全局配置中设置 analysis 阶段的模型（用于境界检测、伏笔提取等分析任务）`)
    }

    // 构建提示词
    const detectionPrompt = `你是一个专业的小说境界分析助手。请分析以下小说章节内容，检测主角是否发生了境界突破或实力提升。

【章节标题】：《${chapter.title}》

【主角当前境界信息】：
${characterPowerInfo}

【正文内容】（前8000字）：
${chapter.content.slice(0, 8000)}

请以JSON格式输出检测结果（不要输出其他内容）：
{
  "hasBreakthrough": true/false,
  "updates": [
    {
      "characterName": "角色名",
      "characterId": "角色ID",
      "system": "境界体系名称（如'修仙境界'、'斗气等级'等）",
      "current": "新的当前境界（如'金丹期初期'）",
      "previousLevel": "突破前的境界（如未提及则留空）",
      "breakthroughNote": "突破过程简述（50字以内）"
    }
  ]
}

判断标准：
1. 境界突破：明确描述了角色实力提升、突破瓶颈、进阶等情节
2. 实力变化：获得了新的能力、技能、装备等实质性提升
3. 如果本章没有任何角色的境界/实力变化，hasBreakthrough 为 false，updates 为空数组

注意：只报告明确的境界突破，模糊的暗示不算。`

    // 调用 LLM 进行检测
    const overrideConfig = {
      ...detectionConfig,
      params: { ...(detectionConfig.params || {}), temperature: 0.3, max_tokens: 2000 },
    }

    const detectionMetrics = await generateWithMetrics(overrideConfig, [
      { role: 'system', content: '你是一个JSON生成助手，只输出JSON，不要其他内容。' },
      { role: 'user', content: detectionPrompt },
    ])

    let parsed: { hasBreakthrough: boolean; updates: Array<any> } = { hasBreakthrough: false, updates: [] }
    try {
      parsed = JSON.parse(detectionMetrics.text)
    } catch (parseError) {
      console.warn('[PowerLevel] JSON parse failed, raw content:', detectionMetrics.text.slice(0, 500))
      return { hasBreakthrough: false, updates: [], metrics: detectionMetrics }
    }

    if (!parsed.hasBreakthrough || !parsed.updates || parsed.updates.length === 0) {
      return { hasBreakthrough: false, updates: [], metrics: detectionMetrics }
    }

    // 处理检测结果并更新数据库
    const finalUpdates: PowerLevelDetectionResult['updates'] = []

    for (const update of parsed.updates) {
      try {
        // 查找对应的角色
        const targetCharacter = protagonists.find(p =>
          p.name === update.characterName || p.id === update.characterId
        )

        if (!targetCharacter) {
          console.warn(`Character not found: ${update.characterName} (${update.characterId})`)
          continue
        }

        // 解析现有境界数据
        let previousPowerLevel: PowerLevelData | undefined
        let newPowerLevel: PowerLevelData

        if (targetCharacter.powerLevel) {
          try {
            previousPowerLevel = JSON.parse(targetCharacter.powerLevel) as PowerLevelData
            newPowerLevel = { ...previousPowerLevel, system: previousPowerLevel.system || '未知体系' }
          } catch {
            newPowerLevel = {
              system: update.system || '未知体系',
              current: update.current || '未知',
              breakthroughs: [],
            }
          }
        } else {
          newPowerLevel = {
            system: update.system || '未知体系',
            current: update.current || '未知',
            breakthroughs: [],
          }
        }

        // 更新当前境界
        newPowerLevel.current = update.current || newPowerLevel.current
        if (update.system) {
          newPowerLevel.system = update.system
        }

        // 添加突破记录
        if (update.previousLevel && update.previousLevel !== newPowerLevel.current) {
          newPowerLevel.breakthroughs.push({
            chapterId,
            from: update.previousLevel,
            to: update.current,
            note: update.breakthroughNote,
            timestamp: Date.now(),
          })
        }

        // 更新数据库
        await db
          .update(characters)
          .set({
            powerLevel: JSON.stringify(newPowerLevel),
          })
          .where(eq(characters.id, targetCharacter.id))

        // B5修复: 境界突破后重新向量化角色，确保RAG能检索到最新的境界信息
        if (env.TASK_QUEUE) {
          const indexText = `${targetCharacter.name}${targetCharacter.role ? ` (${targetCharacter.role})` : ''}\n${(targetCharacter.description || '').slice(0, 300)}`
          await enqueue(env, {
            type: 'index_content',
            payload: {
              sourceType: 'character',
              sourceId: targetCharacter.id,
              novelId,
              title: targetCharacter.name,
              content: indexText,
            },
          })
        }

        console.log(`✅ Power level updated for ${update.characterName}: ${update.previousLevel || '?'} → ${update.current}`)

        finalUpdates.push({
          characterId: targetCharacter.id,
          characterName: update.characterName,
          previousPowerLevel,
          newPowerLevel,
          breakthroughNote: update.breakthroughNote,
        })
      } catch (updateError) {
        console.warn('Failed to update power level for character:', updateError)
      }
    }

    console.log(`⚡ Power level detection complete: ${finalUpdates.length} breakthroughs detected`)
    return { hasBreakthrough: finalUpdates.length > 0, updates: finalUpdates, metrics: detectionMetrics }
  } catch (error) {
    console.error('Power level detection failed:', error)
    return { hasBreakthrough: false, updates: [] }
  }
}


