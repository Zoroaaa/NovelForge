/**
 * @file messages.ts
 * @description Agent消息构建
 */
import type { ContextBundle } from '../contextBuilder'
import { assemblePromptContext } from '../contextBuilder'
import type { GenerationOptions } from './types'
import { AGENT_LABELS, CHAPTER_GEN_DEFAULTS } from './constants'

// ============================================================
// 各流派通用的工具使用规范（所有 preset 统一使用此文本）
// ============================================================
const TOOL_GUIDE = `
${AGENT_LABELS.TOOL_USAGE_GUIDE}
在正式创作前，如果资料包中某项信息不足，可以调用工具补充：
- searchChapterHistory：在历史章节摘要中检索关键词（确认道具/功法/地点首次出现、角色过去行为）
- queryCharacterByName：按名称精确查询角色完整卡片（资料包未包含的角色）
- queryForeshadowing：查询所有未收尾的伏笔列表（资料包只含高优先级伏笔）
- querySettingByName：按名称精确查询世界设定完整内容（资料包只有摘要时查细节）
- searchSemantic：语义模糊搜索（不知道确切名称时的兜底搜索）

注意：
1. 资料包中已有的信息无需再调用工具
2. 工具调用应简洁明确，一次一个
3. 不要在正文中包含工具调用的 JSON 标记`

// ============================================================
// 硬性约束——所有流派共享，优先级最高
// ============================================================
const HARD_CONSTRAINTS = `【硬性约束——以下任意一条违反即为生成失败，优先级高于一切】
A. 角色约束：所有出场角色的姓名、当前实力等级、说话方式必须与资料包"本章出场角色"完全一致，不得自造昵称或擅自改变角色状态
B. 设定约束：资料包"相关世界设定"中已有的等级名称、势力名称、地名、技能/功法名称必须严格沿用，不得创造变体；资料包中未涉及的设定允许合理自创，但不得与已有设定矛盾
C. 衔接约束：本章开头必须自然承接资料包"上一章回顾"的结尾状态，时间、地点、情绪不得跳变
D. 伏笔约束：资料包"待回收伏笔"中的伏笔，本章可推进但不得无故终结；未列出的伏笔不得擅自回收
E. 规则约束：资料包"创作规则"中所有条目的禁止行为一律不得出现
F. 情感约束：角色的情感变化必须有上下文铺垫，不得发生未经剧情支撑的情感突变（如上一章刚结怨、本章突然无条件信任）
G. 动机约束：角色的所有行为必须符合其当前动机和立场，不得因剧情需要做出违背人设的不合理行为（如反派突然无故帮助主角）
H. 成长约束：禁止无铺垫的跳跃式实力提升；角色成长必须有合理的过程描写，具体形式依题材而定（如修炼积累、训练突破、战斗感悟、科技升级……），不得凭空发生
I. 单章约束：同一角色在一章内的重大实力突破不超过1次；如有连续突破，必须有明确的剧情支撑和前文铺垫，不得堆砌`

// ============================================================
// 字数要求计算
// ============================================================
function getWordCountRequirement(rhythmStats: ContextBundle['core']['rhythmStats']): { min: number; max: number } {
  if (rhythmStats?.volumeTargetWordCount && rhythmStats?.volumeTargetChapterCount && rhythmStats.volumeTargetChapterCount > 0) {
    const avg = Math.round(rhythmStats.volumeTargetWordCount / rhythmStats.volumeTargetChapterCount)
    return { min: Math.max(1000, avg - 600), max: avg + 600 }
  }
  return { min: CHAPTER_GEN_DEFAULTS.WORD_COUNT_MIN, max: CHAPTER_GEN_DEFAULTS.WORD_COUNT_MAX }
}

// ============================================================
// 消息构建主函数
// ============================================================
export function buildMessages(
  chapterTitle: string,
  contextBundle: ContextBundle | null,
  options: GenerationOptions = {},
  _systemPromptOverride?: string,
  novelSystemNote?: string,
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const { mode = 'generate', existingContent, targetWords, issuesContext } = options

  const genreStyleGuide = novelSystemNote || ''
  const systemPrompt = genreStyleGuide
    ? `你是一位专业的网文小说作家，正在创作一部长篇连载作品的某一章节。

${genreStyleGuide}

${HARD_CONSTRAINTS}
${TOOL_GUIDE}`
    : `你是一位专业的网文小说作家，正在创作一部长篇连载作品的某一章节。

${HARD_CONSTRAINTS}

【写作风格指导】
- 第三人称有限视角，聚焦于本章核心人物的感知和行动
- 对话：不同角色的说话方式必须有差异，符合其身份和性格（参见角色卡的 speechPattern）
- 节奏：张弛有度，高潮前需要充分蓄势，不得突然跳到结果
- 章末：必须留有悬念、钩子或情绪余韵，不得以"一切归于平静"收尾
- 关键场景：写出足够的过程细节，不得用省略式写法跳过冲突核心
- 禁止：无铺垫的主角转机；降智化的对手；结果替代过程的省略写法
${TOOL_GUIDE}`

  // ── 续写模式 ──────────────────────────────────────────────
  if (mode === 'continue' && existingContent) {
    const wordsTarget = targetWords || CHAPTER_GEN_DEFAULTS.CONTINUATION_WORD_COUNT_TARGET
    const wordsUpper = Math.min(wordsTarget + 1000, CHAPTER_GEN_DEFAULTS.CONTINUATION_WORD_COUNT_UPPER)

    const continuationConstraints = contextBundle
      ? `\n\n【续写约束——来自创作资料包】\n${assemblePromptContext(contextBundle, { slotFilter: ['protagonist', 'characters', 'rules', 'currentEvent', 'nextThreeChapters', 'foreshadowing', 'summaryChain'] })}`
      : ''

    return [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `${AGENT_LABELS.CONTINUATION_TASK}
请在以下已有内容的基础上继续创作《${chapterTitle}》，保持文风一致，情节自然衔接。

${AGENT_LABELS.EXISTING_CONTENT}
${existingContent}
${continuationConstraints}

续写要求：
- 字数：${wordsTarget}–${wordsUpper} 字
- 与前文衔接自然，不重复前文内容
- 人物行为和实力描写必须与角色卡一致
- 结尾留有悬念（除非这是本章的完整结尾）
- 直接续写正文，不要输出任何说明`,
      },
    ]
  }

  // ── 重写模式 ──────────────────────────────────────────────
  if (mode === 'rewrite' && existingContent) {
    const issueSection = issuesContext?.length
      ? `\n【本次改写需要重点解决的问题】\n${issuesContext.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}`
      : ''
    const wordReq = getWordCountRequirement(contextBundle?.core.rhythmStats ?? null)

    const rewriteConstraints = contextBundle
      ? `\n【改写约束——来自创作资料包】\n${assemblePromptContext(contextBundle, { slotFilter: ['protagonist', 'characters', 'rules', 'worldSettings', 'currentEvent', 'foreshadowing', 'summaryChain'] })}`
      : ''

    return [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `${AGENT_LABELS.REWRITE_TASK}
请对以下章节《${chapterTitle}》进行改写。
${issueSection}
${rewriteConstraints}

【改写边界——必须遵守】
✅ 可以改变：叙述方式、描写细节、对话措辞、场景顺序、节奏把控
❌ 不得改变：核心情节走向、角色境界和姓名、本章的起点状态和终点状态、已有的伏笔操作

${AGENT_LABELS.CONTENT_TO_REWRITE}
${existingContent}

改写要求：
- 字数：${wordReq.min}–${wordReq.max} 字
- 优先解决上方"需要重点解决的问题"
- 直接输出完整改写正文，不要输出任何说明或对比`,
      },
    ]
  }

  // ── 无上下文的降级生成 ────────────────────────────────────
  if (!contextBundle) {
    return [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `请创作《${chapterTitle}》的正文内容。
要求：${CHAPTER_GEN_DEFAULTS.WORD_COUNT_MIN}–${CHAPTER_GEN_DEFAULTS.WORD_COUNT_MAX} 字，第三人称叙述，情节连贯。`,
      },
    ]
  }

  // ── 标准生成模式（带完整资料包）────────────────────────────
  const contextText = assemblePromptContext(contextBundle)
  const wordReq = getWordCountRequirement(contextBundle?.core.rhythmStats ?? null)

  const userContent = `${AGENT_LABELS.CREATION_TASK}
章节标题：《${chapterTitle}》
目标字数：${wordReq.min}–${wordReq.max} 字

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${AGENT_LABELS.DATA_PACKAGE}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${contextText}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${AGENT_LABELS.FORCE_REQUIREMENTS}
创作前请依次确认：
1. 【衔接确认】上一章回顾的结尾状态是什么？本章第一段如何自然承接？
2. 【角色确认】本章出场角色的当前实力状态和说话方式是否已对照角色卡？
3. 【设定确认】本章涉及的专有名称（等级/地名/技能/组织等），资料包中有则严格沿用，没有则可自创但不与已有设定矛盾
4. 【伏笔确认】待回收伏笔中，哪些可以在本章推进（不收尾）？
5. 【规则确认】创作规则中的禁忌，本章是否全部规避？

确认完毕后，直接开始创作正文，不要输出确认清单本身。

${AGENT_LABELS.WRITING_REQUIREMENTS}
- 字数：${wordReq.min}–${wordReq.max} 字（必须达到下限）
- 视角：第三人称有限视角
- 本章核心任务：完成卷蓝图中对应本章的情节推进，不得提前完成下章任务
- 结尾要求：留有钩子或悬念，为读者持续追更提供动力`

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ]
}