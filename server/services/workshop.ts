/**
 * @file workshop.ts
 * @description 创作工坊服务层 - 对话式创作引擎核心逻辑
 * @version 1.0.0
 * @created 2026-04-21 - Phase 3 对话式创作引擎
 */
import { drizzle } from 'drizzle-orm/d1'
import { eq, and, isNull, sql } from 'drizzle-orm'
import type { Env } from '../lib/types'
import * as schema from '../db/schema'
import { resolveConfig } from './llm'
import { enqueue } from '../lib/queue'

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
 * 每个阶段加载本阶段及之前所有阶段的数据
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

  if (targetStage === 'concept' || targetStage === 'worldbuild' || targetStage === 'character_design' || targetStage === 'volume_outline' || targetStage === 'chapter_outline') {
    const outline = await db
      .select()
      .from(masterOutline)
      .where(and(eq(masterOutline.novelId, novelId), isNull(masterOutline.deletedAt)))
      .get()

    if (outline && outline.content) {
      extractedData.coreAppeal = extractCoreAppealFromContent(outline.content)
    }

    const rules = await db
      .select()
      .from(writingRules)
      .where(and(eq(writingRules.novelId, novelId), isNull(writingRules.deletedAt)))
      .all()

    if (rules.length > 0) {
      extractedData.writingRules = rules.map((r: typeof rules[number]) => ({
        category: r.category,
        title: r.title,
        content: r.content,
        priority: r.priority,
      }))
    }
  }

  if (targetStage === 'worldbuild' || targetStage === 'character_design' || targetStage === 'volume_outline' || targetStage === 'chapter_outline') {
    const settings = await db
      .select()
      .from(novelSettings)
      .where(and(eq(novelSettings.novelId, novelId), isNull(novelSettings.deletedAt)))
      .all()

    if (settings.length > 0) {
      const worldSettings: Array<{ type: string; title: string; content: string; importance: string }> = []
      const settingTypes = ['geography', 'power_system', 'faction', 'worldview', 'item_skill', 'misc']
      for (const type of settingTypes) {
        const typeSettings = settings.filter((s: typeof settings[number]) => s.type === type)
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
            content: typeSettings.map((s: typeof settings[number]) => `- ${s.name}: ${s.content}`).join('\n'),
            importance: typeSettings[0]?.importance || 'normal',
          })
        }
      }

      if (worldSettings.length > 0) {
        extractedData.worldSettings = worldSettings
      }
    }
  }

  if (targetStage === 'character_design' || targetStage === 'volume_outline' || targetStage === 'chapter_outline') {
    const chars = await db
      .select()
      .from(characters)
      .where(and(eq(characters.novelId, novelId), isNull(characters.deletedAt)))
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

  if (targetStage === 'volume_outline' || targetStage === 'chapter_outline') {
    const vols = await db
      .select()
      .from(volumes)
      .where(and(eq(volumes.novelId, novelId), isNull(volumes.deletedAt)))
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
  }

  if (targetStage === 'chapter_outline') {
    const existingChapters = await db
      .select()
      .from(chapters)
      .where(and(eq(chapters.novelId, novelId), isNull(chapters.deletedAt)))
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

function extractCoreAppealFromContent(content: string): string[] | undefined {
  const coreAppealMatch = content.match(/## 核心看点\n([\s\S]*?)(?=\n## |$)/i)
  if (coreAppealMatch) {
    const lines = coreAppealMatch[1].trim().split('\n').filter(line => line.trim())
    return lines.length > 0 ? lines : undefined
  }
  return undefined
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
    const isNewNovel = !session.novelId

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
    const systemPrompt = buildSystemPrompt(activeStage, currentData, isNewNovel)

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
 * 提交确认 - 将提取的数据写入正式表（供队列调用的核心逻辑）
 */
export async function commitWorkshopSessionCore(
  env: Env,
  sessionId: string
): Promise<{ ok: boolean; novelId?: string; createdItems: any }> {
  const db = drizzle(env.DB)

  const session = await getWorkshopSession(env, sessionId)
  if (!session) {
    throw new Error('Session not found')
  }

  const data: WorkshopExtractedData = JSON.parse(session.extractedData || '{}')
  const createdItems: any = {}
  let novelId = session.novelId
  const stage = session.stage || 'concept'
  const isNewNovel = !novelId

  // 1. 创建/更新小说主表
  if (data.title && isNewNovel) {
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

  // 1.5 更新已有小说的目标字数和章节数（仅 concept 阶段或新建时更新）
  if (isNewNovel && (data.targetWordCount || data.targetChapters)) {
    const updateData: any = {}
    if (data.targetWordCount) {
      updateData.targetWordCount = parseInt(data.targetWordCount, 10)
    }
    if (data.targetChapters) {
      updateData.targetChapterCount = parseInt(data.targetChapters, 10)
    }
    await db.update(novels).set(updateData).where(eq(novels.id, novelId)).run()
  }

  // 2. 总纲 - concept 阶段或新建时创建/更新
  if (data.title && (isNewNovel || stage === 'concept')) {
    const outlineContent = await buildOutlineContentWithAI(env, data)
    await db.delete(masterOutline).where(eq(masterOutline.novelId, novelId)).run()
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

  // 3. 世界设定 -> novelSettings - worldbuild 阶段或新建时创建/更新
  if (data.worldSettings && data.worldSettings.length > 0 && (isNewNovel || stage === 'worldbuild')) {
    const existingSettings = await db
      .select()
      .from(novelSettings)
      .where(and(eq(novelSettings.novelId, novelId), isNull(novelSettings.deletedAt)))
      .all()
    const settingMap = new Map(
      existingSettings.map((s: typeof existingSettings[number]) => [`${s.type}:${s.name}`, s])
    )

    const createdSettings: any[] = []
    for (const setting of data.worldSettings) {
      const key = `${setting.type}:${setting.title}`
      const existing = settingMap.get(key)

      if (existing) {
        await db.update(novelSettings)
          .set({
            content: setting.content,
            importance: setting.importance || 'normal',
            updatedAt: Math.floor(Date.now() / 1000),
          })
          .where(eq(novelSettings.id, existing.id))
          .run()
        createdSettings.push({ ...existing, content: setting.content })
      } else {
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
      }

      const novelSetting = createdSettings[createdSettings.length - 1]
      try {
        const { generateSettingSummary } = await import('./agent/summarizer')
        await generateSettingSummary(env, novelSetting.id)
      } catch (err) {
        console.warn('[workshop] 设定摘要生成失败:', err)
      }

      try {
        const updatedSetting = await db.select().from(novelSettings).where(eq(novelSettings.id, novelSetting.id)).get()
        const indexContent = updatedSetting?.summary || novelSetting.content.slice(0, 500)

        await enqueue(env, {
          type: 'index_content',
          payload: {
            sourceType: 'setting',
            sourceId: novelSetting.id,
            novelId: novelSetting.novelId,
            title: novelSetting.name,
            content: indexContent,
          },
        })
      } catch (err) {
        console.warn(`[workshop] 设定向量化失败 ${novelSetting.name}:`, err)
      }
    }
    createdItems.worldSettings = createdSettings
  }

  // 4. 创作规则 -> writingRules - concept 阶段或新建时创建/更新
  if (data.writingRules && data.writingRules.length > 0 && (isNewNovel || stage === 'concept')) {
    const existingRules = await db
      .select()
      .from(writingRules)
      .where(and(eq(writingRules.novelId, novelId), isNull(writingRules.deletedAt)))
      .all()
    const ruleMap = new Map(
      existingRules.map((r: typeof existingRules[number]) => [`${r.category}:${r.title}`, r])
    )

    const createdRules: any[] = []
    for (const rule of data.writingRules) {
      const key = `${rule.category || 'custom'}:${rule.title}`
      const existing = ruleMap.get(key)

      if (existing) {
        await db.update(writingRules)
          .set({
            content: rule.content,
            priority: rule.priority || 3,
            updatedAt: Math.floor(Date.now() / 1000),
          })
          .where(eq(writingRules.id, existing.id))
          .run()
        createdRules.push({ ...existing, content: rule.content, priority: rule.priority || 3 })
      } else {
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
    }
    createdItems.writingRules = createdRules
  }

  // 5. 角色 -> characters - character_design 阶段或新建时创建/更新
  if (data.characters && data.characters.length > 0 && (isNewNovel || stage === 'character_design')) {
    const existingCharacters = await db
      .select()
      .from(characters)
      .where(and(eq(characters.novelId, novelId), isNull(characters.deletedAt)))
      .all()
    const charMap = new Map(
      existingCharacters.map((c: typeof existingCharacters[number]) => [c.name, c])
    )

    const createdCharacters = []
    for (const char of data.characters) {
      const finalAttributes = {
        ...(char.attributes || {}),
        ...(char.relationships ? { relationships: char.relationships } : {}),
      }

      const existing = charMap.get(char.name)
      let character: any

      if (existing) {
        await db.update(characters)
          .set({
            role: char.role || 'supporting',
            description: char.description || '',
            aliases: char.aliases ? JSON.stringify(char.aliases) : null,
            powerLevel: char.powerLevel || null,
            attributes: Object.keys(finalAttributes).length > 0
              ? JSON.stringify(finalAttributes)
              : null,
            updatedAt: Math.floor(Date.now() / 1000),
          })
          .where(eq(characters.id, existing.id))
          .run()
        character = {
          ...existing,
          role: char.role || 'supporting',
          description: char.description || '',
          powerLevel: char.powerLevel || null,
        }
      } else {
        const [newChar] = await db.insert(characters).values({
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
        character = newChar
      }
      createdCharacters.push(character)

      try {
        const indexText = [
          `${character.name}${character.role ? ` (${character.role})` : ''}`,
          (character.description || '').slice(0, 300),
          character.powerLevel ? `境界：${character.powerLevel}` : '',
        ].filter(Boolean).join('\n')

        await enqueue(env, {
          type: 'index_content',
          payload: {
            sourceType: 'character',
            sourceId: character.id,
            novelId: character.novelId,
            title: character.name,
            content: indexText,
          },
        })
      } catch (err) {
        console.warn(`[workshop] 角色向量化失败 ${character.name}:`, err)
      }
    }
    createdItems.characters = createdCharacters
  }

  // 6. 卷 -> volumes - volume_outline 阶段或新建时创建/更新
  if (data.volumes && data.volumes.length > 0 && (isNewNovel || stage === 'volume_outline')) {
    const existingVolumes = await db
      .select()
      .from(volumes)
      .where(and(eq(volumes.novelId, novelId), isNull(volumes.deletedAt)))
      .all()
    const volumeMap = new Map(
      existingVolumes.map((v: typeof existingVolumes[number]) => [v.title, v])
    )

    const createdVolumes: any[] = []
    for (const vol of data.volumes) {
      const summaryValue = vol.summary || null
      const eventLineValue = Array.isArray(vol.eventLine)
        ? JSON.stringify(vol.eventLine)
        : null
      const notesValue = Array.isArray(vol.notes)
        ? JSON.stringify(vol.notes)
        : null

      const existing = volumeMap.get(vol.title)
      let volume: any

      if (existing) {
        await db.update(volumes)
          .set({
            summary: summaryValue,
            blueprint: vol.blueprint || null,
            eventLine: eventLineValue,
            notes: notesValue,
            targetWordCount: vol.targetWordCount || null,
            targetChapterCount: vol.targetChapterCount || null,
            sortOrder: createdVolumes.length,
            updatedAt: Math.floor(Date.now() / 1000),
          })
          .where(eq(volumes.id, existing.id))
          .run()
        volume = {
          ...existing,
          summary: summaryValue,
          blueprint: vol.blueprint || null,
          eventLine: eventLineValue,
          notes: notesValue,
        }
      } else {
        const [newVolume] = await db.insert(volumes).values({
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
        volume = newVolume
      }
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
              ? `来自卷"${vol.title}"的创作注意事项`
              : note.description || ''

            await db.insert(foreshadowing).values({
              novelId,
              title: `[备注] ${noteStr}`,
              description: noteDesc,
              status: 'open',
              importance: 'low',
            }).run()
          }
        } catch (err) {
          console.warn('[workshop] 备注解析失败:', err)
        }
      }

      if (vol.foreshadowingSetup?.length) {
        for (const item of vol.foreshadowingSetup) {
          const parenMatch = item.match(/^(.+?)（(.+)）$/)
          const title = parenMatch ? parenMatch[1].trim() : item.split('（')[0].trim()
          const desc = parenMatch ? parenMatch[2].trim() : item

          await db.insert(foreshadowing).values({
            novelId,
            title,
            description: `【埋入计划】${desc}\n【所属卷】${vol.title}`,
            status: 'open',
            importance: 'normal',
          }).run()
        }
      }

      if (vol.foreshadowingResolve?.length) {
        for (const item of vol.foreshadowingResolve) {
          const parenMatch = item.match(/^(.+?)（(.+)）$/)
          const title = parenMatch ? parenMatch[1].trim() : item.split('（')[0].trim()
          const desc = parenMatch ? parenMatch[2].trim() : item

          await db.insert(foreshadowing).values({
            novelId,
            title,
            description: `【回收计划】${desc}\n【所属卷】${vol.title}`,
            status: 'open',
            importance: 'normal',
          }).run()
        }
      }
    }
    createdItems.volumes = createdVolumes
  }

  // 6.5 章节 -> chapters - chapter_outline 阶段或新建时创建/更新
  if (data.chapters && data.chapters.length > 0 && (isNewNovel || stage === 'chapter_outline')) {
    const existingChapters = await db
      .select()
      .from(chapters)
      .where(and(eq(chapters.novelId, novelId), isNull(chapters.deletedAt)))
      .all()
    const chapterMap = new Map(
      existingChapters.map((c: typeof existingChapters[number]) => [c.title, c])
    )

    const volumeIdMap: Map<number, string> = new Map()
    if (createdItems.volumes && createdItems.volumes.length > 0 && data.volumes) {
      let chapterIndex = 0
      for (let v = 0; v < data.volumes.length; v++) {
        const volChapterCount = data.volumes[v]?.chapterCount || 0
        for (let c = 0; c < volChapterCount && chapterIndex < data.chapters.length; c++) {
          volumeIdMap.set(chapterIndex, createdItems.volumes[v].id)
          chapterIndex++
        }
      }
    }

    const createdChapters: any[] = []
    for (let i = 0; i < data.chapters.length; i++) {
      const ch = data.chapters[i]
      const existing = chapterMap.get(ch.title)
      let chapter: any

      if (existing) {
        await db.update(chapters)
          .set({
            volumeId: volumeIdMap.get(i) || existing.volumeId,
            sortOrder: i,
            content: ch.outline || null,
            wordCount: (ch.outline || '').length,
            summary: ch.summary || null,
            updatedAt: Math.floor(Date.now() / 1000),
          })
          .where(eq(chapters.id, existing.id))
          .run()
        chapter = {
          ...existing,
          volumeId: volumeIdMap.get(i) || existing.volumeId,
          sortOrder: i,
          content: ch.outline || null,
          summary: ch.summary || null,
        }
      } else {
        const [newChapter] = await db.insert(chapters).values({
          novelId,
          volumeId: volumeIdMap.get(i) || null,
          title: ch.title,
          sortOrder: i,
          content: ch.outline || null,
          wordCount: (ch.outline || '').length,
          status: 'outline',
          summary: ch.summary || null,
        }).returning()
        chapter = newChapter
      }
      createdChapters.push(chapter)
    }
    createdItems.chapters = createdChapters
  }

  // 7. 更新 entityIndex 总索引
  await rebuildEntityIndex(db, novelId, data)

  // 8. 更新会话状态为已提交
  await db.update(workshopSessions)
    .set({ status: 'committed', novelId })
    .where(eq(workshopSessions.id, sessionId))

  return { ok: true, novelId, createdItems }
}

/**
 * 提交确认 - 异步模式（通过队列执行）
 */
export async function commitWorkshopSession(
  env: Env,
  sessionId: string
): Promise<{ ok: boolean; novelId?: string; createdItems: any }> {
  await enqueue(env, { type: 'commit_workshop', payload: { sessionId } })
  return { ok: true, novelId: undefined, createdItems: {} }
}

// ============================================================
// 内部辅助函数
// ============================================================

function buildSystemPrompt(stage: string, currentData: WorkshopExtractedData, isNewNovel: boolean): string {
  const readonlyCtx = buildReadonlyContext(stage, currentData)

  const stagePrompts: Record<string, string> = {
    concept: `你是专业的小说策划顾问，擅长帮助作者明确创作方向。你正处于【概念构思】阶段。

${readonlyCtx}

## 输出模式（重要，请先判断）
- **新建小说**：全量输出，输出完整的故事策划案（title/genre/description/coreAppeal/targetWordCount/targetChapters/writingRules）
- **已有小说**：${!isNewNovel ? '【增量输出模式】如果只修改了部分字段（如只改了 genre），只输出变更的字段即可，无需重复已确认的内容。例如只改了 genre，就只输出 \`{"genre": "新类型"}\`；如果标题错了要改，才需要把 title 加进来。所有字段都是可选的，只输出你被要求修改的字段。' : '【全量输出模式】输出完整的故事策划案。'}

## 本阶段目标
通过对话，帮用户确定以下五个核心维度。每次只问1-2个问题，保持自然的对话节奏：

**必须明确的五个维度：**
1. **类型与基调** — 具体流派（如"东方玄幻-仙侠修真-宗门争霸"），不接受"玄幻"这种泛化回答
2. **主角起点与驱动力** — 主角的初始处境 + 推动他行动的核心动机
3. **核心爽点** — 读者追更的理由（如"低调装逼打脸流""从被废到无敌""系统流"）
4. **故事走向与终局** — 大方向，哪怕模糊也要有
5. **体量与节奏** — 预计字数/章节数，以及整体节奏风格（爽文快节奏 or 慢热世界观流）

信息收集完整后，输出结构化汇总。

---

## 输出内容约束（严格执行）

### description 必须包含四个要素：
格式：[主角身份] + [初始处境/困境] + [核心目标] + [独特钩子/差异化]
示例：\`"废材少爷林岩被逐出家门，偶得上古传承，从最底层修炼者开始，以碾压式实力逐步征服天玄大陆，揭开自身身世之谜"\`
❌ 禁止：\`"一部热血的修仙小说，讲述主角的成长故事"\` —— 这种描述没有任何信息量

### writingRules 必须是对 AI 写章节时有实际约束力的规则：

✅ 有效规则示例（具体、可执行、边界清晰）：
- taboo类：\`"主角在未受到存亡威胁时不得主动杀戮无辜，违反会触发心魔，必须在后续章节体现影响"\`
- style类：\`"战斗描写必须包含：双方境界对比、核心招式名称、至少一次形势逆转，禁止出现'激战后获胜'的省略"\`
- pacing类：\`"每章结尾必须有悬念钩子或情绪留白，禁止以'一切归于平静'结束"\`
- character类：\`"主角对不同阶层的人说话方式必须有差异：对强者简洁直接，对弱者不卑不亢，对反派冷静鄙视"\`
- plot类：\`"能力提升必须有具体来源（修炼、机缘、悟道），禁止无铺垫的'突然顿悟'"\`

❌ 无效规则（禁止输出）：
- \`"文风要流畅自然"\` — 废话，不可执行
- \`"角色要立体丰满"\` — 空泛，无边界
- \`"情节逻辑要合理"\` — 无约束力

**每条规则 content 字段长度：50-150字，必须包含边界条件和违规后果（如有）**

---

## 输出格式（信息充足时输出）
⛔ 禁止输出 worldSettings / characters / volumes / chapters 字段

\`\`\`json
{
  "title": "小说正式标题",
  "genre": "一级类型-二级类型-三级标签，如：东方玄幻-仙侠修真-宗门争霸",
  "description": "必须包含四要素的一句话简介（60-100字）",
  "coreAppeal": [
    "核心爽点（具体，如：低调装逼打脸流）",
    "独特卖点（区别于同类的差异化）",
    "情感钩子（让读者持续追更的情感动力）"
  ],
  "targetWordCount": "数字，如：500",
  "targetChapters": "数字，如：1500",
  "writingRules": [
    {
      "category": "taboo",
      "title": "主角行为禁忌",
      "content": "具体禁止行为+边界条件+违规后果（50-150字）",
      "priority": 1
    },
    {
      "category": "style",
      "title": "战斗描写规范",
      "content": "战斗场景的必要元素和禁止写法（50-150字）",
      "priority": 2
    },
    {
      "category": "pacing",
      "title": "章节节奏要求",
      "content": "章节开结尾的具体要求（50-150字）",
      "priority": 2
    },
    {
      "category": "character",
      "title": "角色语言规范",
      "content": "不同场景/对象的说话方式差异要求（50-150字）",
      "priority": 3
    },
    {
      "category": "plot",
      "title": "能力成长规范",
      "content": "境界突破、能力获得的铺垫和限制（50-150字）",
      "priority": 2
    }
  ]
}
\`\`\`

writingRules.category 可选值：style（文风）/ pacing（节奏）/ character（角色一致性）/ plot（情节）/ world（世界观）/ taboo（禁忌）/ custom（自定义）
targetWordCount 和 targetChapters 只输出数字字符串，不含"万字"等单位。`,

    worldbuild: `你是世界构建大师。你正处于【世界观构建】阶段。

${readonlyCtx}

## 输出模式（重要，请先判断）
- **新建小说**：全量输出，每次对话后输出完整的 worldSettings（会替换数据库中的全部设定）
- **已有小说**：${!isNewNovel ? '【增量输出模式】只需要输出本次要新增或修改的设定，而不是全部设定。每条记录的 type+title 作为唯一键，命中则更新该条记录，未命中则新增。例如只修改了"玄灵宗"的设定，就只输出那一条；如果是全新的势力，才需要作为新记录输出。' : '【全量输出模式】输出完整的 worldSettings。'}

## 本阶段目标
帮用户完善小说的世界观体系。通过对话收集信息，最终输出结构化设定文档。

**重要**：每个独立的设定实体（每个势力、每套功法、每个地区）必须单独作为一条记录输出，不要合并。
这是因为章节生成时会按需精确召回单个设定，合并后无法准确检索。

## 各类型设定的 content 格式模板

### power_system（境界体系）— 整个体系只需一条记录
content 必须包含以下结构：
\`\`\`
【境界列表】从低到高，每个境界单独一行
炼气期（一至九层）：灵气感知与汇聚阶段，无法凌空御剑
筑基期（前中后期）：建立灵力根基，可御器飞行
金丹期：凝结金丹，寿元达500年
元婴期：神识可外放百丈
...（后续境界）

【突破条件】通用突破条件（灵气积累+机缘/感悟），特殊境界的特殊条件

【跨境界战力】同境界战力差异说明，是否存在跨级战斗可能

【独特规则】本小说境界体系的特殊规则（如有）：如废灵根的限制，特殊灵根的加成
\`\`\`

### faction（势力组织）— 每个势力单独一条记录
每条记录 title = 势力全名，content 必须包含：
\`\`\`
【性质】宗门/王朝/家族/邪道组织/...
【势力层级】在本小说世界的地位（如：三大宗门之一，掌控XX区域）
【控制区域】势力占据的地理范围
【实力标准】顶尖高手的境界水平
【与主角关系】主角初始关系（敌/友/中立/从属）及原因，后续走向
【核心矛盾】该势力内部或与外部的主要冲突（驱动剧情的矛盾点）
【重要人物】关键NPC：姓名·职位·境界（3-5人）
【特色资源】该势力独有的资源、传承或技术
\`\`\`

### geography（地理环境）— 每个重要地区/地点单独一条记录
每条记录 title = 地名，content 必须包含：
\`\`\`
【位置】在世界地图中的位置描述
【特点】地理特征和气候
【资源/危险】特有资源或危险因素
【控制势力】属于哪个势力或无主之地
【主角关联】主角何时会到达，在此发生什么重要事件（剧透式简述）
\`\`\`

### item_skill（功法/宝物）— 每套功法或重要宝物单独一条记录
每条记录 title = 功法/宝物名称，content 必须包含：
\`\`\`
【类型】功法/法宝/丹药/阵法/...
【来源/获取途径】
【效果与限制】具体效果，以及使用条件或副作用
【等级定位】对应境界体系中的档次
【主角是否拥有】是/否/将会获得（第X卷）
\`\`\`

### worldview（世界观）— 通常一条记录，包含宏观背景
content 必须包含：
\`\`\`
【世界背景】一段话的世界简介
【核心法则】影响所有角色的世界规律（天道/因果/修炼本质）
【当前格局】主要势力分布和当前时代的特征
【世界危机】驱动宏观剧情的深层危机（如有，可以是隐藏的）
【历史背景】影响当前剧情的重要历史事件（1-3个）
\`\`\`

### misc（其他设定）— 不属于以上类型的特殊设定
content 格式自由，但要求结构清晰，信息密度高。

---

## 对话建议顺序
1. 先讨论境界体系（这是整个世界的基础标尺）
2. 再讨论世界格局和主要势力
3. 然后讨论地理环境和重要地点
4. 最后讨论重要功法宝物

---

## 输出约束（严格执行）
⛔ 禁止输出其他阶段字段

\`\`\`json
{
  "worldSettings": [
    {
      "type": "power_system",
      "title": "【境界体系名称】修炼体系",
      "content": "按上方模板格式填写，信息完整",
      "importance": "high"
    },
    {
      "type": "worldview",
      "title": "天玄大陆世界观",
      "content": "按上方模板格式填写",
      "importance": "high"
    },
    {
      "type": "faction",
      "title": "玄灵宗（每个势力单独一条）",
      "content": "按上方模板格式填写",
      "importance": "high"
    },
    {
      "type": "faction",
      "title": "血煞门（单独一条）",
      "content": "按上方模板格式填写",
      "importance": "normal"
    },
    {
      "type": "geography",
      "title": "天云城（每个地点单独一条）",
      "content": "按上方模板格式填写",
      "importance": "normal"
    },
    {
      "type": "item_skill",
      "title": "混沌诀（每套功法单独一条）",
      "content": "按上方模板格式填写",
      "importance": "high"
    }
  ]
}
\`\`\`

importance 可选值：high（高频召回，如境界体系、主角势力）/ normal（按需召回）/ low（背景参考）

输出的 worldSettings 是完整版本（替换旧版本，仅限新建小说）。已有小说只输出增量。`,

    character_design: `你是角色塑造专家。你正处于【角色设计】阶段。

${readonlyCtx}

## 输出模式（重要，请先判断）
- **新建小说**：全量输出，输出完整的角色阵容
- **已有小说**：${!isNewNovel ? '【增量输出模式】只需要输出本次要新增或修改的角色，而不是全部角色。角色以 name 作为唯一键，命中则更新该角色，未命中则新增。例如只修改了"林岩"这个角色，就只输出那一个；如果是新角色，才需要作为新记录输出。' : '【全量输出模式】输出完整的角色阵容。'}

## 本阶段目标
设计完整的角色阵容。每个角色都要有鲜明的个性和在故事中的明确作用。

**角色数量建议：**
- 主角（protagonist）：1-2人（必须设计）
- 核心配角（supporting）：3-6人（主线相关）
- 主要反派（antagonist）：1-3人（有具体目标和手段）
- 重要NPC（minor）：若干（有名有姓、对主线有影响的）

## attributes 字段规范（必须严格遵守）

attributes 是 AI 生成章节时直接读取的角色数据，键名必须使用以下标准字段，不能自创键名：

\`\`\`json
{
  "personality": "性格特点，用3-6个具体关键词描述（如：外冷内热、睚眦必报、表面随和实则腹黑、对弱者同情对强者轻蔑）",
  "speechPattern": "说话方式和语言习惯（这是章节生成时约束对话的关键字段）。示例：惜字如金，非紧急情况不超过10个字；习惯用反问代替否定；爱引用古籍；语气带轻蔑，即使赞扬也像在嘲讽",
  "appearance": "外貌特征，1-2句话，突出辨识度（不要写'英俊帅气'这种无信息量描述）",
  "background": "对当前剧情有影响的背景故事，重点写创伤/执念/隐藏秘密",
  "goal": "初始阶段的核心目标（明确、具体，如：找到杀害父母的凶手、登顶境界证道、守护某人），后续会随剧情推进",
  "weakness": "性格弱点或心理禁忌（影响角色在关键时刻的决策，越具体越好）",
  "relationships": ["与角色A：关系性质+情感基础+潜在矛盾", "与角色B：..."]
}
\`\`\`

**personality 写法要求：**
- ✅ \`"外冷内热、睚眦必报、目的性极强、对弱者有隐藏的同情心"\` — 具体，可指导写作
- ❌ \`"性格坚强，意志坚定"\` — 所有主角的通用描述，无区分度

**speechPattern 写法要求（最重要，直接影响对话质量）：**
- ✅ \`"话少但精准，一句话里有两层含义；面对威胁从不急躁，反而语气更轻；称呼对方总是用'阁下'而不是'你'"\`
- ❌ \`"说话简洁有力"\` — 无法指导 AI 写出有特色的对话

**weakness 写法要求：**
- ✅ \`"对家人的软弱：任何威胁到家人的事会让他失去理智；执念于'不杀无辜'导致在灰色地带优柔寡断"\`
- ❌ \`"有时候太善良"\` — 无操作性

## powerLevel 规范

必须使用 power_system 设定中的精确境界名称。
\`\`\`
✅ "炼气期三层"
✅ "金丹期后期"
❌ "初级修炼者"（不在境界体系中）
❌ "很强"（无意义）
\`\`\`

## description 字段规范
200字以内，包含：角色在故事中的定位 + 与主角关系的核心张力 + 读者记住这个角色的理由

---

## 输出约束（严格执行）
⛔ 禁止输出其他阶段字段

\`\`\`json
{
  "characters": [
    {
      "name": "角色全名",
      "role": "protagonist|supporting|antagonist|minor",
      "description": "200字以内的综合定位描述",
      "aliases": ["常用称呼", "外号", "江湖称号"],
      "powerLevel": "精确境界名（与power_system一致）",
      "attributes": {
        "personality": "具体性格关键词，3-6个",
        "speechPattern": "说话方式的具体描述（2-4句）",
        "appearance": "外貌辨识特征（1-2句）",
        "background": "影响当前剧情的关键背景（创伤/秘密/执念）",
        "goal": "初始阶段明确目标",
        "weakness": "具体的性格弱点或心理禁忌",
        "relationships": ["与XXX：关系描述"]
      }
    }
  ]
}
\`\`\`

输出的 characters 是完整版本（替换旧版本，仅限新建小说）。已有小说只输出增量角色。`,

    volume_outline: `你是故事架构师。你正处于【卷纲规划】阶段。

${readonlyCtx}

## 输出模式（重要，请先判断）
- **新建小说**：全量输出，输出完整的卷纲
- **已有小说**：${!isNewNovel ? '【增量输出模式】只需要输出本次要新增或修改的卷，而不是全部卷。卷以 title 作为唯一键，命中则更新该卷，未命中则新增。例如只修改了"第一卷"的设定，就只输出那一个；如果是新卷，才需要作为新记录输出。' : '【全量输出模式】输出完整的卷纲。'}

## 本阶段目标
将整部小说规划为若干卷，每卷是一个完整的故事弧（有开端、发展、高潮、结局）。

**分卷建议：**
- 短篇（50-100万字）：3-5卷
- 中长篇（100-300万字）：5-10卷
- 超长篇（300万字以上）：10-20卷

**字数与章节数约束（严格遵守）：**
- 每章字数固定为 3000-5000 字
- targetWordCount / targetChapterCount 必须符合这个比例（约 4000 字/章）
- 例如：20万字 = 40-67章，约50章；30万字 = 60-100章，约75章
- eventLine 条数必须等于 targetChapterCount，多或少都必须对齐

---

## 关键格式要求（与章节生成系统的接口规范）

### eventLine 格式（最重要，严格执行）

eventLine 数组的每条记录必须对应一个章节，格式：
\`"第N章：[场景标签] 事件描述（起因→结果）"\`

**格式规则：**
- N 是该章在本卷内的序号（从1开始）
- 场景标签：用方括号标注主要场景，如 [宗门大殿] [荒野] [秘境内部]
- 事件描述：必须包含起因和结果，约30-50字

✅ 正确示例：
\`\`\`json
"eventLine": [
  "第1章：[天云城·考核场] 林岩以废材身份参加灵根测试，意外激活隐藏灵根，测试长老变色",
  "第2章：[考核场外] 林岩被嫉妒的师兄当众挑衅，首次运用隐藏灵根能力击败对方，引起骚动",
  "第3章：[外门废弃院落] 林岩被分配最差住所，发现房间暗格中藏有前辈遗留的功法残卷"
]
\`\`\`

❌ 错误示例（不可接受）：
\`\`\`json
"eventLine": ["主角入宗", "遭遇刁难", "发现传承"]
\`\`\`

**eventLine 的条数必须等于 targetChapterCount**，每条对应一章，这是硬性要求。

---

### blueprint 格式（结构化，AI生成章节时精确引用）

blueprint 必须按以下固定标签结构输出（标签名称不可修改）：

\`\`\`
【本卷主题】一句话说明本卷的核心议题和叙事重心

【开卷状态】主角在本卷第一章开始时的：位置·境界·目标·处境

【核心冲突】本卷的主要矛盾（明确双方、冲突根源、利益边界）

【关键节点】
- 节点1（约第X章）：[类型：转折/高潮/揭秘] 具体事件描述
- 节点2（约第X章）：...
（3-5个关键节点，驱动本卷叙事的锚点事件）

【卷末状态】主角在本卷最后一章结束时的：位置·境界·目标·与下卷的衔接点

【情感弧线】主角在本卷经历的核心情感/心态变化（如：从自卑到自信，从复仇执念到接受命运）

【伏笔规划】
- 埋入：[伏笔名称] 第X章前后，通过[具体方式]埋入
- 埋入：[伏笔名称] ...
- 回收：[伏笔名称] 第X章，以[方式]揭露
\`\`\`

---

## 输出约束（严格执行）
⛔ 禁止输出其他阶段字段

\`\`\`json
{
  "volumes": [
    {
      "title": "第一卷：卷标题（标题要体现本卷核心主题）",
      "summary": "本卷一句话概述：主角从[状态A]到[状态B]，通过[核心事件]实现[目标或转变]（30-50字）",
      "blueprint": "按上方【本卷主题】...【伏笔规划】标签格式完整填写",
      "eventLine": [
        "第1章：[场景标签] 事件描述（起因→结果）",
        "第2章：[场景标签] 事件描述（起因→结果）"
      ],
      "foreshadowingSetup": [
        "伏笔名称（第X章埋入，通过什么方式，读者视角是什么）"
      ],
      "foreshadowingResolve": [
        "伏笔名称（第X章回收，揭露方式和对剧情的影响）"
      ],
      "notes": [
        "本卷创作注意事项1（如：本卷不能让主角境界突破超过两个小境界）",
        "本卷需要为第二卷铺垫的关键信息"
      ],
      "targetWordCount": 200000,
      "targetChapterCount": 30
    }
  ]
}
\`\`\`

**再次强调**：eventLine 的数组长度必须等于 targetChapterCount。
如 targetChapterCount=30，则 eventLine 必须有30条，从"第1章"到"第30章"。

输出的 volumes 是完整版本（替换旧版本，仅限新建小说）。已有小说只输出增量卷。`,

    chapter_outline: `你是细化的故事编辑。你正处于【章节大纲细化】阶段。

${readonlyCtx}

## 输出模式（重要，请先判断）
- **新建小说**：全量输出，输出完整的章节大纲
- **已有小说**：${!isNewNovel ? '【增量输出模式】只需要输出本次要新增或修改的章节，而不是全部章节。章节以 title 作为唯一键，命中则更新该章节，未命中则新增。例如只修改了"第5章"的设定，就只输出那一个；如果是新章节，才需要作为新记录输出。' : '【全量输出模式】输出完整的章节大纲。'}

## 你在本阶段任务
帮用户将卷纲拆分为具体章节，为每章制定：标题、核心任务、开头场景、结尾悬念、出场角色、伏笔操作。
注意根据每卷的目标字数和章节数，合理分配每章的内容量。

## 章节标题序号规则（重要）
章节标题中的序号必须是**全局序号**，不是卷内序号。
- 第一卷：第1章、第2章、第3章...
- 第二卷：如果第一卷有30章，则从第31章开始
- 第三卷：如果前两卷共60章，则从第61章开始

计算方法：当前卷起始序号 = 前面所有卷的章节数之和 + 1

## 输出约束（严格执行）
- ⛔ 禁止输出 title / genre / description / coreAppeal / targetWordCount / targetChapters / writingRules / worldSettings / characters / volumes 字段，这些属于其他阶段
- ✅ 只允许输出以下字段：

\`\`\`json
{
  "chapters": [
    {
      "title": "第X章 标题（X是全局序号，非卷内序号）",
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

注意：每章都要有实质性内容推进，输出的 chapters 是完整版本（替换旧版本，仅限新建小说）。已有小说只输出增量章节。`,
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
    if (!data.title && !data.genre && !data.description) return ''

    const lines: string[] = ['## 当前已确认的概念信息（只读，无需重复询问）']
    if (data.title) lines.push(`**标题**：${data.title}`)
    if (data.genre) lines.push(`**类型**：${data.genre}`)
    if (data.description) lines.push(`**简介**：${data.description}`)
    if (data.targetWordCount) lines.push(`**目标字数**：${data.targetWordCount}万字`)
    if (data.targetChapters) lines.push(`**目标章节**：${data.targetChapters}章`)
    if (data.coreAppeal?.length) lines.push(`**核心爽点**：${data.coreAppeal.join('；')}`)
    if (data.writingRules?.length) {
      lines.push(`**已有创作规则**（${data.writingRules.length}条）：${data.writingRules.map(r => r.title).join('、')}`)
    }
    return lines.join('\n')
  }

  // worldbuild 阶段：可以参考 concept 数据
  if (stage === 'worldbuild') {
    const lines: string[] = ['## 当前已有信息（只读参考）']

    lines.push(`### 小说概念`)
    lines.push(`类型：${data.genre || '未定'} | 目标：${data.targetWordCount || '?'}万字 ${data.targetChapters || '?'}章`)
    lines.push(`简介：${data.description || '未定'}`)
    if (data.coreAppeal?.length) lines.push(`爽点：${data.coreAppeal.join('；')}`)

    if (data.worldSettings?.length) {
      lines.push(`\n### 已有世界设定（${data.worldSettings.length}条，本阶段可修改完善）`)
      const byType = data.worldSettings.reduce((acc, s) => {
        acc[s.type] = acc[s.type] || []
        acc[s.type].push(s.title)
        return acc
      }, {} as Record<string, string[]>)

      const typeLabels: Record<string, string> = {
        power_system: '境界体系', worldview: '世界观', faction: '势力',
        geography: '地理', item_skill: '功法宝物', misc: '其他'
      }
      for (const [type, titles] of Object.entries(byType)) {
        lines.push(`- ${typeLabels[type] || type}：${titles.join('、')}`)
      }
      lines.push(`\n如需查看某条设定的详细内容，请告知具体名称，我会展示给你。`)
    }

    return lines.join('\n')
  }

  // character_design 阶段：可以参考 concept + worldbuild
  if (stage === 'character_design') {
    const lines: string[] = ['## 当前已有信息（只读参考）']

    lines.push(`### 小说基础`)
    lines.push(`《${data.title}》 | ${data.genre}`)
    lines.push(`简介：${data.description}`)
    if (data.coreAppeal?.length) lines.push(`核心爽点：${data.coreAppeal.join('；')}`)

    if (data.worldSettings?.length) {
      const powerSystem = data.worldSettings.find(s => s.type === 'power_system')
      const factions = data.worldSettings.filter(s => s.type === 'faction')

      if (powerSystem) {
        lines.push(`\n### 境界体系（角色powerLevel必须参照此定义）`)
        const powerContent = powerSystem.content
        const listMatch = powerContent.match(/【境界列表】([\s\S]*?)(?=【|$)/)
        lines.push(listMatch ? `境界（从低到高）：${listMatch[1].trim().slice(0, 300)}` : powerContent.slice(0, 200))
      }

      if (factions.length) {
        lines.push(`\n### 主要势力（角色背景和关系需与此一致）`)
        factions.forEach(f => lines.push(`- ${f.title}`))
      }
    }

    if (data.characters?.length) {
      lines.push(`\n### 已有角色（${data.characters.length}人，本阶段可修改完善）`)
      data.characters.forEach(c => {
        lines.push(`- ${c.name}（${c.role}）：${c.description?.slice(0, 50)}...`)
      })
      lines.push(`如需查看某个角色的完整设定，请告知姓名。`)
    }

    return lines.join('\n')
  }

  // volume_outline 阶段：可以参考 concept + worldbuild + character
  if (stage === 'volume_outline') {
    const lines: string[] = ['## 当前已有信息（只读参考）']

    lines.push(`### 小说基础`)
    lines.push(`《${data.title}》 | ${data.genre} | 目标：${data.targetWordCount || '?'}万字 / ${data.targetChapters || '?'}章`)
    lines.push(`简介：${data.description}`)
    if (data.coreAppeal?.length) lines.push(`核心爽点：${data.coreAppeal.join('；')}`)

    if (data.worldSettings?.length) {
      lines.push(`\n### 世界设定摘要`)
      const powerSystem = data.worldSettings.find(s => s.type === 'power_system')
      if (powerSystem) {
        const listMatch = powerSystem.content.match(/【境界列表】([\s\S]*?)(?=【|$)/)
        const levels = listMatch ? listMatch[1].trim() : powerSystem.content.slice(0, 200)
        lines.push(`境界体系：${levels.slice(0, 200)}`)
      }
      const factions = data.worldSettings.filter(s => s.type === 'faction')
      if (factions.length) lines.push(`主要势力：${factions.map(f => f.title).join('、')}`)
      const geographies = data.worldSettings.filter(s => s.type === 'geography')
      if (geographies.length) lines.push(`重要地点：${geographies.map(g => g.title).join('、')}`)
    }

    if (data.characters?.length) {
      lines.push(`\n### 角色阵容`)
      const byRole: Record<string, string[]> = {}
      data.characters.forEach(c => {
        byRole[c.role] = byRole[c.role] || []
        byRole[c.role].push(c.name)
      })
      const roleLabels: Record<string, string> = {
        protagonist: '主角', supporting: '配角', antagonist: '反派', minor: 'NPC'
      }
      for (const [role, names] of Object.entries(byRole)) {
        lines.push(`${roleLabels[role] || role}：${names.join('、')}`)
      }
    }

    if (data.writingRules?.length) {
      const taboos = data.writingRules.filter(r => r.category === 'taboo' || r.priority === 1)
      if (taboos.length) {
        lines.push(`\n### 高优先级创作规则（卷纲必须遵守）`)
        taboos.forEach(r => lines.push(`- 【${r.title}】${r.content.slice(0, 80)}...`))
      }
    }

    if (data.volumes?.length) {
      lines.push(`\n### 已有卷纲（${data.volumes.length}卷，本阶段可修改完善）`)
      data.volumes.forEach((v, i) => {
        lines.push(`第${i+1}卷《${v.title}》：${v.summary || '暂无概述'} [${v.targetChapterCount || '?'}章/${v.targetWordCount ? Math.round(v.targetWordCount/10000)+'万字' : '?'}]`)
      })
    }

    return lines.join('\n')
  }

  // chapter_outline 阶段：可以参考 concept + worldbuild + volumes + characters + existing chapters
  if (stage === 'chapter_outline') {
    parts.push(`### 小说概念（只读）\n${JSON.stringify({ title: data.title, genre: data.genre, description: data.description, coreAppeal: data.coreAppeal, targetWordCount: data.targetWordCount, targetChapters: data.targetChapters, writingRules: data.writingRules }, null, 2)}`)
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

/**
 * 容错 JSON 解析：修复 AI 输出中字符串值内未转义的控制字符（换行、回车、制表符）。
 * blueprint / eventLine 等长文本字段在 AI 直接输出 JSON 时常含真实换行，
 * 导致 JSON.parse 抛错被 catch 吞掉，整个 extractedData.volumes 丢失。
 */
function safeParseJSON(raw: string): unknown {
  try { return JSON.parse(raw) } catch {}
  let inString = false
  let escaped = false
  let result = ''
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (escaped) { escaped = false; result += ch; continue }
    if (ch === '\\') { escaped = true; result += ch; continue }
    if (ch === '"') { inString = !inString; result += ch; continue }
    if (inString) {
      if (ch === '\n') { result += '\\n'; continue }
      if (ch === '\r') { result += '\\r'; continue }
      if (ch === '\t') { result += '\\t'; continue }
    }
    result += ch
  }
  return JSON.parse(result)
}

function extractStructuredData(
  aiResponse: string,
  stage: string,
  currentData: WorkshopExtractedData
): WorkshopExtractedData {
  const newData: WorkshopExtractedData = {}

  // 尝试从响应中提取 JSON 代码块（贪婪匹配最后一个，避免被 AI 回复中的示例块干扰）
  const allJsonMatches = [...aiResponse.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)]
  
  // 优先取最后一个 json 块（AI 通常先解释再输出最终 JSON）
  const jsonMatch = allJsonMatches.length > 0 ? allJsonMatches[allJsonMatches.length - 1] : null
  if (jsonMatch) {
    try {
      const parsed = safeParseJSON(jsonMatch[1].trim()) as Record<string, unknown>

      // 根据 stage 合并数据
      switch (stage) {
        case 'concept':
          if (parsed.title) newData.title = parsed.title as string
          if (parsed.genre) newData.genre = parsed.genre as string
          if (parsed.description) newData.description = parsed.description as string
          if (parsed.coreAppeal) newData.coreAppeal = parsed.coreAppeal as string[]
          if (parsed.targetWordCount) newData.targetWordCount = parsed.targetWordCount as string
          if (parsed.targetChapters) newData.targetChapters = parsed.targetChapters as string
          if (parsed.writingRules) newData.writingRules = parsed.writingRules as Array<{ category: string; title: string; content: string; priority?: number }>
          break

        case 'worldbuild':
          if (parsed.worldSettings) newData.worldSettings = parsed.worldSettings as Array<{ type: string; title: string; content: string; importance?: string }>
          break

        case 'character_design':
          if (parsed.characters) newData.characters = parsed.characters as Array<{ name: string; role: string; description: string; aliases?: string[]; powerLevel?: string; attributes?: Record<string, unknown>; relationships?: string[] }>
          break

        case 'volume_outline':
          if (parsed.volumes) {
            const validatedVolumes = (parsed.volumes as Array<any>).map((vol: any) => {
              const PER_CHAPTER_MIN = 3000
              const PER_CHAPTER_MAX = 5000

              if (vol.targetWordCount && vol.targetChapterCount) {
                const expectedChapters = Math.round(vol.targetWordCount / ((PER_CHAPTER_MIN + PER_CHAPTER_MAX) / 2))
                if (Math.abs(vol.targetChapterCount - expectedChapters) > expectedChapters * 0.3) {
                  vol.targetChapterCount = expectedChapters
                }
              } else if (vol.targetWordCount && !vol.targetChapterCount) {
                vol.targetChapterCount = Math.round(vol.targetWordCount / ((PER_CHAPTER_MIN + PER_CHAPTER_MAX) / 2))
              } else if (vol.targetChapterCount && !vol.targetWordCount) {
                vol.targetWordCount = vol.targetChapterCount * ((PER_CHAPTER_MIN + PER_CHAPTER_MAX) / 2)
              }

              if (vol.eventLine && Array.isArray(vol.eventLine) && vol.targetChapterCount) {
                if (vol.eventLine.length !== vol.targetChapterCount) {
                  console.warn(`[workshop] 卷"${vol.title}" eventLine 条数(${vol.eventLine.length})与 targetChapterCount(${vol.targetChapterCount})不符，已校正`)
                  vol.eventLine = vol.eventLine.slice(0, vol.targetChapterCount)
                }
              }

              return vol
            })
            newData.volumes = validatedVolumes as typeof newData.volumes
          }
          break

        case 'chapter_outline':
          if (parsed.chapters) newData.chapters = parsed.chapters as Array<{ title: string; outline: string; summary?: string; characters?: string[]; foreshadowingActions?: Array<{ action: string; target: string; description: string }>; keyScenes?: string[] }>
          break
      }
    } catch (e) {
    }
  } else {
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

async function buildOutlineContentWithAI(
  env: Env,
  data: WorkshopExtractedData
): Promise<string> {
  const { streamGenerate } = await import('./llm')

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
