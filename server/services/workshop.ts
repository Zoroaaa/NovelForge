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
  novelSettings,
  writingRules,
  foreshadowing,
  entityIndex,
} = schema

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
  /** @description 预计总字数，可能是数字或描述性文本（如"约50万字"） */
  targetWordCount?: string
  /** @description 预计章节数，可能是数字或描述性文本（如"约200章"） */
  targetChapters?: string
  worldSettings?: Array<{ type: string; title: string; content: string; importance?: string }>
  masterOutline?: string
  characters?: Array<{
    name: string
    role: string
    description: string
    aliases?: string[]
    powerLevel?: string
    attributes?: Record<string, any>
    relationships?: string[]
  }>
  volumes?: Array<{
    title: string
    outline: string
    blueprint: string
    chapterCount: number
    summary?: string
    eventLine?: string[]
    notes?: string[]
    keyEvents?: string[]
    foreshadowingSetup?: string[]
    foreshadowingResolve?: string[]
    targetWordCount?: number | null
    targetChapterCount?: number | null
  }>
  chapters?: Array<{
    title: string
    outline: string
    summary?: string
    characters?: string[]
    foreshadowingActions?: Array<{
      action: string
      target: string
      description: string
    }>
    keyScenes?: string[]
  }>
  writingRules?: Array<{
    category: string
    title: string
    content: string
    priority?: number
  }>
}

/**
 * 创建新的 Workshop 会话
 * 如果传入了 novelId，会自动带入该小说已有的数据到 extractedData
 * stage 决定带入哪些阶段的数据：
 * - worldbuild: 带入 concept 数据（小说名、总纲）
 * - character_design: 带入 concept + worldbuild 数据
 * - volume_outline: 带入 concept + worldbuild + character 数据
 */
export async function createWorkshopSession(
  env: Env,
  data: {
    novelId?: string
    stage?: string
  }
): Promise<any> {
  const db = drizzle(env.DB)

  let extractedData: WorkshopExtractedData = {}

  if (data.novelId) {
    extractedData = await loadNovelContextData(db, data.novelId, data.stage || 'concept')
  }

  const [session] = await db.insert(workshopSessions).values({
    novelId: data.novelId || null,
    stage: data.stage || 'concept',
    messages: JSON.stringify([]),
    extractedData: JSON.stringify(extractedData),
    status: 'active',
  }).returning()

  return session
}

/**
 * 从已有小说加载上下文数据到 extractedData
 */
async function loadNovelContextData(
  db: any,
  novelId: string,
  targetStage: string
): Promise<WorkshopExtractedData> {
  const extractedData: WorkshopExtractedData = {}

  const novel = await db
    .select()
    .from(novels)
    .where(eq(novels.id, novelId))
    .get()

  if (!novel) {
    return extractedData
  }

  extractedData.title = novel.title
  if (novel.genre) extractedData.genre = novel.genre
  if (novel.description) extractedData.description = novel.description
  if (novel.targetWordCount) extractedData.targetWordCount = String(novel.targetWordCount)
  if (novel.targetChapterCount) extractedData.targetChapters = String(novel.targetChapterCount)

  if (targetStage === 'worldbuild' || targetStage === 'character_design' || targetStage === 'volume_outline') {
    const outline = await db
      .select()
      .from(masterOutline)
      .where(eq(masterOutline.novelId, novelId))
      .get()

    if (outline) {
      if (outline.summary) extractedData.description = outline.summary
      if (outline.content) extractedData.masterOutline = outline.content
    }
  }

  if (targetStage === 'character_design' || targetStage === 'volume_outline' || targetStage === 'chapter_outline') {
    const settings = await db
      .select()
      .from(novelSettings)
      .where(eq(novelSettings.novelId, novelId))
      .get()

    if (settings) {
      const allSettings = await db
        .select()
        .from(novelSettings)
        .where(eq(novelSettings.novelId, novelId))
        .all()

      const worldSettings: Array<{ type: string; title: string; content: string }> = []
      const settingTypes = ['geography', 'power_system', 'faction', 'worldview', 'item_skill', 'misc']
      for (const type of settingTypes) {
        const typeSettings = allSettings.filter((s: typeof allSettings[number]) => s.type === type)
        if (typeSettings.length > 0) {
          const typeLabel = {
            geography: '地理环境',
            power_system: '境界体系',
            faction: '势力组织',
            worldview: '世界观',
            item_skill: '宝物功法',
            misc: '其他设定'
          }[type] || type
          worldSettings.push({
            type,
            title: typeLabel,
            content: typeSettings.map((s: typeof allSettings[number]) => `- ${s.name}: ${s.content}`).join('\n'),
          })
        }
      }

      if (worldSettings.length > 0) {
        extractedData.worldSettings = worldSettings
      }
    }
  }

  if (targetStage === 'volume_outline') {
    const chars = await db
      .select()
      .from(characters)
      .where(eq(characters.novelId, novelId))
      .all()

    if (chars.length > 0) {
      extractedData.characters = chars.map((c: typeof chars[number]) => {
        let parsedAttrs = {}
        try {
          parsedAttrs = c.attributes ? JSON.parse(c.attributes) : {}
        } catch (e) {
          console.warn('[workshop] 解析角色attributes失败:', e)
        }

        return {
          name: c.name,
          role: c.role || 'supporting',
          description: c.description || '',
          aliases: c.aliases ? JSON.parse(c.aliases) : undefined,
          attributes: parsedAttrs,
          relationships: (parsedAttrs as any).relationships || undefined,
          powerLevel: c.powerLevel || undefined,
        }
      })
    }
  }

  if (targetStage === 'chapter_outline') {
    const vols = await db
      .select()
      .from(volumes)
      .where(eq(volumes.novelId, novelId))
      .all()

    if (vols.length > 0) {
      extractedData.volumes = vols.map((v: typeof vols[number]) => {
        let eventLine: string[] = []
        let notes: string[] = []
        try {
          if (v.eventLine) eventLine = JSON.parse(v.eventLine)
          if (v.notes) notes = JSON.parse(v.notes)
        } catch (e) {
          console.warn('[workshop] 解析卷eventLine/notes失败:', e)
        }

        return {
          title: v.title,
          summary: v.summary || '',
          blueprint: v.blueprint || '',
          chapterCount: v.chapterCount || 0,
          eventLine,
          notes,
          targetWordCount: v.targetWordCount || null,
          targetChapterCount: v.targetChapterCount || null,
        }
      })
    }

    const chars = await db
      .select()
      .from(characters)
      .where(eq(characters.novelId, novelId))
      .all()

    if (chars.length > 0) {
      extractedData.characters = chars.map((c: typeof chars[number]) => {
        let parsedAttrs = {}
        try {
          parsedAttrs = c.attributes ? JSON.parse(c.attributes) : {}
        } catch (e) {
          console.warn('[workshop] 解析角色attributes失败:', e)
        }

        return {
          name: c.name,
          role: c.role || 'supporting',
          description: c.description || '',
          aliases: c.aliases ? JSON.parse(c.aliases) : undefined,
          attributes: parsedAttrs,
          relationships: (parsedAttrs as any).relationships || undefined,
          powerLevel: c.powerLevel || undefined,
        }
      })
    }

    const existingChapters = await db
      .select()
      .from(chapters)
      .where(eq(chapters.novelId, novelId))
      .all()

    if (existingChapters.length > 0) {
      extractedData.chapters = existingChapters.map((ch: typeof existingChapters[number]) => ({
        title: ch.title,
        summary: ch.summary || '',
        outline: ch.content || '',
        characters: [],
      }))
    }
  }

  return extractedData
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
  stageOverride: string | undefined,
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

    // 3. 用前端传来的 stage 覆盖 DB 里的值（解决切换竞态）
    const activeStage = stageOverride || session.stage
    if (stageOverride && stageOverride !== session.stage) {
      await db.update(workshopSessions)
        .set({ stage: stageOverride, updatedAt: Math.floor(Date.now() / 1000) })
        .where(eq(workshopSessions.id, sessionId))
        .run()
    }

    // 4. 添加用户消息到历史
    messages.push({
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    })

    // 4. 构建系统 Prompt（使用 activeStage）
    const systemPrompt = buildSystemPrompt(activeStage, currentData)

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
        const newExtractedData = extractStructuredData(fullResponse, activeStage, currentData)

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

        // 11. AI自动生成标题（借鉴OSSshelf-main AIChatRoutes:325-345）
        // 仅当会话没有标题时，后台异步生成
        if (!session.title && messages.length >= 2) {
          console.log('[workshop] 📝 Auto-generating title for session:', sessionId)
          try {
            // 使用 generate 函数（非流式）调用AI生成标题
            const { generate } = await import('./llm')
            
            const titleMessages = [
              {
                role: 'system' as const,
                content: '用 8-12 个中文字概括用户对话的主题。只输出标题，不加标点和解释。'
              },
              {
                role: 'user' as const,
                content: `用户说：${messages[0].content}\nAI回复（前200字）：${fullResponse.slice(0, 200)}`
              }
            ]

            // 调用AI生成标题（非流式）
            const titleResult = await generate(llmConfig, titleMessages)

            const generatedTitle = titleResult.text.trim().slice(0, 20)
            
            if (generatedTitle && generatedTitle !== '创作对话') {
              // 更新数据库中的标题
              await db.update(workshopSessions)
                .set({ 
                  title: generatedTitle,
                  updatedAt: Math.floor(Date.now() / 1000)
                })
                .where(eq(workshopSessions.id, sessionId))
                .run()

              console.log('[workshop] ✅ Title auto-generated by AI:', generatedTitle)
            } else {
              console.log('[workshop] ℹ️ Title generation skipped (empty or default)')
            }
          } catch (titleError) {
            // 标题生成失败不影响主流程，仅记录日志
            console.warn('[workshop] ⚠️ Failed to auto-generate title:', titleError)
          }
        }

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
        targetWordCount: data.targetWordCount ? parseInt(data.targetWordCount, 10) : null,
        targetChapterCount: data.targetChapters ? parseInt(data.targetChapters, 10) : null,
      }).returning()

      novelId = novel.id
      createdItems.novel = novel
    }

    if (!novelId) {
      throw new Error('No novel ID available')
    }

    // 1.5 更新已有小说的目标字数和章节数
    if (novelId && (data.targetWordCount || data.targetChapters)) {
      const updateData: any = {}
      if (data.targetWordCount) {
        updateData.targetWordCount = parseInt(data.targetWordCount, 10)
      }
      if (data.targetChapters) {
        updateData.targetChapterCount = parseInt(data.targetChapters, 10)
      }
      await db.update(novels).set(updateData).where(eq(novels.id, novelId)).run()
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

    // 3. 创建世界设定 -> novelSettings
    if (data.worldSettings && data.worldSettings.length > 0) {
      const createdSettings: any[] = []
      for (const setting of data.worldSettings) {
        const [novelSetting] = await db.insert(novelSettings).values({
          novelId,
          type: setting.type,
          category: setting.type,
          name: setting.title,
          content: setting.content,
          importance: setting.importance || 'normal',
          sortOrder: createdSettings.length,
        }).returning()
        createdSettings.push(novelSetting)

        try {
          const { generateSettingSummary } = await import('./agent/summarizer')
          await generateSettingSummary(env, novelSetting.id)
        } catch (err) {
          console.warn('[workshop] 设定摘要生成失败:', err)
        }
      }
      createdItems.worldSettings = createdSettings
    }

    // 4. 创建创作规则 -> writingRules
    if (data.writingRules && data.writingRules.length > 0) {
      const createdRules: any[] = []
      for (const rule of data.writingRules) {
        const [writingRule] = await db.insert(writingRules).values({
          novelId,
          category: rule.category || 'custom',
          title: rule.title,
          content: rule.content,
          priority: rule.priority || 3,
          isActive: 1,
          sortOrder: createdRules.length,
        }).returning()
        createdRules.push(writingRule)
      }
      createdItems.writingRules = createdRules
    }

    // 5. 创建角色 -> characters
    if (data.characters && data.characters.length > 0) {
      const createdCharacters = []
      for (const char of data.characters) {
        const finalAttributes = {
          ...(char.attributes || {}),
          ...(char.relationships ? { relationships: char.relationships } : {}),
        }

        const [character] = await db.insert(characters).values({
          novelId,
          name: char.name,
          role: char.role || 'supporting',
          description: char.description || '',
          aliases: char.aliases ? JSON.stringify(char.aliases) : null,
          powerLevel: char.powerLevel || null,
          attributes: Object.keys(finalAttributes).length > 0 
            ? JSON.stringify(finalAttributes) 
            : null,
        }).returning()
        createdCharacters.push(character)
      }
      createdItems.characters = createdCharacters
    }

    // 6. 创建卷 -> volumes
    if (data.volumes && data.volumes.length > 0) {
      const createdVolumes: any[] = []
      for (const vol of data.volumes) {
        const summaryValue = vol.summary || null
        const eventLineValue = Array.isArray(vol.eventLine)
          ? JSON.stringify(vol.eventLine)
          : null
        const notesValue = Array.isArray(vol.notes)
          ? JSON.stringify(vol.notes)
          : null

        const [volume] = await db.insert(volumes).values({
          novelId,
          title: vol.title,
          summary: summaryValue,
          blueprint: vol.blueprint || null,
          eventLine: eventLineValue,
          notes: notesValue,
          chapterCount: 0,
          targetWordCount: vol.targetWordCount || null,
          targetChapterCount: vol.targetChapterCount || null,
          sortOrder: createdVolumes.length,
          status: 'draft',
        }).returning()
        createdVolumes.push(volume)

        try {
          const { generateVolumeSummary } = await import('./agent/summarizer')
          await generateVolumeSummary(env, volume.id, novelId)
        } catch (err) {
          console.warn('[workshop] 卷摘要生成失败:', err)
        }

        if (notesValue) {
          try {
            const notesData = JSON.parse(notesValue)
            for (const note of notesData) {
              const noteStr = typeof note === 'string' ? note : note.title || JSON.stringify(note)
              const noteDesc = typeof note === 'string' 
                ? `来自卷"${vol.title}"的备注` 
                : note.description || ''

              await db.insert(foreshadowing).values({
                novelId,
                title: noteStr,
                description: noteDesc,
                status: 'open',
                importance: 'normal',
              }).run()
            }
          } catch (err) {
            console.warn('[workshop] 伏笔/备注解析失败:', err)
          }
        }
      }
      createdItems.volumes = createdVolumes

      // 6.5 创建章节 -> chapters
      if (data.chapters && data.chapters.length > 0) {
        const volumeIdMap: Map<number, string> = new Map()
        let chapterIndex = 0
        for (let v = 0; v < createdVolumes.length; v++) {
          const volChapterCount = data.volumes[v]?.chapterCount || 0
          for (let c = 0; c < volChapterCount && chapterIndex < data.chapters.length; c++) {
            volumeIdMap.set(chapterIndex, createdVolumes[v].id)
            chapterIndex++
          }
        }

        const createdChapters: any[] = []
        for (let i = 0; i < data.chapters.length; i++) {
          const ch = data.chapters[i]
          const [chapter] = await db.insert(chapters).values({
            novelId,
            volumeId: volumeIdMap.get(i) || null,
            title: ch.title,
            sortOrder: i,
            content: ch.outline || null,
            wordCount: (ch.outline || '').length,
            status: 'outline',
            summary: ch.summary || null,
          }).returning()
          createdChapters.push(chapter)
        }
        createdItems.chapters = createdChapters
      }
    }

    // 7. 更新 entityIndex 总索引
    await rebuildEntityIndex(db, novelId, data)

    // 8. 更新会话状态为已提交
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
  // 把已有数据序列化为只读上下文（AI 可以参考，但不能修改）
  const readonlyCtx = buildReadonlyContext(stage, currentData)

  const stagePrompts: Record<string, string> = {
    concept: `你是专业的小说策划顾问。你正处于【概念构思】阶段。

${readonlyCtx}

## 你在本阶段的任务
帮用户完善小说的基本概念：类型/流派、世界观背景、主角设定、核心冲突/爽点、预计篇幅、文风要求。
每次提问不超过 2-3 个，保持自然对话。

## 输出约束（严格执行）
- 当信息足够时，输出如下 JSON 代码块进行汇总
- ⛔ 禁止输出 worldSettings / characters / volumes / chapters 字段，这些属于其他阶段
- ✅ 只允许输出以下字段：

\`\`\`json
{
  "title": "小说标题",
  "genre": "流派",
  "description": "一句话简介",
  "coreAppeal": ["核心爽点1", "核心爽点2"],
  "targetWordCount": "预计总字数",
  "targetChapters": "预计章节数",
  "writingRules": [
    {"category": "world", "title": "核心主题", "content": "..."},
    {"category": "style", "title": "文风要求", "content": "..."}
  ]
}
\`\`\`

## writingRules.category 可选类别参考：
- style: 文风
- pacing: 节奏
- character: 角色一致性
- plot: 情节
- world: 世界观
- taboo: 禁忌事项
- custom: 自定义`,

    worldbuild: `你是世界构建大师。你正处于【世界观构建】阶段。

${readonlyCtx}

## 你在本阶段的任务
帮用户完善世界观：世界观、境界体系、势力组织、地理环境、宝物功法、其他设定。
先讨论关键设定点，收集足够信息后输出最终结构化文档。

## 输出约束（严格执行）
- ⛔ 禁止输出 title / genre / description / coreAppeal / targetWordCount / targetChapters / writingRules / characters / volumes / chapters 字段，这些属于其他阶段
- ✅ 只允许输出以下字段：

\`\`\`json
{
  "worldSettings": [
    {"type": "worldview", "title": "世界观", "content": "..."},
    {"type": "power_system", "title": "境界体系", "content": "..."},
    {"type": "faction", "title": "势力组织", "content": "..."},
    {"type": "geography", "title": "地理环境", "content": "..."},
    {"type": "item_skill", "title": "宝物功法", "content": "..."},
    {"type": "misc", "title": "其他设定", "content": "..."}
  ]
}
\`\`\`

注意：设定要自洽，输出的 worldSettings 是完整版本（替换旧版本，而非追加）。`,

    character_design: `你是角色塑造专家。你正处于【角色设计】阶段。

${readonlyCtx}

## 你在本阶段的任务
帮用户设计角色：主角（1-2人）、主要配角（3-5人）、反派（1-2人）。
每个角色需要：姓名、性格、外貌、背景、目标、与其他角色的关系。

## 输出约束（严格执行）
- ⛔ 禁止输出 title / genre / description / coreAppeal / targetWordCount / targetChapters / writingRules / worldSettings / volumes / chapters 字段，这些属于其他阶段
- ✅ 只允许输出以下字段：

\`\`\`json
{
  "characters": [
    {
      "name": "角色名",
      "role": "protagonist|supporting|antagonist|minor",
      "description": "详细描述...",
      "aliases": ["别名1", "别名2"],
      "attributes": {"key": "value", "relationships": ["与其他角色的关系"]},
      "powerLevel": "战斗力等级"
    }
  ]
}
\`\`\`

注意：角色要立体，输出的 characters 是完整版本（替换旧版本）。`,

    volume_outline: `你是故事架构师。你正处于【卷纲规划】阶段。

${readonlyCtx}

## 你在本阶段的任务
帮用户将故事分成若干卷（建议 3-8 卷），为每卷制定：标题、主要事件线、关键转折点、伏笔安排、预计章节数和目标字数。

## 输出约束（严格执行）
- ⛔ 禁止输出 title / genre / description / coreAppeal / targetWordCount / targetChapters / writingRules / worldSettings / characters / chapters 字段，这些属于其他阶段
- ✅ 只允许输出以下字段：

\`\`\`json
{
  "volumes": [
    {
      "title": "第一卷标题",
      "summary": "本卷主要内容概述（1-2句话）",
      "blueprint": "详细的情节蓝图...",
      "eventLine": ["关键事件1", "重要转折点"],
      "notes": ["伏笔1", "备注信息"],
      "targetWordCount": 50000,
      "targetChapterCount": 15
    }
  ]
}
\`\`\`

注意：每卷都要有明确冲突和高潮，输出的 volumes 是完整版本（替换旧版本）。`,

    chapter_outline: `你是细化的故事编辑。你正处于【章节大纲细化】阶段。

${readonlyCtx}

## 你在本阶段任务
帮用户将卷纲拆分为具体章节，为每章制定：标题、核心任务、开头场景、结尾悬念、出场角色、伏笔操作。
注意根据每卷的目标字数和章节数，合理分配每章的内容量。

## 输出约束（严格执行）
- ⛔ 禁止输出 title / genre / description / coreAppeal / targetWordCount / targetChapters / writingRules / worldSettings / characters / volumes 字段，这些属于其他阶段
- ✅ 只允许输出以下字段：

\`\`\`json
{
  "chapters": [
    {
      "title": "第X章 标题",
      "summary": "本章简要概述",
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

注意：每章都要有实质性内容推进，输出的 chapters 是完整版本（替换旧版本）。`,
  }

  return stagePrompts[stage] || stagePrompts.concept
}

/**
 * 构建只读上下文：当前阶段可以参考哪些已有数据，但不能修改
 */
function buildReadonlyContext(stage: string, data: WorkshopExtractedData): string {
  const parts: string[] = ['## 当前已有数据（只读参考，禁止在 JSON 输出中修改这些字段）']

  // concept 阶段：没有只读上下文（它是起点）
  if (stage === 'concept') {
    if (data.title || data.genre || data.description) {
      parts.push(`### 已有概念信息\n${JSON.stringify({ title: data.title, genre: data.genre, description: data.description, targetWordCount: data.targetWordCount, targetChapters: data.targetChapters }, null, 2)}`)
    } else {
      return ''
    }
    return parts.join('\n')
  }

  // worldbuild 阶段：可以参考 concept 数据
  if (stage === 'worldbuild') {
    parts.push(`### 小说概念（只读）\n${JSON.stringify({ title: data.title, genre: data.genre, description: data.description, coreAppeal: data.coreAppeal, targetWordCount: data.targetWordCount, targetChapters: data.targetChapters }, null, 2)}`)
    if (data.worldSettings?.length) {
      parts.push(`### 已有世界观（本阶段可修改/完善，但必须完整输出替换版本）\n${JSON.stringify(data.worldSettings, null, 2)}`)
    }
    return parts.join('\n')
  }

  // character_design 阶段：可以参考 concept + worldbuild
  if (stage === 'character_design') {
    parts.push(`### 小说概念（只读）\n${JSON.stringify({ title: data.title, genre: data.genre, description: data.description, targetWordCount: data.targetWordCount, targetChapters: data.targetChapters }, null, 2)}`)
    if (data.worldSettings?.length) {
      parts.push(`### 世界观设定（只读）\n${JSON.stringify(data.worldSettings, null, 2)}`)
    }
    if (data.characters?.length) {
      parts.push(`### 已有角色（本阶段可修改/完善，但必须完整输出替换版本）\n${JSON.stringify(data.characters, null, 2)}`)
    }
    return parts.join('\n')
  }

  // volume_outline 阶段：可以参考 concept + worldbuild + character
  if (stage === 'volume_outline') {
    parts.push(`### 小说概念（只读）\n${JSON.stringify({ title: data.title, genre: data.genre, description: data.description, targetWordCount: data.targetWordCount, targetChapters: data.targetChapters }, null, 2)}`)
    if (data.worldSettings?.length) {
      parts.push(`### 世界观设定（只读）\n${JSON.stringify(data.worldSettings, null, 2)}`)
    }
    if (data.characters?.length) {
      parts.push(`### 角色设定（只读）\n${JSON.stringify(data.characters, null, 2)}`)
    }
    if (data.volumes?.length) {
      parts.push(`### 已有卷纲（本阶段可修改/完善，但必须完整输出替换版本）\n${JSON.stringify(data.volumes, null, 2)}`)
    }
    return parts.join('\n')
  }

  // chapter_outline 阶段：可以参考 concept + worldbuild + volumes + characters + existing chapters
  if (stage === 'chapter_outline') {
    parts.push(`### 小说概念（只读）\n${JSON.stringify({ title: data.title, genre: data.genre, description: data.description, targetWordCount: data.targetWordCount, targetChapters: data.targetChapters }, null, 2)}`)
    if (data.worldSettings?.length) {
      parts.push(`### 世界观设定（只读）\n${JSON.stringify(data.worldSettings, null, 2)}`)
    }
    if (data.characters?.length) {
      parts.push(`### 角色设定（只读）\n${JSON.stringify(data.characters, null, 2)}`)
    }
    if (data.volumes?.length) {
      parts.push(`### 卷纲规划（只读）\n${JSON.stringify(data.volumes, null, 2)}`)
    }
    if (data.chapters?.length) {
      parts.push(`### 已有章节大纲（本阶段可修改/完善，但必须完整输出替换版本）\n${JSON.stringify(data.chapters, null, 2)}`)
    }
    return parts.join('\n')
  }

  return ''
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
          if (parsed.writingRules) newData.writingRules = parsed.writingRules
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

        case 'chapter_outline':
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

async function rebuildEntityIndex(
  db: any,
  novelId: string,
  data: WorkshopExtractedData
): Promise<void> {
  const now = Math.floor(Date.now() / 1000)

  const entries = []

  entries.push({
    entityType: 'novel',
    entityId: novelId,
    novelId,
    parentId: null,
    title: data.title || '未命名小说',
    sortOrder: 0,
    depth: 0,
  })

  if (data.worldSettings) {
    for (let i = 0; i < data.worldSettings.length; i++) {
      const setting = data.worldSettings[i]
      entries.push({
        entityType: 'setting',
        entityId: `ws_${i}`,
        novelId,
        parentId: novelId,
        title: setting.title,
        sortOrder: i,
        depth: 1,
        meta: JSON.stringify({ type: setting.type }),
      })
    }
  }

  if (data.characters) {
    for (let i = 0; i < data.characters.length; i++) {
      const char = data.characters[i]
      entries.push({
        entityType: 'character',
        entityId: `char_${i}`,
        novelId,
        parentId: novelId,
        title: char.name,
        sortOrder: i,
        depth: 1,
        meta: JSON.stringify({ role: char.role }),
      })
    }
  }

  if (data.volumes) {
    for (let i = 0; i < data.volumes.length; i++) {
      const vol = data.volumes[i]
      entries.push({
        entityType: 'volume',
        entityId: `vol_${i}`,
        novelId,
        parentId: novelId,
        title: vol.title,
        sortOrder: i,
        depth: 1,
      })
    }
  }

  if (data.chapters) {
    for (let i = 0; i < data.chapters.length; i++) {
      const ch = data.chapters[i]
      entries.push({
        entityType: 'chapter',
        entityId: `ch_${i}`,
        novelId,
        parentId: novelId,
        title: ch.title,
        sortOrder: i,
        depth: 1,
        meta: JSON.stringify({ summary: ch.summary }),
      })
    }
  }

  if (entries.length > 1) {
    for (const entry of entries.slice(1)) {
      await db.insert(entityIndex).values({
        ...entry,
        updatedAt: now,
      }).onConflictDoNothing().run()
    }
  }
}
