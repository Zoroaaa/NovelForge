/**
 * @file workshop.ts
 * @description 创作工坊服务层 - 对话式创作引擎核心逻辑
 * @version 1.0.0
 * @created 2026-04-21 - Phase 3 对话式创作引擎
 */
import { drizzle } from 'drizzle-orm/d1'
import { eq, and, sql } from 'drizzle-orm'
import type { Env } from '../lib/types'
import * as schema from '../db/schema'
import { resolveConfig } from './llm'

const {
  workshopSessions,
  novels,
  masterOutline,
  characters,
  volumes,
  chapters,
} = schema

// ============================================================
// Phase 3.2: 分层 Prompt 体系
// ============================================================

export const WORKSHOP_PROMPTS = {
  /**
   * 阶段 1：概念构思
   * 输入：用户的一句话描述
   * 输出：小说名 + 总纲 + 核心设定（类型、流派、核心爽点）
   */
  concept: `你是一个专业的小说策划顾问。用户想要写一部小说，你需要通过提问帮助他们完善创意。

你的任务：
1. 理解用户的初始想法
2. 提出关键问题来明确：
   - 小说类型/流派（玄幻/都市/科幻/言情/悬疑等）
   - 世界观背景（古代/现代/未来/架空等）
   - 主角设定（身份、性格、起点状态）
   - 核心冲突/爽点（读者最期待的是什么）
   - 预计篇幅（短篇/中篇/长篇，大概多少字）

输出格式要求：
- 用自然语言与用户对话
- 当收集到足够信息后，用以下 JSON 格式总结（放在代码块中）：
\`\`\`json
{
  "title": "小说标题",
  "genre": "流派",
  "description": "一句话简介",
  "coreAppeal": ["核心爽点1", "核心爽点2"],
  "targetWordCount": "预计总字数",
  "targetChapters": "预计章节数"
}
\`\`\`

注意事项：
- 每次只问 2-3 个问题，不要一次问太多
- 保持友好、专业的语气
- 如果用户已经提供了某些信息，就不要重复询问`,

  /**
   * 阶段 2：世界观构建
   * 输入：概念阶段的结果 + 用户补充
   * 输出：完整的世界观文档（3000 字左右）
   */
  worldbuild: `你是一个世界构建大师。现在我们要为一部小说建立详细的世界观。

当前小说信息：
{{concept_data}}

你的任务：
1. 帮助用户完善世界观的各个方面：
   - 地理环境（大陆/国家/城市/重要地点）
   - 力量体系（修炼等级/魔法系统/科技水平）
   - 势力格局（正派/反派/中立势力）
   - 历史背景（重大历史事件/传说/神话）
   - 社会规则（经济/政治/文化/法律）
   - 特殊设定（如果有的话）

输出格式：
- 先与用户讨论关键设定点
- 最终生成结构化的世界观文档（2000-3000字）
- 使用以下 JSON 格式输出最终结果：

\`\`\`json
{
  "worldSettings": [
    {
      "type": "geography",
      "title": "地理环境",
      "content": "详细描述..."
    },
    {
      "type": "power_system",
      "title": "力量体系",
      "content": "详细描述..."
    }
  ]
}
\`\`\`

注意事项：
- 设定要自洽，不能前后矛盾
- 要有特色，避免过于俗套
- 考虑后续剧情发展的可能性`,

  /**
   * 阶段 3：角色设计
   * 输入：总纲 + 世界观
   * 输出：角色卡（主角/配角/反派）
   */
  character_design: `你是一个角色塑造专家。现在我们要为小说设计角色。

当前小说信息：
{{concept_data}}
{{worldbuild_data}}

你的任务：
1. 帮助用户设计以下角色：
   - **主角**（1-2人）：姓名、性格、外貌、背景、目标、成长弧线
   - **主要配角**（3-5人）：与主角的关系、作用、特点
   - **反派**（1-2人）：动机、能力、与主角的冲突

对每个角色，需要讨论：
- 基本信息（姓名、年龄、性别、身份）
- 性格特征（优点、缺点、怪癖）
- 外貌描写（标志性特征）
- 能力/技能（如果是战斗类小说）
- 与其他角色的关系
- 在故事中的作用和发展

输出格式：
\`\`\`json
{
  "characters": [
    {
      "name": "角色名",
      "role": "protagonist|supporting|antagonist",
      "description": "详细描述...",
      "attributes": {"key": "value"},
      "relationships": ["与其他角色的关系"]
    }
  ]
}
\`\`\`

注意事项：
- 角色要有立体感，避免脸谱化
- 角色之间要有化学反应
- 反派要有合理的动机，不要太脸谱化
- 考虑角色成长的可能性`,

  /**
   * 阶段 4：卷纲规划
   * 输入：总纲 + 角色
   * 输出：卷纲（事件线+蓝图）
   */
  volume_outline: `你是一个故事架构师。现在我们要为小说规划分卷大纲。

当前小说信息：
{{concept_data}}
{{character_data}}

你的任务：
1. 帮助用户将故事分成若干卷（建议 3-8 卷）
2. 为每卷制定：
   - 卷标题
   - 主要事件线（起承转合）
   - 关键转折点
   - 涉及的主要角色
   - 伏笔安排（埋入/收尾）
   - 预计章节数

输出格式：
\`\`\`json
{
  "volumes": [
    {
      "title": "第一卷标题",
      "outline": "本卷主要内容概述...",
      "blueprint": "详细的情节蓝图...",
      "chapterCount": 10,
      "keyEvents": ["事件1", "事件2"],
      "foreshadowingSetup": ["伏笔1", "伏笔2"],
      "foreshadowingResolve": []
    }
  ]
}
\`\`\`

注意事项：
- 每卷都要有明确的冲突和高潮
- 卷与卷之间要衔接自然
- 控制好节奏，张弛有度
- 埋下的伏笔要在后续卷中收尾`,

  /**
   * 阶段 5：章节大纲细化
   * 输入：卷纲 + 前情
   * 输出：章节大纲（关键事件+伏笔指令）
   */
  chapter_outline: `你是一个细化的故事编辑。现在我们要为每一章制定详细大纲。

当前卷的信息：
{{volume_data}}

你的任务：
1. 将卷纲拆分为具体的章节
2. 为每章制定：
   - 章节标题
   - 本章的核心任务（推进什么剧情）
   - 开头场景（如何承接上章）
   - 结尾悬念（如何吸引读下去）
   - 出场角色
   - 重要对话/描写要点
   - 伏笔操作（埋入或收尾哪个伏笔）

输出格式：
\`\`\`json
{
  "chapters": [
    {
      "title": "第X章 标题",
      "outline": "本章大纲...",
      "characters": ["出场角色"],
      "foreshadowingActions": [
        {"action": "setup|resolve", "target": "伏笔名称", "description": "如何操作"}
      ],
      "keyScenes": ["场景1", "场景2"]
    }
  ]
}
\`\`\`

注意事项：
- 每章都要有实质性的内容推进
- 注意节奏变化，不要每章都一样
- 伏笔的埋入和收尾要自然
- 考虑读者的阅读体验`,
}

// ============================================================
// Workshop 服务函数
// ============================================================

export interface WorkshopMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export interface WorkshopExtractedData {
  title?: string
  genre?: string
  description?: string
  coreAppeal?: string[]
  targetWordCount?: string
  targetChapters?: string
  worldSettings?: Array<{ type: string; title: string; content: string }>
  characters?: Array<{
    name: string
    role: string
    description: string
    attributes?: Record<string, any>
    relationships?: string[]
  }>
  volumes?: Array<{
    title: string
    outline: string
    blueprint: string
    chapterCount: number
    keyEvents?: string[]
    foreshadowingSetup?: string[]
    foreshadowingResolve?: string[]
  }>
  chapters?: Array<{
    title: string
    outline: string
    characters?: string[]
    foreshadowingActions?: Array<{
      action: string
      target: string
      description: string
    }>
    keyScenes?: string[]
  }>
}

/**
 * 创建新的 Workshop 会话
 */
export async function createWorkshopSession(
  env: Env,
  data: {
    novelId?: string
    stage?: string
  }
): Promise<any> {
  const db = drizzle(env.DB)

  const [session] = await db.insert(workshopSessions).values({
    novelId: data.novelId || null,
    stage: data.stage || 'concept',
    messages: JSON.stringify([]),
    extractedData: JSON.stringify({}),
    status: 'active',
  }).returning()

  return session
}

/**
 * 获取 Workshop 会话详情
 */
export async function getWorkshopSession(
  env: Env,
  sessionId: string
): Promise<any> {
  const db = drizzle(env.DB)

  const session = await db
    .select()
    .from(workshopSessions)
    .where(eq(workshopSessions.id, sessionId))
    .get()

  if (!session) {
    throw new Error('Workshop session not found')
  }

  return session
}

/**
 * Phase 3.1-3: 对话式 AI 引擎 - 处理用户消息并返回 AI 回复（SSE 流式）
 */
export async function processWorkshopMessage(
  env: Env,
  sessionId: string,
  userMessage: string,
  onChunk: (text: string) => void,
  onDone: (extractedData: WorkshopExtractedData) => void,
  onError: (error: Error) => void
): Promise<void> {
  const db = drizzle(env.DB)

  try {
    // 1. 获取会话
    const session = await getWorkshopSession(env, sessionId)
    if (!session) {
      throw new Error('Session not found')
    }

    // 2. 解析现有消息历史
    const messages: WorkshopMessage[] = JSON.parse(session.messages || '[]')
    const currentData: WorkshopExtractedData = JSON.parse(session.extractedData || '{}')

    // 3. 添加用户消息到历史
    messages.push({
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    })

    // 4. 构建系统 Prompt
    const systemPrompt = buildSystemPrompt(session.stage, currentData)

    // 5. 构建 LLM 消息数组
    const llmMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    ]

    // 6. 获取模型配置（优先使用 'workshop' stage，fallback 到 'chapter_gen'）
    let llmConfig
    try {
      console.log('[workshop] Trying to get workshop model config...')
      llmConfig = await resolveConfig(drizzle(env.DB), 'workshop', session.novelId || '')
      llmConfig.apiKey = llmConfig.apiKey || ''
      console.log('[workshop] Using workshop-specific model config')
    } catch (workshopError) {
      const workshopErrorMsg = workshopError instanceof Error ? workshopError.message : String(workshopError)
      console.warn('[workshop] Workshop config not found, falling back to chapter_gen:', workshopErrorMsg)
      try {
        llmConfig = await resolveConfig(drizzle(env.DB), 'chapter_gen', session.novelId || '')
        llmConfig.apiKey = llmConfig.apiKey || ''
        console.log('[workshop] Using chapter_gen as fallback')
      } catch (chapterError) {
        const chapterErrorMsg = chapterError instanceof Error ? chapterError.message : String(chapterError)
        console.error('[workshop] No suitable model config found:', {
          workshopError: workshopErrorMsg,
          chapterError: chapterErrorMsg,
          novelId: session.novelId,
          sessionId
        })
        throw new Error(
          `❌ 未配置"创作工坊"模型！\n\n` +
          `请在全局模型配置页面（/model-config）添加以下任一配置：\n` +
          `1. 用途选择"创作工坊"(workshop) - 推荐\n` +
          `2. 或用途选择"章节生成"(chapter_gen) 作为备选\n\n` +
          `当前状态：\n` +
          `- workshop 配置：${workshopErrorMsg}\n` +
          `- chapter_gen 配置：${chapterErrorMsg}`
        )
      }
    }

    // 6. 调用 LLM 流式生成
    let fullResponse = ''

    // 导入 streamGenerate
    const { streamGenerate } = await import('./llm')

    // 6.5 先插入占位助手消息（确保即使中断也有记录，借鉴OSSshelf-main模式）
    const placeholderAssistantMsg: WorkshopMessage = {
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    }
    messages.push(placeholderAssistantMsg)
    await updateSession(db, sessionId, { messages, extractedData: currentData })

    await streamGenerate(llmConfig, llmMessages, {
      onChunk: (text) => {
        fullResponse += text
        // 实时更新占位消息内容
        messages[messages.length - 1] = {
          ...placeholderAssistantMsg,
          content: fullResponse,
        }
        onChunk(text)
      },
      onDone: async () => {
        // 8. 尝试从 AI 回复中提取结构化数据
        const newExtractedData = extractStructuredData(fullResponse, session.stage, currentData)

        // 9. 更新占位消息为最终内容（而非push新消息）
        messages[messages.length - 1] = {
          role: 'assistant',
          content: fullResponse,
          timestamp: Date.now(),
        }

        // 10. 更新数据库（必须await确保持久化完成）
        await updateSession(db, sessionId, {
          messages,
          extractedData: { ...currentData, ...newExtractedData },
        })

        console.log('[workshop] ✅ Assistant message saved to DB, length:', fullResponse.length)
        onDone(newExtractedData)
      },
      onError: async (error) => {
        // 错误时也保存已生成的部分内容
        if (fullResponse) {
          messages[messages.length - 1] = {
            role: 'assistant',
            content: fullResponse + '\n\n[生成中断]',
            timestamp: Date.now(),
          }
          await updateSession(db, sessionId, { messages, extractedData: currentData })
          console.log('[workshop] ⚠️ Partial message saved after error, length:', fullResponse.length)
        }
        onError(error)
      },
    })

  } catch (error) {
    console.error('Workshop message processing failed:', error)
    onError(error as Error)
  }
}

/**
 * 提交确认 - 将提取的数据写入正式表
 */
export async function commitWorkshopSession(
  env: Env,
  sessionId: string
): Promise<{ ok: boolean; novelId?: string; createdItems: any }> {
  const db = drizzle(env.DB)

  try {
    const session = await getWorkshopSession(env, sessionId)
    if (!session) {
      throw new Error('Session not found')
    }

    const data: WorkshopExtractedData = JSON.parse(session.extractedData || '{}')
    const createdItems: any = {}
    let novelId = session.novelId

    // 1. 创建/更新小说主表
    if (data.title && !novelId) {
      const [novel] = await db.insert(novels).values({
        title: data.title,
        description: data.description || '',
        genre: data.genre || '',
        status: 'draft',
        wordCount: 0,
        chapterCount: 0,
      }).returning()

      novelId = novel.id
      createdItems.novel = novel
    }

    if (!novelId) {
      throw new Error('No novel ID available')
    }

    // 2. 创建总纲
    if (data.title) {
      const outlineContent = buildOutlineContent(data)
      const [outline] = await db.insert(masterOutline).values({
        novelId,
        title: `${data.title} - 总纲`,
        content: outlineContent,
        version: 1,
        summary: data.description || '',
        wordCount: outlineContent.length,
      }).returning()

      createdItems.outline = outline
    }

    // 3. 创建角色
    if (data.characters && data.characters.length > 0) {
      const createdCharacters = []
      for (const char of data.characters) {
        const [character] = await db.insert(characters).values({
          novelId,
          name: char.name,
          role: char.role || 'supporting',
          description: char.description || '',
          attributes: char.attributes ? JSON.stringify(char.attributes) : null,
        }).returning()
        createdCharacters.push(character)
      }
      createdItems.characters = createdCharacters
    }

    // 4. 创建卷
    if (data.volumes && data.volumes.length > 0) {
      const createdVolumes: any[] = []
      for (const vol of data.volumes) {
        const [volume] = await db.insert(volumes).values({
          novelId,
          title: vol.title,
          summary: vol.outline || '',
          outline: vol.blueprint || '',
          sortOrder: createdVolumes.length + 1,
        }).returning()
        createdVolumes.push(volume)
      }
      createdItems.volumes = createdVolumes
    }

    // 5. 更新会话状态为已提交
    await db.update(workshopSessions)
      .set({ status: 'committed', novelId })
      .where(eq(workshopSessions.id, sessionId))

    return { ok: true, novelId, createdItems }
  } catch (error) {
    console.error('Commit workshop session failed:', error)
    throw error
  }
}

// ============================================================
// 内部辅助函数
// ============================================================

function buildSystemPrompt(stage: string, currentData: WorkshopExtractedData): string {
  const basePrompt = WORKSHOP_PROMPTS[stage as keyof typeof WORKSHOP_PROMPTS]

  if (!basePrompt) {
    return WORKSHOP_PROMPTS.concept
  }

  // 替换模板变量
  return basePrompt
    .replace('{{concept_data}}', JSON.stringify({
      title: currentData.title,
      genre: currentData.genre,
      description: currentData.description,
    }, null, 2))
    .replace('{{worldbuild_data}}', JSON.stringify(currentData.worldSettings || [], null, 2))
    .replace('{{character_data}}', JSON.stringify(currentData.characters || [], null, 2))
    .replace('{{volume_data}}', JSON.stringify(currentData.volumes || [], null, 2))
}

function extractStructuredData(
  aiResponse: string,
  stage: string,
  currentData: WorkshopExtractedData
): WorkshopExtractedData {
  const newData: WorkshopExtractedData = {}

  // 尝试从响应中提取 JSON 代码块
  const jsonMatch = aiResponse.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1].trim())

      // 根据 stage 合并数据
      switch (stage) {
        case 'concept':
          if (parsed.title) newData.title = parsed.title
          if (parsed.genre) newData.genre = parsed.genre
          if (parsed.description) newData.description = parsed.description
          if (parsed.coreAppeal) newData.coreAppeal = parsed.coreAppeal
          if (parsed.targetWordCount) newData.targetWordCount = parsed.targetWordCount
          if (parsed.targetChapters) newData.targetChapters = parsed.targetChapters
          break

        case 'worldbuild':
          if (parsed.worldSettings) newData.worldSettings = parsed.worldSettings
          break

        case 'character_design':
          if (parsed.characters) newData.characters = parsed.characters
          break

        case 'volume_outline':
          if (parsed.volumes) newData.volumes = parsed.volumes
          break

        case 'chapters':
          if (parsed.chapters) newData.chapters = parsed.chapters
          break
      }
    } catch (e) {
      console.warn('Failed to parse structured data from AI response:', e)
    }
  }

  return newData
}

async function updateSession(
  db: any,
  sessionId: string,
  updates: {
    messages: WorkshopMessage[]
    extractedData: WorkshopExtractedData
  }
): Promise<void> {
  await db.update(workshopSessions)
    .set({
      messages: JSON.stringify(updates.messages),
      extractedData: JSON.stringify(updates.extractedData),
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(workshopSessions.id, sessionId))
}

function buildOutlineContent(data: WorkshopExtractedData): string {
  const parts: string[] = []

  if (data.description) parts.push(`## 简介\n${data.description}`)
  if (data.coreAppeal?.length) parts.push(`## 核心看点\n${data.coreAppeal.join('\n')}`)
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
    data.volumes.forEach((vol, idx) => parts.push(`### 第${idx + 1}卷：${vol.title}\n${vol.outline}`))
  }

  return parts.join('\n\n')
}
