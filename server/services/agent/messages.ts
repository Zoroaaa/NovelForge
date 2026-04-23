/**
 * @file messages.ts
 * @description Agent消息构建
 */
import type { ContextBundle } from '../contextBuilder'
import { assemblePromptContext } from '../contextBuilder'
import type { GenerationOptions } from './types'

export function buildMessages(
  chapterTitle: string,
  contextBundle: ContextBundle | null,
  options: GenerationOptions = {},
  systemPromptOverride?: string
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const { mode = 'generate', existingContent, targetWords, issuesContext } = options
  const baseSystemPrompt = `你是一位专业的网络小说作家，擅长创作玄幻/仙侠类小说。

【核心创作原则——必须严格遵守】
用户消息中会提供本章的创作资料包，包含总纲、卷蓝图、角色卡、世界设定、伏笔列表等。
这些资料是你创作的唯一权威依据，优先级高于你自身的任何推断或补全：
1. 角色的境界、姓名、性格、能力必须与角色卡完全一致，不得自行发明或升级
2. 世界设定（修炼体系、地理、势力）必须与设定资料完全一致
3. 未收尾伏笔若本章未明确要求回收，不得擅自处理
4. 前章摘要描述的结尾状态即为本章开头的起点，必须自然衔接
5. 创作规则中的禁忌写法一律不得出现

你的写作风格：
- 文笔流畅，节奏紧凑
- 善用对话推动情节
- 注重场景描写和氛围营造
- 每章结尾留有悬念
- 人物性格鲜明，行为符合设定

【工具使用指南】
在正式创作前，如果资料包中某项信息不足，可以调用工具补充：
- queryOutline: 查询大纲（世界观、卷纲、章节大纲）
- queryCharacter: 查询角色信息
- searchSemantic: 语义搜索相关内容

注意：
1. 资料包中已有的信息无需再调用工具查询
2. 工具调用应简洁明确，一次一个
3. 不要在正文中包含工具调用的JSON标记`

  const presets: Record<string, string> = {
    fantasy: baseSystemPrompt,
    urban: `你是一位专业的都市小说作家。
你的写作风格：
- 贴近现实，代入感强
- 人物心理描写细腻
- 情节节奏明快，冲突激烈
- 对话生活化，富有幽默感

【重要：工具使用指南】
在正式创作前，如果你需要了解背景信息，可以调用工具获取资料。
可用工具：queryOutline / queryCharacter / searchSemantic
使用方式：{"name": "工具名", "arguments": {...}}`,
    mystery: `你是一位专业的悬疑小说作家。
你的写作风格：
- 逻辑严密，伏笔巧妙
- 悬念迭起，扣人心弦
- 场景描写有画面感
- 结局出人意料又在情理之中

【重要：工具使用指南】
在正式创作前，如果你需要了解背景信息，可以调用工具获取资料。
可用工具：queryOutline / queryCharacter / searchSemantic
使用方式：{"name": "工具名", "arguments": {...}}`,
    scifi: `你是一位专业的科幻小说作家。
你的写作风格：
- 硬核科幻，设定严谨
- 宏大叙事与微观细节并重
- 科技与人文思考结合
- 想象力丰富且有科学依据

【重要：工具使用指南】
在正式创作前，如果你需要了解背景信息，可以调用工具获取资料。
可用工具：queryOutline / queryCharacter / searchSemantic
使用方式：{"name": "工具名", "arguments": {...}}`,
  }

  const systemPrompt = systemPromptOverride && presets[systemPromptOverride]
    ? presets[systemPromptOverride]
    : (systemPromptOverride || baseSystemPrompt)

  if (mode === 'continue' && existingContent) {
    const wordsTarget = targetWords || 2000
    const wordsUpper = Math.min(wordsTarget + 1000, 8000)
    return [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `【续写任务】
请在以下已有内容的基础上继续创作，保持文风一致，情节自然衔接。

【已有内容】：
${existingContent}

要求：续写 ${wordsTarget}-${wordsUpper} 字，与前文衔接自然，情节发展合理。`,
      },
    ]
  }

  if (mode === 'rewrite' && existingContent) {
    const issuesSection = issuesContext && issuesContext.length > 0
      ? `\n\n【本次重写需要修复的问题】\n${issuesContext.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}\n\n请在改写时优先解决以上问题，同时保持核心情节不变。`
      : ''
    return [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `【重写任务】
请对以下内容进行改写，可以调整叙事方式、丰富描写、优化节奏，但保持核心情节不变。

【待改写内容】：
${existingContent}
${issuesSection}
要求：改写后 2000-3000 字，文笔更流畅，描写更丰富，节奏更紧凑。`,
      },
    ]
  }

  if (!contextBundle) {
    return [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `请创作《${chapterTitle}》的正文内容。
要求：3000-5000字，第三人称叙述，情节连贯。`,
      },
    ]
  }

  const contextText = assemblePromptContext(contextBundle)

  const userContent = `【创作任务】
请创作《${chapterTitle}》的正文内容，3000-5000字。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
以下是本章创作资料包，所有内容均为权威依据：
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${contextText}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【强制要求——违反任何一条即为创作失败】
1. 所有出场角色的姓名、境界、能力必须与上方"本章出场角色"卡片完全一致
2. 修炼体系、境界名称必须与"境界体系"设定完全一致，不得自造词汇
3. 本章开头必须自然承接"上一章回顾"中描述的结尾状态
4. 创作规则中标注的禁忌写法一律不得出现
5. 如有"待回收伏笔"，本章可以推进但不得擅自终结（除非大纲明确指示）

【写作要求】
- 字数：3000-5000字
- 视角：第三人称有限视角
- 节奏：张弛有度，高潮前蓄势充分
- 结尾：留有钩子或悬念`

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ]
}
