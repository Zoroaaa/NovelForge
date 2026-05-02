/**
 * @file formatImport.ts
 * @description 导入数据格式化服务 - AI 智能识别和格式化 JSON/TXT/MD 数据
 */
import { resolveConfig } from './llm'

export type ImportTargetModule =
  | 'chapter'
  | 'volume'
  | 'setting'
  | 'character'
  | 'rule'
  | 'foreshadowing'
  | 'master_outline'

export interface FormattedImportData {
  module: ImportTargetModule
  data: Record<string, unknown>
  rawContent: string
  parseStatus: 'success' | 'warning' | 'error'
  parseMessage?: string
}

const MODULE_PROMPTS: Record<ImportTargetModule, string> = {
  master_outline: `你是一个小说总纲格式化专家。用户的输入可能是：
1. 纯文本描述的总纲内容
2. Markdown 格式的总纲文档
3. JSON 格式的总纲对象（可能包含 title, content 等字段）
4. 包含世界观、核心设定、主线剧情等各类信息的大纲

你的任务：
1. 识别输入的格式
2. 提取关键信息：总纲标题(title)、总纲内容(content)、**摘要(summary)**
3. 返回标准化的 JSON 格式：

\`\`\`json
{
  "title": "总纲标题",
  "summary": "总纲的简要摘要（100-200字概括核心内容）",
  "content": "完整的总纲正文内容（Markdown 格式，涵盖世界观、核心设定、主线剧情等）"
}
\`\`\`

注意事项：
- content 应该是完整的总纲内容，支持 Markdown 格式
- **summary 是新增字段，用于快速了解总纲核心内容**
- 如果无法提取标题，使用 "总纲" 作为默认值
- 只返回 JSON，不要有其他解释文字`,

  setting: `你是一个小说世界观设定格式化专家。用户的输入可能是：
1. 纯文本描述的设定内容
2. Markdown 格式的设定文档
3. JSON 格式的设定对象（可能包含 type, name, content 等字段）
4. 世界观、力量/成长体系、势力组织、地理环境、技能/道具等各类设定

支持的设定类型（type）：
- worldview: 世界观
- power_system: 力量/成长体系
- faction: 势力组织
- geography: 地理环境
- item_skill: 宝物功法
- misc: 其他设定

你的任务：
1. 识别输入的内容属于哪种设定类型
2. 提取关键信息：类型(type)、分类(category)、名称(name)、详细描述(content)、重要程度(importance)
3. 返回标准化的 JSON 格式：

\`\`\`json
{
  "type": "根据内容推断的设定类型",
  "category": "与 type 相同或更细的分类",
  "name": "设定项的名称",
  "content": "详细的设定描述内容（Markdown 格式）",
  "importance": "normal"
}
\`\`\`

如果输入是多个设定项，解析成数组格式：
\`\`\`json
[
  {"type": "faction", "category": "faction", "name": "青云宗", "content": "...", "importance": "normal"},
  {"type": "faction", "category": "faction", "name": "魔煞门", "content": "...", "importance": "high"}
]
\`\`\`

注意事项：
- type 必须是上述六种类型之一
- category 通常与 type 相同，但可以更细粒度（如 type="faction", category="正道势力"）
- importance 可以是 high（重要）、normal（普通）、low（次要）
- 只返回 JSON，不要有其他解释文字`,

  character: `你是一个小说角色格式化专家。用户的输入可能是：
1. 纯文本描述的角色信息
2. Markdown 格式的角色卡
3. JSON 格式的角色对象（可能包含 name, role, description, attributes 等字段）
4. 角色外观、性格、背景、关系等各类信息

你的任务：
1. 识别输入的格式
2. 提取关键信息并转换为标准 JSON 格式：

\`\`\`json
{
  "name": "角色姓名",
  "role": "protagonist | supporting | antagonist | minor",
  "description": "综合描述（简要版，2-3句话概括）",
  "aliases": ["别名1", "别名2"],
  "powerLevel": "实力/成长等级（使用本小说设定中已定义的等级名称，若未设定可留空）",
  "relationships": ["关联角色A（关系描述）", "关联角色B（关系描述）"],
  "attributes": {
    "appearance": "外貌描述（身高、体型、容貌特征等）",
    "personality": "性格特点（行为模式、价值观、优缺点等）",
    "backgroundStory": "背景故事（出身、经历、动机等）",
    "age": "年龄或外貌年龄",
    "gender": "性别",
    "occupation": "职业"
  }
}
\`\`\`

重要说明：
- appearance, personality, backgroundStory 等详细信息应存入 **attributes 对象内部**
- relationships 存为字符串数组，每个元素描述一个关系
- role 接受四个值：protagonist（主角）、supporting（配角）、antagonist（反派）、minor（次要角色）
- 只返回 JSON，不要有其他解释文字`,

  rule: `你是一个小说创作规则格式化专家。用户的输入可能是：
1. 纯文本描述的规则内容
2. Markdown 格式的规则文档
3. JSON 格式的规则对象（可能包含 category, title, content 等字段）
4. 各类创作规则、写作要求、禁忌事项等

支持的规则类别：
- style: 文风要求
- pacing: 节奏控制
- character: 角色一致性要求
- plot: 情节要求
- world: 世界观规则
- taboo: 禁忌事项
- custom: 自定义规则

你的任务：
1. 识别输入的内容属于哪种规则类别
2. 提取关键信息：类别(category)、规则标题(title)、规则内容(content)、优先级(priority)
3. 返回标准化的 JSON 格式：

\`\`\`json
{
  "category": "根据内容推断的规则类别",
  "title": "规则的简短标题",
  "content": "规则的详细描述",
  "priority": 3
}
\`\`\`

如果输入是多个规则，解析成数组格式：
\`\`\`json
[
  {"category": "style", "title": "第三人称叙事", "content": "全篇小说使用第三人称全知视角...", "priority": 1},
  {"category": "taboo", "title": "避免主角光环", "content": "主角遇到危机时不能强行开挂...", "priority": 2}
]
\`\`\`

注意事项：
- category 只接受上述七个值
- priority 为 1-5，1 表示最高优先级
- 只返回 JSON，不要有其他解释文字`,

  volume: `你是一个小说卷/部结构格式化专家。用户的输入可能是：
1. 纯文本描述（"第一卷：觉醒之路，讲述主角从普通人成长为修士的历程..."）
2. Markdown 格式的卷大纲
3. JSON 格式的卷对象（可能包含 title, summary, blueprint 等字段）
4. 其他变体

你的任务：
1. 识别输入的格式
2. 提取关键信息：卷标题(title)、卷概要(summary)、详细蓝图(blueprint)、事件线(eventLine)、备注(notes)、预计章节数(chapterCount)、**目标字数(targetWordCount)**
3. 返回标准化的 JSON 格式：

\`\`\`json
{
  "title": "提取的卷标题",
  "summary": "卷的简要概述（1-2句话）",
  "blueprint": "详细的卷情节蓝图，包含起承转合",
  "eventLine": ["关键事件1", "关键事件2", "重要转折点"],
  "notes": ["伏笔1：神秘玉佩的出现", "伏笔2：反派势力的铺垫"],
  "chapterCount": 10,
  "targetWordCount": 300000
}
\`\`\`

注意事项：
- chapterCount 为可选参考字段（5-30之间），不强制存储
- **targetWordCount 为目标字数（单位：字），根据章节数和平均每章3000-5000字推算，这是一个重要字段**
- 如果是卷列表格式（如 "第一卷... 第二卷..."），请解析成数组
- 只返回 JSON，不要有其他解释文字`,

  foreshadowing: `你是一个小说伏笔格式化专家。用户的输入可能是：
1. 纯文本描述的伏笔内容
2. Markdown 格式的伏笔文档
3. JSON 格式的伏笔对象（可能包含 title, description, status 等字段）
4. 伏笔线索、悬念设置等

你的任务：
1. 识别输入的格式
2. 提取关键信息：伏笔标题(title)、伏笔描述(description)、状态(status)、重要程度(importance)
3. **尽量提取以下关联信息**（如果内容中提到）：
   - **volumeTitle**: 所属卷标题（使用卷标题，不是ID）
   - **chapterTitle**: 埋设此伏笔的章节标题（使用章节标题，不是ID）
   - **resolvedChapterTitle**: 回收此伏笔的章节标题（使用章节标题，不是ID）
4. 返回标准化的 JSON 格式：

\`\`\`json
{
  "title": "伏笔的简短标题",
  "description": "详细的伏笔描述，说明这是什么伏笔、如何埋下、暗示什么",
  "status": "open",
  "importance": "normal",
  "volumeTitle": "所属卷标题（如果知道）",
  "chapterTitle": "埋设此伏笔的章节标题（如果知道）",
  "resolvedChapterTitle": "回收此伏笔的章节标题（如果知道）"
}
\`\`\`

如果输入是多个伏笔，解析成数组格式：
\`\`\`json
[
  {"title": "神秘玉佩", "description": "主角在童年时期获得的神秘玉佩...", "status": "open", "importance": "high", "chapterTitle": "第一章：童年"},
  {"title": "血海深仇", "description": "反派与主角家族的血债...", "status": "open", "importance": "normal"}
]
\`\`\`

注意事项：
- **volumeTitle, chapterTitle, resolvedChapterTitle 使用标题**（系统会自动匹配为ID），不要使用 ID 或编号
- status 只能是 open（开放）、resolved（已回收）、abandoned（已放弃）、resolve_planned（计划回收）四者之一
- importance 可以是 high（重要）、normal（普通）、low（次要）
- 如果无法确定关联信息，可以省略这些字段
- 只返回 JSON，不要有其他解释文字`,

  chapter: `你是一个小说章节格式化专家。用户的输入可能是：
1. 纯文本章节内容
2. Markdown 格式的章节文档
3. JSON 格式的章节对象（可能包含 title, content, summary 等字段）
4. 包含章节内容的各类数据

你的任务：
1. 识别输入的格式
2. 提取关键信息：标题(title)、内容(content)、章节摘要(summary)
3. **尽量提取以下关联信息**（如果内容中提到）：
   - **volumeTitle**: 所属卷的标题（如果知道）
4. 返回标准化的 JSON 格式：

\`\`\`json
{
  "title": "章节标题",
  "content": "完整的章节正文内容",
  "summary": "用户提供的章节摘要（如果有）",
  "volumeTitle": "所属卷的标题（如果知道的话）"
}
\`\`\`

注意事项：
- content 应该是完整的正文，不包含元数据标记
- summary 仅在用户明确提供时填写，不要自动生成或截取
- volumeTitle 如果无法确定，可以省略该字段
- 只返回 JSON，不要有其他解释文字`,
}

function detectModuleFromContent(content: string): ImportTargetModule | null {
  const lowerContent = content.toLowerCase()

  if (lowerContent.includes('章节') || lowerContent.includes('chapter') ||
      lowerContent.includes('第') && (lowerContent.includes('章') || lowerContent.includes('回'))) {
    return 'chapter'
  }

  if (lowerContent.includes('卷') || lowerContent.includes('部') ||
      lowerContent.includes('volume') || lowerContent.includes('book')) {
    return 'volume'
  }

  if (lowerContent.includes('角色') || lowerContent.includes('人物') ||
      lowerContent.includes('character') || lowerContent.includes(' protagonist') ||
      lowerContent.includes(' antagonist')) {
    return 'character'
  }

  if (lowerContent.includes('设定') || lowerContent.includes('世界观') ||
      lowerContent.includes('setting') || lowerContent.includes('worldbuild')) {
    return 'setting'
  }

  if (lowerContent.includes('规则') || lowerContent.includes('rule') ||
      lowerContent.includes('写作') || lowerContent.includes('writing')) {
    return 'rule'
  }

  if (lowerContent.includes('伏笔') || lowerContent.includes('foreshadowing') ||
      lowerContent.includes('悬念') || lowerContent.includes('线索')) {
    return 'foreshadowing'
  }

  if (lowerContent.includes('总纲') || lowerContent.includes('大纲') ||
      lowerContent.includes('主线') || lowerContent.includes('master outline')) {
    return 'master_outline'
  }

  return null
}

function tryParseJSON(content: string): { success: boolean; data?: unknown; error?: string } {
  try {
    const trimmed = content.trim()

    if (trimmed.startsWith('```json')) {
      const jsonContent = trimmed.slice(7, trimmed.lastIndexOf('```')).trim()
      return { success: true, data: JSON.parse(jsonContent) }
    }

    if (trimmed.startsWith('```')) {
      const jsonContent = trimmed.slice(3, trimmed.lastIndexOf('```')).trim()
      try {
        return { success: true, data: JSON.parse(jsonContent) }
      } catch {
        return { success: false, error: 'JSON 解析失败' }
      }
    }

    return { success: true, data: JSON.parse(trimmed) }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

export async function formatImportData(
  content: string,
  targetModule: ImportTargetModule,
  novelId?: string,
  db?: any
): Promise<FormattedImportData> {
  const result: FormattedImportData = {
    module: targetModule,
    data: {},
    rawContent: content,
    parseStatus: 'success',
  }

  const trimmedContent = content.trim()

  if (!trimmedContent) {
    result.parseStatus = 'error'
    result.parseMessage = '输入内容为空'
    return result
  }

  if (trimmedContent.startsWith('{') || trimmedContent.startsWith('[') ||
      trimmedContent.startsWith('```json') || trimmedContent.startsWith('```')) {
    const jsonResult = tryParseJSON(trimmedContent)
    if (jsonResult.success && jsonResult.data) {
      if (Array.isArray(jsonResult.data)) {
        result.data = { items: jsonResult.data }
        result.parseMessage = `成功解析 JSON 数组，包含 ${jsonResult.data.length} 个元素`
      } else {
        result.data = jsonResult.data as Record<string, unknown>
        result.parseMessage = '成功解析 JSON 对象'
      }

      const detectedModule = detectModuleFromContent(trimmedContent)
      if (detectedModule && detectedModule !== targetModule) {
        result.parseStatus = 'warning'
        result.parseMessage += `（警告：检测到内容可能属于 ${detectedModule} 模块，而非选择的 ${targetModule} 模块）`
      }

      return result
    }
  }

  let llmConfig
  try {
    llmConfig = await resolveConfig(db, 'workshop', novelId || '')
    llmConfig.apiKey = llmConfig.apiKey || ''
  } catch {
    try {
      llmConfig = await resolveConfig(db, 'chapter_gen', novelId || '')
      llmConfig.apiKey = llmConfig.apiKey || ''
    } catch {
      result.parseStatus = 'error'
      result.parseMessage = '未配置 AI 模型，请先在模型配置页面配置 "创作工坊" 或 "章节生成" 模型'
      return result
    }
  }

  const systemPrompt = MODULE_PROMPTS[targetModule]
  const userContent = `请格式化以下数据（目标是导入到【${targetModule}】模块）：

${trimmedContent}`

  try {
    const { generate } = await import('./llm')
    const response = await generate(llmConfig, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ])

    const responseText = response.text.trim()

    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/) ||
                       responseText.match(/^\s*(\{[\s\S]*\}|\[[\s\S]*\])\s*$/)

    if (jsonMatch) {
      const jsonStr = jsonMatch[1].trim()
      try {
        const parsed = JSON.parse(jsonStr)
        result.data = parsed
        result.parseMessage = 'AI 解析成功'
        return result
      } catch {
        result.parseStatus = 'warning'
        result.parseMessage = 'AI 返回了非标准 JSON，已尝试解析'
        result.data = { raw: responseText }
        return result
      }
    }

    result.parseStatus = 'warning'
    result.parseMessage = 'AI 未返回标准 JSON 格式'
    result.data = { raw: responseText }
    return result
  } catch (error) {
    result.parseStatus = 'error'
    result.parseMessage = `AI 解析失败: ${(error as Error).message}`
    return result
  }
}
