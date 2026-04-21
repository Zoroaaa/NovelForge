/**
 * NovelForge · 境界/成长体系追踪服务（Phase 1.3）
 *
 * 功能：
 * - 章节生成完成后自动检测境界突破事件
 * - 自动更新角色的 powerLevel 字段
 * - 提供境界管理 API 支持
 */

import { drizzle } from 'drizzle-orm/d1'
import { characters, chapters } from '../db/schema'
import { eq, and } from 'drizzle-orm'
import type { Env } from '../lib/types'
import { resolveConfig } from './llm'

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
      detectionConfig = await resolveConfig(db, 'summary_gen', novelId)
      detectionConfig.apiKey = detectionConfig.apiKey || (env as any)[detectionConfig.apiKeyEnv || 'VOLCENGINE_API_KEY'] || ''
    } catch {
      detectionConfig = {
        provider: 'volcengine',
        modelId: 'doubao-lite-32k',
        apiBase: 'https://ark.cn-beijing.volces.com/api/v3',
        apiKey: (env as any).VOLCENGINE_API_KEY || '',
        params: { temperature: 0.3, max_tokens: 2000 },
      }
    }

    // 构建提示词
    const detectionPrompt = `你是一个专业的小说境界分析助手。请分析以下小说章节内容，检测主角是否发生了境界突破或实力提升。

【章节标题】：《${chapter.title}》

【主角当前境界信息】：
${characterPowerInfo}

【正文内容】（前3000字）：
${chapter.content.slice(0, 3000)}

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
    const base = detectionConfig.apiBase || getDefaultBase(detectionConfig.provider)
    const resp = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${detectionConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: detectionConfig.modelId,
        messages: [
          { role: 'system', content: '你是一个JSON生成助手，只输出JSON，不要其他内容。' },
          { role: 'user', content: detectionPrompt },
        ],
        stream: false,
        temperature: detectionConfig.params?.temperature ?? 0.3,
        max_tokens: detectionConfig.params?.max_tokens ?? 2000,
      }),
    })

    if (!resp.ok) {
      throw new Error(`Power level detection API error: ${resp.status}`)
    }

    const result = await resp.json() as any
    const content = result.choices?.[0]?.message?.content || '{}'

    // 解析 JSON 结果
    let parsed: { hasBreakthrough: boolean; updates: Array<any> }
    try {
      parsed = JSON.parse(content)
    } catch (parseError) {
      console.warn('Failed to parse power level detection result:', parseError)
      return { hasBreakthrough: false, updates: [] }
    }

    if (!parsed.hasBreakthrough || !parsed.updates || parsed.updates.length === 0) {
      return { hasBreakthrough: false, updates: [] }
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
    return { hasBreakthrough: finalUpdates.length > 0, updates: finalUpdates }
  } catch (error) {
    console.error('Power level detection failed:', error)
    return { hasBreakthrough: false, updates: [] }
  }
}

function getDefaultBase(provider: string): string {
  switch (provider) {
    case 'volcengine':
      return 'https://ark.cn-beijing.volces.com/api/v3'
    case 'anthropic':
      return 'https://api.anthropic.com/v1'
    case 'openai':
      return 'https://api.openai.com/v1'
    default:
      return 'https://ark.cn-beijing.volces.com/api/v3'
  }
}
