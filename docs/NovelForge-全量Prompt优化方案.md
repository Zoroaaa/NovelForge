# NovelForge Prompt 工程全量优化方案

> 覆盖范围：章节生成类 / 摘要总结类 / 检查分析类 / 下一章生成
> 创作工坊四阶段优化已有专项文档，本文不重复
> 所有改动均标注文件位置，可直接落地

---

## 一、问题全景

| 类别 | 文件 | 核心问题 |
|------|------|---------|
| 章节生成 system prompt | `messages.ts` | 风格描述与核心原则分离，模型易忽略 |
| 章节生成 user prompt | `messages.ts` | "强制要求"缺少正向引导，未给出每条约束的检查方式 |
| 续写/重写 | `messages.ts` | 续写未传入资料包；重写无结构，AI随意发挥 |
| 章节摘要 | `summarizer.ts` | 自由格式，信息密度低；max_tokens=500 不够 |
| 总纲摘要 | `summarizer.ts` | 无结构约束，摘要可能和章节摘要格式一样 |
| 卷摘要 | `summarizer.ts` | 无结构约束，blueprint+eventLine 直接输入无预处理 |
| 设定摘要 | `summarizer.ts` | 要求相对最好，但不同 type 的保留重点不同，没有按 type 区分 |
| 角色一致性检查 | `consistency.ts` | 角色信息只传了 description，缺 speechPattern/powerLevel；检查维度单薄 |
| 章节修复 | `consistency.ts` | 修复prompt无资料包，AI修复时无设定参考，可能引入新错误 |
| 卷进度检查 | `volumeProgress.ts` | 评估标准写死在 prompt 里，healthStatus 分级无法指导具体行动 |
| 伏笔提取 | `foreshadowing.ts` | importance 判断标准泛化，AI 什么都标 high；提取无现有伏笔数量上限提示 |
| 伏笔健康检查 | `foreshadowing.ts` | 把最近章节完整 content 塞入（8000字），token 浪费且信息冗余 |
| 伏笔推荐 | `foreshadowing.ts` | action 类型的判断标准模糊，reason 只要求50字不够指导创作 |
| 下一章生成 | `generation.ts` | 章节摘要要求150-200字，与正向生成时的摘要标准不统一 |
| 所有 JSON 输出 | 多文件 | system prompt 是"JSON生成助手"，表述过于简单，容易被忽略 |

---

## 二、章节生成类

### 2.1 System Prompt 重构（`messages.ts`）

**当前问题：** 核心原则是独立 const，在 system prompt 里是块文字拼接，和风格描述没有优先级区分。模型对 system 的注意力分配不均，靠前的内容权重更高，当前把风格描述放在前面、核心原则放在后面，优先级反了。

**优化原则：** 将"不可违反的硬约束"提到最前，风格描述在后，且用更精确的语言替代泛泛描述。

```typescript
// messages.ts — 完整替换 SYSTEM_PROMPTS

const HARD_CONSTRAINTS = `【硬性约束——以下任意一条违反即为生成失败，优先级高于一切】
A. 角色约束：所有出场角色的姓名、境界、说话方式必须与资料包"本章出场角色"完全一致，不得自造昵称或升降境界
B. 设定约束：境界名称、势力名称、地名、功法名称必须与资料包"相关世界设定"完全一致，不得创造变体
C. 衔接约束：本章开头必须自然承接资料包"上一章回顾"的结尾状态，时间、地点、情绪不得跳变
D. 伏笔约束：资料包"待回收伏笔"中的伏笔，本章可推进但不得无故终结；未列出的伏笔不得擅自回收
E. 规则约束：资料包"创作规则"中所有条目的禁止行为一律不得出现`

const SYSTEM_PROMPTS: Record<string, string> = {
  fantasy: `你是一位专业的玄幻/仙侠小说作家，正在创作一部长篇连载作品的某一章节。

${HARD_CONSTRAINTS}

【写作风格指导】
- 第三人称有限视角，聚焦于本章核心人物的感知和行动
- 战斗/对抗场景：必须写出境界差距带来的力量感，招式有名称，过程有逆转
- 对话：不同角色的说话方式必须有差异，符合其身份和性格（参见角色卡的 speechPattern）
- 节奏：张弛有度，高潮前需要充分蓄势，不得突然跳到结果
- 章末：必须留有悬念、钩子或情绪余韵，不得以"一切归于平静"收尾
- 描写密度：场景描写和心理活动穿插在情节推进中，不得集中堆砌
- 禁止：无铺垫的主角顿悟；无厘头的降智对手；"激烈交手后主角获胜"的省略写法`,

  urban: `你是一位专业的都市小说作家，正在创作一部长篇连载作品的某一章节。

${HARD_CONSTRAINTS}

【写作风格指导】
- 第三人称有限视角，贴近现实逻辑，细节真实可信
- 对话：生活化，幽默感自然流露，语气符合人物社会身份
- 冲突：矛盾层层递进，不得一步到位；情绪变化需要铺垫
- 心理描写：内心活动真实，不说教，不做总结性旁白
- 章末：情感钩子或悬念，让读者有"明天继续看"的冲动
- 禁止：金手指无铺垫出现；人物行为违背自身利益且无合理动机；大段背景说明打断节奏`,

  mystery: `你是一位专业的悬疑小说作家，正在创作一部长篇连载作品的某一章节。

${HARD_CONSTRAINTS}

【写作风格指导】
- 信息管控：每章只释放部分真相，引发新疑问的同时解答旧疑问
- 线索埋设：关键线索必须在文中有迹可循，不得事后凭空出现
- 氛围营造：紧张感靠细节堆积，不靠直接告诉读者"很恐怖"
- 逻辑严密：人物行为有心理依据，反派动机合理，不靠愚蠢推进情节
- 章末：必须留下一个新的疑点或危机，不得解答所有问题后平静收尾
- 禁止：强行反转（无铺垫）；主角因信息不对等犯低级错误；场景描写脱离气氛`,

  scifi: `你是一位专业的科幻小说作家，正在创作一部长篇连载作品的某一章节。

${HARD_CONSTRAINTS}

【写作风格指导】
- 科技细节自洽：任何技术描述必须符合小说设定的科技水平，不得引入设定外的概念
- 宏观与微观：宏大背景落地到具体人物的具体处境，不堆砌概念
- 人文思考：科技与人性的张力是科幻的核心，情节中隐含对人性/社会的追问
- 节奏：思想性与情节性并重，不因说理而停滞叙事
- 章末：思想性钩子或情节危机，二选一
- 禁止：设定外的科技手段解决问题；人物行为违背设定世界的常识`,
}
```

---

### 2.2 标准生成 User Prompt 重构（`messages.ts`）

**当前问题：**
- 强制要求5条都是"必须与XX一致"的禁止型描述，没有正向引导
- 写作要求列了字数/视角/节奏/结尾，但没有"本章核心任务"的明确定位
- AI 拿到资料包+任务后，不知道本章最重要的目标是什么

**优化后 user prompt：**

```typescript
// messages.ts — buildMessages 标准生成模式

const userContent = `${AGENT_LABELS.CREATION_TASK}
章节标题：《${chapterTitle}》
目标字数：${CHAPTER_GEN_DEFAULTS.WORD_COUNT_MIN}–${CHAPTER_GEN_DEFAULTS.WORD_COUNT_MAX} 字

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${AGENT_LABELS.DATA_PACKAGE}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${contextText}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${AGENT_LABELS.FORCE_REQUIREMENTS}
创作前请依次确认：
1. 【衔接确认】上一章回顾的结尾状态是什么？本章第一段如何自然承接？
2. 【角色确认】本章出场角色的当前境界和说话方式是否已对照角色卡？
3. 【设定确认】本章涉及的境界名称、地名、功法名称是否与世界设定一致？
4. 【伏笔确认】待回收伏笔中，哪些可以在本章推进（不收尾）？
5. 【规则确认】创作规则中的禁忌，本章是否全部规避？

确认完毕后，直接开始创作正文，不要输出确认清单本身。

${AGENT_LABELS.WRITING_REQUIREMENTS}
- 字数：${CHAPTER_GEN_DEFAULTS.WORD_COUNT_MIN}–${CHAPTER_GEN_DEFAULTS.WORD_COUNT_MAX} 字（必须达到下限）
- 视角：第三人称有限视角
- 本章核心任务：完成卷蓝图中对应本章的情节推进，不得提前完成下章任务
- 结尾要求：留有钩子或悬念，为读者持续追更提供动力`
```

---

### 2.3 续写模式 User Prompt（`messages.ts`）

**当前问题：** 续写只传了已有内容，没有传资料包，AI续写时不知道角色当前境界、接下来的剧情方向。对于5000字的章节来说，续写2000字完全在黑盒里进行。

**优化：** 续写也应该传入资料包（至少传入角色卡和卷蓝图当前章节部分）。

```typescript
// messages.ts — continue 模式

if (mode === 'continue' && existingContent) {
  const wordsTarget = targetWords || CHAPTER_GEN_DEFAULTS.CONTINUATION_WORD_COUNT_TARGET
  const wordsUpper = Math.min(wordsTarget + 1000, CHAPTER_GEN_DEFAULTS.CONTINUATION_WORD_COUNT_UPPER)
  
  // 如果有资料包，提取关键约束注入
  const continuationConstraints = contextBundle
    ? `\n\n【续写约束——来自创作资料包】\n${assemblePromptContext(contextBundle, { slotFilter: ['protagonist', 'characters', 'rules'] })}`
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
- 人物行为和境界描写必须与角色卡一致
- 结尾留有悬念（除非这是本章的完整结尾）
- 直接续写正文，不要输出任何说明`,
    },
  ]
}
```

> **说明：** `assemblePromptContext` 需要支持 `slotFilter` 参数，只组装指定 slot，避免续写时注入完整资料包。这是一个小改动，在 `contextBuilder.ts` 的 `assemblePromptContext` 加一个可选的 slot 白名单过滤即可。

---

### 2.4 重写模式 User Prompt（`messages.ts`）

**当前问题：** 重写 prompt 没有明确"保持什么/改变什么"的边界，AI 可能完全重写导致核心情节丢失，也可能改动太少没有效果。

```typescript
// messages.ts — rewrite 模式

if (mode === 'rewrite' && existingContent) {
  const issueSection = issuesContext?.length
    ? `\n【本次改写需要重点解决的问题】\n${issuesContext.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}`
    : ''

  // 资料包约束
  const rewriteConstraints = contextBundle
    ? `\n【改写约束——来自创作资料包】\n${assemblePromptContext(contextBundle, { slotFilter: ['protagonist', 'characters', 'rules', 'worldSettings'] })}`
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
- 字数：${CHAPTER_GEN_DEFAULTS.REWRITE_WORD_COUNT_MIN}–${CHAPTER_GEN_DEFAULTS.REWRITE_WORD_COUNT_MAX} 字
- 优先解决上方"需要重点解决的问题"
- 直接输出完整改写正文，不要输出任何说明或对比`,
    },
  ]
}
```

---

### 2.5 下一章生成 User Prompt（`generation.ts`）

**当前问题：**
- 章节摘要要求150-200字（与正式摘要格式不统一）
- 标题生成没有约束风格（AI 可能输出"第X章：战斗开始了"这种质量很差的标题）
- eventLine 优化后可以精确传入当前章对应的事件行，但当前直接传整个 eventLine

```typescript
// generation.ts — generateNextChapter 的 userPrompt

// 从 eventLine 中提取下一章对应的事件行
const nextChapterIndex = recentChapters.length  // 0-based，即下一章在卷内的序号
const eventLineItems: string[] = (() => {
  try { return volume.eventLine ? JSON.parse(volume.eventLine) : [] } catch { return [] }
})()
const nextChapterEvent = eventLineItems[nextChapterIndex] || ''
const nextChapterEventSection = nextChapterEvent
  ? `\n【下一章对应的事件线任务】\n${nextChapterEvent}`
  : (volume.eventLine ? `\n【卷事件线（参考）】\n${eventLineItems.slice(nextChapterIndex, nextChapterIndex + 3).join('\n')}` : '')

const userPrompt = `请为小说卷《${volume.title}》生成${chapterOrdinal}章的标题和摘要。

【卷信息】
- 卷标题：《${volume.title}》
${volume.blueprint ? `- 卷蓝图摘要：${volume.summary || volume.blueprint.slice(0, 300)}` : ''}
${nextChapterEventSection}
${recentChaptersSection}

【生成要求】
标题要求：
- 2-10个字，有吸引力，符合玄幻/仙侠风格
- 不得出现"的""了""和"等虚词结尾
- 不得直白剧透（如"主角突破金丹"），要有悬念感
- 示例风格："剑意锋芒""天地为证""旧人重逢""局中局"

摘要要求（重要，这是AI生成正文时的核心任务描述）：
- 字数：200-300字
- 必须包含以下四个部分：
  【开篇状态】本章从什么场景/状态开始（承接上章结尾）
  【核心事件】本章发生的1-2个主要事件（包含起因和走向）
  【角色动态】主要角色的行为、情绪或境界变化
  【章末状态】本章以什么状态/悬念结束
${continuationRequirement}

请以 JSON 格式输出：
{
  "chapterTitle": "章节标题（2-10字）",
  "summary": "章节摘要（200-300字，包含上方四个部分）"
}`
```

---

## 三、摘要总结类

### 3.1 章节摘要（`summarizer.ts` — `triggerAutoSummary`）

**当前问题：** 自由格式，150-200字，信息密度不够支撑长篇连续性。

```typescript
// summarizer.ts — triggerAutoSummary 的 userPrompt + maxTokens

const summaryText = await callSummaryLLM({
  db,
  novelId,
  stage: 'summary_gen',
  systemPrompt: SUMMARY_SYSTEM_PROMPT,  // system prompt 见 3.5
  userPrompt: `请为以下小说章节生成结构化摘要。

【章节标题】《${chapter.title}》

【正文内容】
${chapter.content}

【输出格式】严格按以下四个标签输出，每项如确实没有内容则写"无"，不得省略标签：

【角色状态变化】本章中角色的境界突破、能力获得、重要属性变化。必须包含具体境界名称，如"林岩从炼气三层突破至炼气四层"。
【关键事件】本章主线剧情，2-3句话，包含起因、过程、结果。
【道具/功法】本章新出现、获得或使用的重要道具、功法、丹药（名称+一句话说明）。
【章末状态】本章结束时主角的：所在位置·当前处境·下一步明确方向或悬念。

字数要求：总计300-400字（四个标签合计）`,
  maxTokens: 1000,  // 从500提升
})
```

---

### 3.2 总纲摘要（`summarizer.ts` — `generateMasterOutlineSummary`）

**当前问题：** 无结构约束，可能输出和章节摘要一样的流水文字。总纲摘要的用途是 Slot-0 的降级注入，需要体现"宏观方向"而非"具体情节"。

```typescript
userPrompt: `请为以下小说总纲生成结构化摘要，用于AI创作章节时的宏观参考。

【总纲标题】《${outline.title}》

【总纲内容】
${outline.content}

【输出格式】严格按以下四个标签输出：

【世界与主角】一句话概括：世界背景 + 主角的初始身份和核心驱动力（50字以内）
【核心冲突】贯穿全书的主要矛盾是什么，涉及哪些主要势力或对立力量（100字以内）
【主线弧线】主角从起点到终局的大致成长路径，按"卷1→卷N"或"阶段"描述（150字以内）
【创作禁忌】从总纲中提炼的最高优先级约束（如：主角不得无故杀无辜/不得在XXX之前泄露身份），最多5条

字数：总计300-400字`,
  maxTokens: 800,
```

---

### 3.3 卷摘要（`summarizer.ts` — `generateVolumeSummary`）

**当前问题：** 直接把 blueprint 全文和 eventLine 全文塞入，内容可能很长且格式混乱，AI 输出的摘要容易是流水账。

```typescript
// 先提取 blueprint 的结构化部分
const blueprintSummary = volume.blueprint
  ? extractBlueprintCore(volume.blueprint)  // 见下方辅助函数
  : ''

const eventLineSummary = volume.eventLine
  ? (() => {
      try {
        const items: string[] = JSON.parse(volume.eventLine)
        // 只取首尾各3条 + 关键节点（含"高潮""转折""揭秘"字样的行）
        const keyItems = items.filter(l => /高潮|转折|揭秘|突破|决战/.test(l))
        const head = items.slice(0, 3)
        const tail = items.slice(-3)
        const sample = [...new Set([...head, ...keyItems, ...tail])].slice(0, 8)
        return sample.join('\n')
      } catch { return volume.eventLine.slice(0, 500) }
    })()
  : ''

userPrompt: `请为以下卷生成摘要，用于AI创作时定位当前卷的叙事方向。

【卷标题】《${volume.title}》

【卷蓝图核心】
${blueprintSummary || '（无蓝图）'}

【关键事件采样】
${eventLineSummary || '（无事件线）'}

【输出格式】严格按以下三个标签输出：

【本卷主题】一句话：本卷解决什么核心冲突，主角完成什么转变（30字以内）
【关键节点】本卷中改变走向的3-5个关键事件，每条一行（包含大致章节位置）
【卷末状态】本卷结束时主角的境界·位置·与下卷的衔接点

字数：总计200-280字`,
  maxTokens: 600,

// 辅助函数：提取blueprint的结构化核心
function extractBlueprintCore(blueprint: string): string {
  // 提取已知标签的内容
  const tags = ['本卷主题', '核心冲突', '关键节点', '卷末状态', '开卷状态']
  const parts: string[] = []
  for (const tag of tags) {
    const match = blueprint.match(new RegExp(`【${tag}】([\\s\\S]*?)(?=【|$)`))
    if (match) parts.push(`【${tag}】${match[1].trim().slice(0, 150)}`)
  }
  // 如果没有标签，直接取前500字
  return parts.length > 0 ? parts.join('\n') : blueprint.slice(0, 500)
}
```

---

### 3.4 设定摘要（`summarizer.ts` — `generateSettingSummary`）

**当前问题：** 所有 type 用同一个 prompt，但不同类型的设定需要保留的核心信息差异很大：power_system 最重要的是境界名称列表，faction 最重要的是与主角的关系，geography 最重要的是地点的特殊规则。

```typescript
// 按 type 使用不同的保留重点提示
const typeSpecificHint: Record<string, string> = {
  power_system: `摘要必须包含完整的境界名称列表（从低到高），这是全书一致性的基础。其次包含突破条件和跨境界战力规则。境界名称一字不差，这是最高优先级。`,
  faction: `摘要必须包含：势力名称、与主角的关系（敌/友/中立）、势力的核心矛盾、重要人物（姓名+境界）。省略地理描述和历史背景。`,
  geography: `摘要必须包含：地点名称、特殊规则或危险、对主角的意义（主角会在此发生什么）。省略气候描述等无关信息。`,
  item_skill: `摘要必须包含：名称、效果（精确描述）、使用限制或副作用、当前归属（主角是否拥有）。省略来历故事。`,
  worldview: `摘要必须包含：世界核心法则（影响所有角色行为的规律）、当前格局（主要势力分布）、世界危机（如有）。`,
  misc: `摘要保留对AI写章节时有直接参考价值的内容，省略背景故事和描述性文字。`,
}

userPrompt: `请为以下小说设定生成用于RAG检索的摘要。

【设定名称】：${row.name}
【设定类型】：${row.type}

【设定内容】：
${row.content}

【本类型摘要重点】：
${typeSpecificHint[row.type] || '保留核心概念和关键规则，省略描述性文字。'}

【通用要求】：
1. 摘要长度：200-350字
2. 使用与原文完全一致的术语（特别是专有名词）
3. 信息密度高，每句话都有意义
4. 纯文本输出，不加任何格式标记`,
  maxTokens: 800,  // 保持不变，已经合理
```

---

### 3.5 摘要 System Prompt 统一（`constants.ts`）

**当前问题：** `SUMMARY_SYSTEM_PROMPT` 和 `SETTING_SUMMARY_SYSTEM_PROMPT` 表述过于简单，没有体现摘要的用途和质量标准。

```typescript
// constants.ts

export const SUMMARY_SYSTEM_PROMPT =
  '你是专业的小说内容摘要助手，为AI辅助创作系统生成摘要。你的摘要会被后续AI读取并作为创作依据，因此必须准确、信息密度高、严格按要求的格式输出。只输出摘要正文，不加任何解释或标题。'

export const SETTING_SUMMARY_SYSTEM_PROMPT =
  '你是专业的小说世界设定摘要助手，为AI辅助创作系统的RAG检索生成摘要。你的摘要会被向量化后用于检索召回，因此必须保留原文的专有名词、数值规则和关键约束，信息密度要高。只输出摘要正文，纯文本，不加任何格式标记。'

export const JSON_OUTPUT_PROMPT =
  '你是专业的结构化数据提取助手，为小说创作系统分析内容并输出JSON。严格按照指定的JSON schema输出，不输出任何非JSON内容（不加markdown代码块标记，不加解释说明）。如果某个字段无内容，输出空数组[]或空字符串""，不得省略字段。'
```

---

## 四、检查分析类

### 4.1 角色一致性检查（`consistency.ts` — `checkCharacterConsistency`）

**当前问题：**
- 角色信息只传了 `description`（一段文字），没有传 `powerLevel`、`speechPattern`、`weakness`
- 检查维度只有"符合角色设定"，AI 不知道具体检查哪些维度，导致检查结果质量不稳定
- 检查 prompt 和 JSON output prompt 都太简单

```typescript
// consistency.ts — checkCharacterConsistency

// 修改 characterInfo 构建，传完整关键字段
characterInfo = chars.map(c => {
  let attrs: any = {}
  try { attrs = c.attributes ? JSON.parse(c.attributes) : {} } catch {}
  
  return [
    `【${c.name}】角色定位：${c.role}`,
    `当前境界：${c.powerLevel || '未设定'}`,
    `性格：${attrs.personality || '未设定'}`,
    `说话方式：${attrs.speechPattern || '未设定'}`,
    `性格弱点：${attrs.weakness || '未设定'}`,
    `性格描述：${(c.description || '').slice(0, 200)}`,
  ].join('\n')
}).join('\n\n---\n')

// 修改 checkPrompt
const checkPrompt = `请检查以下小说章节内容是否符合角色设定，重点检查四个维度。

【角色设定】
${characterInfo || '无特定角色设定'}

【待检查章节内容】
${chapter.content.slice(0, 10000)}

【检查维度（必须逐一检查）】
1. 境界一致性：章节中描写的角色能力/境界是否与"当前境界"设定一致？是否出现超出当前境界的能力？
2. 说话方式一致性：章节中角色的对话是否符合"说话方式"描述？有无明显的语气/用词与设定不符？
3. 性格行为一致性：角色的行为决策是否符合"性格"描述？有无明显背离性格设定的行为（特别是在压力场景下）？
4. 弱点表现一致性：如果本章涉及角色的"性格弱点"触发场景，角色的反应是否符合设定？

请以JSON格式输出检查结果：
{
  "conflicts": [
    {
      "characterName": "角色名",
      "dimension": "境界|说话方式|性格行为|弱点表现",
      "conflict": "具体冲突描述（指出章节中的具体行为和设定的差异）",
      "excerpt": "相关原文片段（30字以内）",
      "severity": "error|warning"
    }
  ],
  "warnings": ["不确定项或轻微偏差的提示"]
}

如果没有冲突，conflicts 为空数组[]。warnings 用于记录"可能有问题但不确定"的内容。`
```

---

### 4.2 章节修复（`consistency.ts` — `repairChapterByIssues`）

**当前问题：** 修复时没有角色卡和世界设定，AI 修复时完全凭自身判断，可能引入新的设定错误（用错误的境界名称修复境界错误）。

```typescript
// consistency.ts — repairChapterByIssues

// 需要在函数参数中传入 contextBundle 或从 DB 查询关键设定
// 以最小改动为原则：查询主角信息和核心设定作为约束

const protagonists = await db
  .select({ name: characters.name, powerLevel: characters.powerLevel, attributes: characters.attributes })
  .from(characters)
  .where(and(eq(characters.novelId, novelId), eq(characters.role, 'protagonist'), sql`${characters.deletedAt} IS NULL`))
  .all()

const protagonistSection = protagonists.map(p => {
  let attrs: any = {}
  try { attrs = p.attributes ? JSON.parse(p.attributes) : {} } catch {}
  return `${p.name}：境界=${p.powerLevel || '未知'}，说话方式=${attrs.speechPattern || '未设定'}`
}).join('\n')

const messages = [
  {
    role: 'system' as const,
    content: `你是专业的小说修改编辑。根据指出的问题对章节进行针对性修改。
修改原则：
- 只修改有问题的部分，其余内容保持不变
- 修改后字数与原文相近（允许±10%）
- 不改变核心情节走向和结尾状态
- 直接输出完整修改后的正文，不要任何解释`,
  },
  {
    role: 'user' as const,
    content: `章节《${chapter.title}》检测到问题（评分 ${score}/100），请根据问题列表修改。

【修复时必须遵守的设定约束】
主角设定：
${protagonistSection || '无'}

【发现的问题】
${issueList}

【原文内容】
${chapter.content}

请直接输出修改后的完整正文：`,
  },
]
```

---

### 4.3 卷进度检查（`volumeProgress.ts` — `checkVolumeProgress`）

**当前问题：**
- healthStatus 四个值（healthy/ahead/behind/critical）的定义没有操作性
- suggestion 要求50-200字，范围太宽，AI 输出质量不稳定
- 没有要求 AI 给出具体的调整建议（如"接下来X章应该加快节奏"）

```typescript
// volumeProgress.ts — checkPrompt

const chapterProgressPct = targetChapter ? Math.round((currentChapterInVolume / targetChapter) * 100) : null
const wordProgressPct = targetWordCount ? Math.round(((volumeData.wordCount || 0) / targetWordCount) * 100) : null

const checkPrompt = `你是小说卷进度评估助手。请根据数据评估当前卷的创作进度并给出具体建议。

【卷数据】
卷标题：${volumeData.title}
章节进度：第${currentChapterInVolume}章 / 目标${targetChapter || '未设定'}章（${chapterProgressPct !== null ? chapterProgressPct + '%' : '无法计算'}）
字数进度：${volumeData.wordCount || 0}字 / 目标${targetWordCount || '未设定'}字（${wordProgressPct !== null ? wordProgressPct + '%' : '无法计算'}）
当前章节：《${chapter.title}》

【健康状态判断标准】
- healthy：章节进度和字数进度均在目标的85%-110%范围内
- ahead：进度超过目标110%，有提前收尾风险
- behind：进度低于目标70%，有拖延收尾风险
- critical：进度超过目标130%或低于50%，需要立即调整

【风险判断】
- early_ending：当前章节进度≥90%但字数进度<80%，说明情节铺展过快，可能提前耗尽内容
- late_ending：当前章节进度<60%但字数进度≥80%，说明字数已消耗较多但情节推进缓慢

请以JSON格式输出：
{
  "healthStatus": "healthy|ahead|behind|critical",
  "risk": "early_ending|late_ending|null",
  "diagnosis": "当前进度的问题诊断，1-2句话说明哪里出了偏差",
  "suggestion": "接下来3-5章的具体调整建议，如：加快情节推进/增加场景细节/压缩某类描写，60-100字"
}`

// 同时修改返回值，增加 diagnosis 字段
// VolumeProgressResult interface 中加 diagnosis?: string
```

---

### 4.4 伏笔提取（`foreshadowing.ts` — `extractForeshadowingFromChapter`）

**当前问题：**
- importance 判断标准模糊，导致 AI 把所有伏笔都标为 high
- 没有提示"当前已有X个open伏笔，新伏笔应该是真正有价值的"
- 收尾判断过于宽松，AI 容易把"提及"当成"收尾"

```typescript
// foreshadowing.ts — extractPrompt

const openCount = existingOpen.length
const existingForeshadowingText = openCount > 0
  ? `\n\n【当前未收尾的伏笔（共${openCount}个）】\n${existingOpen.map((f, i) => `${i + 1}. [ID:${f.id}] [${f.importance}] ${f.title}: ${f.description || ''}`).join('\n')}`
  : ''

const extractPrompt = `你是专业的小说伏笔分析助手。请分析章节内容，准确识别伏笔操作。

【章节标题】：《${chapter.title}》

【正文内容】：
${chapter.content}
${existingForeshadowingText}

【判断标准——严格执行】

新伏笔（newForeshadowing）：
- 必须是：明确的悬念、未解释的神秘元素、有意为之的暗示（作者刻意不说明的内容）
- 不算新伏笔：普通的场景描写、角色心理活动、已知信息的重复
- importance 判断（标准要严格，不要轻易标 high）：
  * high：直接影响主线剧情走向，如主角身世之谜、核心反派的真实身份、决定故事终局的秘密
  * normal：影响支线或角色关系发展，如某角色的隐藏目的、道具的特殊来历
  * low：细节装饰性伏笔，如某个奇异现象、NPC的神秘举动
- 当前已有${openCount}个未收尾伏笔，新伏笔应该是真正有价值的新内容，不要重复已有伏笔

已收尾伏笔（resolvedForeshadowingIds）：
- 必须是：伏笔的核心悬念在本章得到了明确的解答或揭示
- 不算收尾："提及了这个伏笔"或"推进了一步"不算收尾，只有"核心谜底揭开"才算
- 如果不确定，宁可放入 progresses 而不是 resolvedForeshadowingIds

推进中（progresses）：
- hint：背景式提及，侧面暗示，不直接推进
- advance：直接增加新线索，情节推进明显
- partial_reveal：揭露部分真相但核心悬念仍在
- 注意：已收尾的伏笔不要同时出现在 progresses 中

请以JSON格式输出（不要其他内容）：
{
  "newForeshadowing": [
    {
      "title": "伏笔标题（简短，5-15字，如：林岩左手黑色印记）",
      "description": "详细说明：这个伏笔是什么？在本章如何出现？为什么算伏笔？（50-100字）",
      "importance": "high|normal|low"
    }
  ],
  "resolvedForeshadowingIds": ["只填已明确收尾的伏笔ID"],
  "progresses": [
    {
      "foreshadowingId": "伏笔ID",
      "progressType": "hint|advance|partial_reveal",
      "summary": "本章对此伏笔做了什么（20-40字）"
    }
  ]
}

如果本章确实没有相关内容，对应数组为空[]。`
```

---

### 4.5 伏笔健康检查（`foreshadowing.ts` — `checkForeshadowingHealth`）

**当前问题：** 把最近章节的完整 content 塞入（`recentContent.slice(0, 8000)`），token浪费且信息冗余。摘要链已经有了，应该用摘要而不是正文。

```typescript
// foreshadowing.ts — healthPrompt

// 用摘要替代正文（摘要已经在章节生成后自动生成）
const recentSummaries = await db
  .select({ title: chapters.title, summary: chapters.summary, sortOrder: chapters.sortOrder })
  .from(chapters)
  .where(and(eq(chapters.novelId, novelId), isNull(chapters.deletedAt)))
  .orderBy(desc(chapters.sortOrder))
  .limit(recentCount)
  .all()

const recentContent = recentSummaries
  .map(c => `《${c.title}》摘要：${c.summary || '（无摘要）'}`)
  .join('\n\n')

const healthPrompt = `你是小说伏笔健康审计助手。基于最近章节的摘要，评估伏笔状态并给出建议。

【最近${recentCount}章摘要】：
${recentContent}

【沉寂伏笔（长期未推进）】：
${staleForPrompt || '无'}

【高重要性未收尾伏笔】：
${highImportanceOpen.map(f => `- [ID:${f.id}] [high] ${f.title}: ${f.description || ''}`).join('\n') || '无'}

请以JSON格式输出（不要其他内容）：
{
  "suggestions": [
    {
      "foreshadowingId": "伏笔ID",
      "urgency": "high|normal|low",
      "suggestion": "为什么建议现在处理，以及具体的引入方式建议（40-80字）"
    }
  ],
  "contradictions": [
    {
      "foreshadowingId": "伏笔ID",
      "reason": "最近章节内容与此伏笔存在什么潜在矛盾（40字以内）"
    }
  ],
  "resolutionIdeas": [
    {
      "foreshadowingId": "伏笔ID",
      "idea": "基于当前剧情，建议的收尾方向和方式（40-60字）"
    }
  ]
}

如果没有问题，对应数组为空[]。`
```

---

### 4.6 伏笔推荐（`foreshadowing.ts` — `suggestForeshadowingForChapter`）

**当前问题：** action 类型的判断标准模糊，reason 只要求50字不够指导创作，AI 输出的建议缺乏可操作性。

```typescript
// foreshadowing.ts — suggestPrompt

const suggestPrompt = `你是小说创作顾问。作者正在计划创作一个新章节，需要决定在本章中如何呼应已有的伏笔。

【本章创作意图/场景描述】：
${chapterContext.slice(0, 1000)}

【候选伏笔（按相关度排序）】：
${candidateText}

对每个候选伏笔，判断以下内容：
1. 当前场景下是否适合处理这个伏笔？（不适合则不要输出）
2. 建议的处理方式：
   - weave_in：自然穿插，不作为重点，读者感觉到存在即可
   - hint：侧面暗示，为后续收尾做铺垫，但不直接推进
   - advance：作为本章的支线推进，增加新线索
   - resolve：本章可以完整收尾这个伏笔
3. 具体的操作建议：如何在章节中自然地引入这个伏笔？

请以JSON格式输出（只包含适合在本章处理的伏笔）：
{
  "suggestions": [
    {
      "foreshadowingId": "伏笔ID",
      "action": "weave_in|hint|advance|resolve",
      "reason": "为什么现在适合处理（20字以内）",
      "howTo": "具体如何在章节中引入这个伏笔的操作建议（40-60字，越具体越好）"
    }
  ]
}

如果没有候选伏笔适合在当前场景处理，输出空数组：{"suggestions": []}`
```

---

## 五、各类 System Prompt 统一规范

所有 AI 调用的 system prompt 按"角色定位 + 输出约束"两段式统一，替换 `constants.ts` 中的常量：

```typescript
// constants.ts — 统一更新

export const JSON_OUTPUT_PROMPT =
  '你是专业的结构化数据提取助手，为小说创作系统分析内容并输出JSON。严格按照指定的JSON schema输出，不输出任何非JSON内容（不加markdown代码块标记，不加解释说明）。如果某个字段无内容，输出空数组[]或空字符串""，不得省略字段。'

export const SUMMARY_SYSTEM_PROMPT =
  '你是专业的小说内容摘要助手，为AI辅助创作系统生成摘要。你的摘要会被后续AI读取作为创作依据，因此必须准确、信息密度高、严格按指定格式输出。只输出摘要正文，不加任何标题、解释或格式标记。'

export const SETTING_SUMMARY_SYSTEM_PROMPT =
  '你是专业的小说世界设定摘要助手，为RAG检索系统生成摘要。你的摘要会被向量化用于检索召回，必须保留原文的专有名词（特别是境界名称、地名、人名）、数值规则和关键约束。只输出纯文本摘要，不加任何格式标记。'

export const NEXT_CHAPTER_SYSTEM_PROMPT =
  '你是专业的小说章节规划助手，擅长根据卷纲生成连贯的章节标题和摘要。你只输出JSON，格式严格符合要求，不输出任何其他内容。'

export const OUTLINE_BATCH_SYSTEM_PROMPT =
  '你是专业的小说大纲规划助手，擅长构建连贯的章节大纲序列。你只输出JSON，格式严格符合要求，不输出任何其他内容。'
```

---

## 六、改动优先级

| 优先级 | 改动 | 文件 | 核心收益 |
|--------|------|------|---------|
| **P0** | 章节摘要结构化格式 + max_tokens→1000 | `summarizer.ts` | 摘要链质量，影响所有章节生成的上下文 |
| **P0** | 伏笔提取 importance 标准严格化 | `foreshadowing.ts` | 防止 high 伏笔过度积累拖慢系统 |
| **P1** | System prompt HARD_CONSTRAINTS 提到最前 | `messages.ts` | 硬约束权重提升，减少设定漂移 |
| **P1** | 章节修复注入主角设定 | `consistency.ts` | 防止修复引入新设定错误 |
| **P1** | 设定摘要按 type 区分保留重点 | `summarizer.ts` | RAG 召回质量提升 |
| **P1** | 角色一致性检查传完整字段+四维度 | `consistency.ts` | 检查结果有效性提升 |
| **P2** | 下一章生成摘要格式统一为四标签 | `generation.ts` | 与正式摘要格式统一，提升连贯性 |
| **P2** | 卷摘要用 extractBlueprintCore | `summarizer.ts` | 减少冗余输入，摘要质量提升 |
| **P2** | 伏笔健康检查用摘要替换正文 | `foreshadowing.ts` | Token 节省约60%，信息密度提升 |
| **P2** | 续写/重写传入关键约束 | `messages.ts` | 续写不再在黑盒中进行 |
| **P3** | 卷进度检查增加 diagnosis 字段 | `volumeProgress.ts` | 建议可操作性提升 |
| **P3** | 伏笔推荐增加 howTo 字段 | `foreshadowing.ts` | 推荐可操作性提升 |
| **P3** | 所有 system prompt 统一两段式 | `constants.ts` | 表述规范，边际收益 |

---

> 文档版本：v1.0
> 覆盖文件：messages.ts / summarizer.ts / consistency.ts / volumeProgress.ts / foreshadowing.ts / constants.ts
> 总计优化点：17个，其中P0级2个，P1级4个
