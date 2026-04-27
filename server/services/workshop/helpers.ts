/**
 * @file workshop/helpers.ts
 * @description 创作工坊 - 辅助函数
 */
import { drizzle } from 'drizzle-orm/d1'
import type { Env } from '../../lib/types'
import { resolveConfig } from '../llm'
import type { WorkshopExtractedData } from './types'

export async function buildOutlineContentWithAI(
  env: Env,
  data: WorkshopExtractedData
): Promise<string> {
  const { streamGenerate } = await import('../llm')

  let llmConfig: any
  try {
    llmConfig = await resolveConfig(drizzle(env.DB), 'workshop', '')
    llmConfig.apiKey = llmConfig.apiKey || ''
  } catch {
    console.warn('[workshop] buildOutlineContentWithAI 无法获取模型配置，使用 fallback')
    return buildOutlineContent(data)
  }

  const briefData = {
    title: data.title,
    genre: data.genre,
    description: data.description,
    coreAppeal: data.coreAppeal,
    targetWordCount: data.targetWordCount,
    targetChapters: data.targetChapters,
    characters: data.characters?.filter(c => c.role === 'protagonist' || c.role === 'antagonist')
      .map(c => ({ name: c.name, role: c.role, description: c.description })),
    volumes: data.volumes?.map((v, i) => ({
      index: i + 1,
      title: v.title,
      summary: v.summary,
      targetChapterCount: v.targetChapterCount,
    })),
    writingRules: data.writingRules?.filter(r => (r.priority ?? 3) <= 2)
      .map(r => ({ title: r.title, content: r.content })),
  }

  function calcOutlineRange(targetWc: string | undefined): string {
    const wc = parseInt(targetWc || '0', 10)
    if (!wc || wc < 50) return '800-1200'
    if (wc < 100) return '1200-2000'
    if (wc < 200) return '2000-3500'
    if (wc < 400) return '3500-5500'
    return '5500-8000'
  }
  const outlineRange = calcOutlineRange(data.targetWordCount)

  return new Promise(async (resolve) => {
    let fullText = ''
    try {
      await streamGenerate(
        llmConfig,
        [
          {
            role: 'system',
            content: '你是专业的小说策划编辑，擅长将创作素材整合为简洁有力的总纲文档。只输出总纲正文，不加JSON或代码块标记。',
          },
          {
            role: 'user',
            content: `基于以下创作数据，生成一份${outlineRange}字的小说总纲。
总纲需要体现：1）故事的核心吸引力；2）主角的成长弧线；3）各卷之间的承接逻辑；4）创作边界约束。
用叙事性文字组织，不要机械罗列。

数据：\n${JSON.stringify(briefData, null, 2)}`,
          },
        ],
        {
          onChunk: (text) => {
            fullText += text
          },
          onDone: () => {
            resolve(fullText || buildOutlineContent(data))
          },
          onError: (err) => {
            console.warn('[workshop] AI生成总纲失败，使用 fallback:', err)
            resolve(buildOutlineContent(data))
          },
        }
      )
    } catch (err) {
      console.warn('[workshop] AI生成总纲失败，使用 fallback:', err)
      resolve(buildOutlineContent(data))
    }
  })
}

export function buildOutlineContent(data: WorkshopExtractedData): string {
  const parts: string[] = []

  if (data.description) parts.push(`## 简介\n${data.description}`)
  if (data.coreAppeal?.length) parts.push(`## 核心看点\n${data.coreAppeal.join('\n')}`)
  if (data.writingRules?.length) {
    parts.push('## 创作规则')
    data.writingRules.forEach(rule => parts.push(`### ${rule.title}\n${rule.content}`))
  }
  if (data.worldSettings?.length) {
    parts.push('## 世界观设定')
    data.worldSettings.forEach(ws => parts.push(`### ${ws.title}\n${ws.content}`))
  }
  if (data.characters?.length) {
    parts.push('## 主要角色')
    data.characters.forEach(char => parts.push(`### ${char.name}\n${char.description}`))
  }
  if (data.volumes?.length) {
    parts.push('## 分卷大纲')
    data.volumes.forEach((vol, idx) => parts.push(`### 第${idx + 1}卷：${vol.title}\n${vol.summary || '暂无概述'}`))
  }

  return parts.join('\n\n')
}
