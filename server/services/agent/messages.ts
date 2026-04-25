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
- queryOutline：查询大纲（世界观、卷纲、章节大纲）
- queryCharacter：查询角色信息
- searchSemantic：语义搜索相关历史内容

注意：
1. 资料包中已有的信息无需再调用工具
2. 工具调用应简洁明确，一次一个
3. 不要在正文中包含工具调用的 JSON 标记`

// ============================================================
// 核心创作原则（所有流派共享）
// ============================================================
const CORE_CREATION_PRINCIPLES = `【核心创作原则——必须严格遵守】
用户消息中会提供本章的创作资料包，包含总纲、卷蓝图、角色卡、世界设定、伏笔列表等。
这些资料是你创作的唯一权威依据，优先级高于你自身的任何推断或补全：
1. 角色的境界、姓名、性格、能力必须与角色卡完全一致，不得自行发明或升级
2. 世界设定（修炼体系、地理、势力）必须与设定资料完全一致
3. 未收尾伏笔若本章未明确要求回收，不得擅自处理
4. 前章摘要描述的结尾状态即为本章开头的起点，必须自然衔接
5. 创作规则中的禁忌写法一律不得出现`

// ============================================================
// 各流派 System Prompt
// ============================================================
const SYSTEM_PROMPTS: Record<string, string> = {
  fantasy: `你是一位专业的玄幻/仙侠小说作家。

${CORE_CREATION_PRINCIPLES}

你的写作风格：
- 文笔流畅，节奏紧凑，张弛有度
- 善用对话推动情节，避免无效叙述堆砌
- 注重场景描写和氛围营造，打斗场面清晰有力
- 每章结尾留有悬念或钩子
- 人物性格鲜明，行为符合设定，不随意降智
${TOOL_GUIDE}`,

  urban: `你是一位专业的都市小说作家。

${CORE_CREATION_PRINCIPLES}

你的写作风格：
- 贴近现实，代入感强，细节真实可信
- 人物心理描写细腻，内心活动自然流露
- 情节节奏明快，冲突激烈，矛盾层层递进
- 对话生活化，富有幽默感，符合人物身份
- 每章结尾留有悬念或情感钩子
${TOOL_GUIDE}`,

  mystery: `你是一位专业的悬疑小说作家。

${CORE_CREATION_PRINCIPLES}

你的写作风格：
- 逻辑严密，伏笔巧妙，线索清晰不混乱
- 悬念迭起，扣人心弦，信息适度保留
- 场景描写有画面感，气氛营造到位
- 人物动机真实，行为符合心理逻辑
- 结局出人意料又在情理之中，不靠强行反转
${TOOL_GUIDE}`,

  scifi: `你是一位专业的科幻小说作家。

${CORE_CREATION_PRINCIPLES}

你的写作风格：
- 硬核科幻，设定严谨，科技细节自洽
- 宏大叙事与微观细节并重，不只堆砌概念
- 科技与人文思考结合，探讨人性与社会
- 想象力丰富，但有内在逻辑支撑
- 每章结尾留有思想性钩子或情节悬念
${TOOL_GUIDE}`,
}

// ============================================================
// 消息构建主函数
// ============================================================
export function buildMessages(
  chapterTitle: string,
  contextBundle: ContextBundle | null,
  options: GenerationOptions = {},
  systemPromptOverride?: string,
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const { mode = 'generate', existingContent, targetWords, issuesContext } = options

  // 解析 system prompt：key 命中预设则用预设，否则当作完整 prompt 直接使用，默认 fantasy
  const systemPrompt =
    systemPromptOverride && SYSTEM_PROMPTS[systemPromptOverride]
      ? SYSTEM_PROMPTS[systemPromptOverride]
      : (systemPromptOverride || SYSTEM_PROMPTS.fantasy)

  // ── 续写模式 ──────────────────────────────────────────────
  if (mode === 'continue' && existingContent) {
    const wordsTarget = targetWords || CHAPTER_GEN_DEFAULTS.CONTINUATION_WORD_COUNT_TARGET
    const wordsUpper = Math.min(wordsTarget + 1000, CHAPTER_GEN_DEFAULTS.CONTINUATION_WORD_COUNT_UPPER)
    return [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `${AGENT_LABELS.CONTINUATION_TASK}
请在以下已有内容的基础上继续创作，保持文风一致，情节自然衔接。

${AGENT_LABELS.EXISTING_CONTENT}
${existingContent}

要求：续写 ${wordsTarget}–${wordsUpper} 字，与前文衔接自然，情节发展合理，结尾留有悬念。`,
      },
    ]
  }

  // ── 重写模式 ──────────────────────────────────────────────
  if (mode === 'rewrite' && existingContent) {
    const issuesSection =
      issuesContext && issuesContext.length > 0
        ? `\n\n${AGENT_LABELS.ISSUES_TO_FIX}\n${issuesContext.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}\n\n请在改写时优先解决以上问题，同时保持核心情节不变。`
        : ''
    return [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `${AGENT_LABELS.REWRITE_TASK}
请对以下内容进行改写，可以调整叙事方式、丰富描写、优化节奏，但保持核心情节不变。

${AGENT_LABELS.CONTENT_TO_REWRITE}
${existingContent}
${issuesSection}
要求：改写后 ${CHAPTER_GEN_DEFAULTS.REWRITE_WORD_COUNT_MIN}–${CHAPTER_GEN_DEFAULTS.REWRITE_WORD_COUNT_MAX} 字，文笔更流畅，描写更丰富，节奏更紧凑。`,
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

  const userContent = `${AGENT_LABELS.CREATION_TASK}
请创作《${chapterTitle}》的正文内容，${CHAPTER_GEN_DEFAULTS.WORD_COUNT_MIN}–${CHAPTER_GEN_DEFAULTS.WORD_COUNT_MAX} 字。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${AGENT_LABELS.DATA_PACKAGE}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${contextText}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${AGENT_LABELS.FORCE_REQUIREMENTS}
1. 所有出场角色的姓名、境界、能力必须与上方"本章出场角色"卡片完全一致
2. 修炼体系、境界名称必须与"境界体系"设定完全一致，不得自造词汇
3. 本章开头必须自然承接"上一章回顾"中描述的结尾状态
4. 创作规则中标注的禁忌写法一律不得出现
5. 如有"待回收伏笔"，本章可以推进但不得擅自终结（除非大纲明确指示）

${AGENT_LABELS.WRITING_REQUIREMENTS}
- 字数：${CHAPTER_GEN_DEFAULTS.WORD_COUNT_MIN}–${CHAPTER_GEN_DEFAULTS.WORD_COUNT_MAX} 字
- 视角：第三人称有限视角
- 节奏：张弛有度，高潮前蓄势充分
- 结尾：留有钩子或悬念`

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ]
}
