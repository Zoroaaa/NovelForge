/**
 * @file entityExtract.ts
 * @description 跨章一致性：step7 实体自动提取服务
 *   从章节内容中提取新出现的角色/道具/法宝/功法，写入 novelInlineEntities + entityStateLog。
 *   同时产出 step8 所需的 characterGrowths / knowledgeReveals 供后续消费。
 */
import { drizzle } from 'drizzle-orm/d1'
import { eq, and, sql } from 'drizzle-orm'
import {
  chapters,
  characters,
  novelSettings,
  novelInlineEntities,
  entityStateLog,
  chapterStructuredData,
} from '../../db/schema'
import type { Env } from '../../lib/types'
import { resolveConfig, generateWithMetrics } from '../llm'
import type { LLMCallResult } from '../llm'
import { JSON_OUTPUT_PROMPT, LOG_STYLES } from './constants'
import { indexContent } from '../embedding'

export interface EntityExtractResult {
  entities: Array<{
    entityType: string
    name: string
    description: string
    aliases?: string
    stateType?: string
    initState?: string
    isGrowable?: boolean
  }>
  stateChanges: Array<{
    entityName: string
    entityType: string
    stateType: string
    prevState?: string
    currState: string
    stateSummary: string
    stateDetail?: string
  }>
  characterGrowths: Array<{
    characterName: string
    dimension: string
    characterNameTarget?: string
    prevState?: string
    currState: string
    detail?: string
  }>
  knowledgeReveals: Array<{
    characterName: string
    targetEntityName: string
    revealDetail: string
    isSecret?: boolean
  }>
  metrics?: LLMCallResult
}

const EXTRACT_SYSTEM_PROMPT = `${JSON_OUTPUT_PROMPT}

你是一个专业的网络小说文本分析助手。你的任务是从章节内容中提取【首次出场的新实体】和【已有实体的状态变化】。

规则：
1. 只提取正文中明确出现过的实体，不得推测或编造
2. 已知角色（见已知角色列表）的信息不要重复提取为新实体
3. 已知设定（见已知设定列表）不要重复提取
4. 一个实体在本章可能同时满足多条提取规则，应全部覆盖（如一个新法宝既有首次出场又有状态变化）
5. "未实体化的概念提及"（如仅旁白提及）不应被提取
6. 如果本章无任何新增实体或状态变化，返回空数组
7. stateChanges 必须覆盖所有终止性状态变化，包括但不限于：
   - 角色死亡（stateType="死亡", currState="已死亡"）
   - 道具/材料被取走或消耗（stateType="取走"或"消耗", currState="已被[角色名]取走/使用"）
   - 法宝失效/损毁（stateType="失效"或"损毁", currState="已失效/已损毁"）
   - 势力覆灭（stateType="覆灭", currState="已覆灭"）
   这类变化是后续章节一致性检测的核心依据，必须提取，不得遗漏
8. 实体名称必须是专有名词（真名/地名/法术名/组织名/法宝名），
   外貌描述词（如"尖嘴猴腮的喽啰"、"络腮胡大汉"、"瘦高个修士"）
   不得直接作为实体名称提取。
   此类群体性角色如需记录，请使用带章节标注的格式：
   "血煞门喽啰·第N章" 或直接跳过不提取
9. 职位描述词不得作为独立角色实体提取：
   "门主"、"堂主"、"长老"、"掌门"、"护法"、"小队长"等是职位而非人名，
   此类信息应归入所属势力实体的描述中，不单独创建角色记录
10. 以下通用物品/概念不得提取为独立实体（除非有特殊标识或唯一性）：
    - 通用兵器类型：刀、剑、飞刀、柴刀、砍刀等（无特殊名称/锻造者标识的）
    - 通用消耗品：干粮、野果、普通丹药（金疮药、回气丹等）、水囊等
    - 通用容器：布袋、木盒、蜡盒等（无法宝属性的）
    - 泛称角色：散修、喽啰、修士、路人等（无具体名字的）
    判断标准：如果该物品/角色在后续章节中不可能被精确指代（"第X章的那个XX"），则不应提取
11. 状态修饰词剥离：实体名称中的状态形容词应剥离，不纳入名称。
    例如："卷刃柴刀"→ 提取为"柴刀"，"卷刃"记入stateLog的状态变化；
    "低阶飞刀"→ 提取为"飞刀"或直接跳过（见规则10）
    "破损的玉佩"→ 提取为"玉佩"，"破损"记入stateLog
12. 名称标准化：去除书名号《》、引号""等标点后做去重匹配。
    《聚气诀》= 聚气诀 = "聚气诀"，视为同一实体

=== characterGrowths（角色成长）提取规则 ===
13. knowledge（知识维度）只记录【认知升级】，不记录【临时信息获取】：
    - ✅ 应提取：世界观重塑、核心能力理解深化、威胁等级重新评估、自身短板觉醒、
      重大秘密揭露导致的认知颠覆
    - ❌ 不提取：一次性战术情报（敌人数量/配置/位置）、库存清单式信息、
      计算结论（"够突破XX"）、推测性信息（"可能藏有XX"）、 caution类提醒（"XX可能有危险"）
    - 判断标准：这条知识是否改变了角色对世界的**根本性理解**？
      如果只是"知道了某个事实"，不应提取；如果是"重新认识了某件事"，才应提取
14. possession（物品维度）禁止提取：
    物品获取/丢失已在 stateChanges 中完整记录（"取走"/"消耗"类型），
    characterGrowths 不再重复记录物品数量变化，避免数据冗余
15. 同一知识点的后续深化不另建新记录：
    如果前文已记录过"得知血屠是金丹巅峰"，后续章节获得更多关于血屠的信息时，
    应更新原记录的 currState 和 detail 字段，而非创建新记录。
    LLM输出时仍按新记录格式返回，系统层会自动合并去重
16. combat（战斗维度）只记录【质变】，不记录【量变】：
    - ✅ 应提取：首次击杀、战斗风格形成、新战术掌握、从0到1的突破
    - ❌ 不提取：击杀数增加（"又杀了1个"）、熟练度微提升（"更熟练了"）
17. 各维度单章上限：knowledge ≤ 3条，其他维度各 ≤ 2条，总条数 ≤ 8条/章
    强制筛选最有价值的成长记录，避免信息噪音
18. social（社交关系维度）是关系网络的数据来源，必须正确提取：
    - 触发条件：本章中角色与其他角色的**关系发生了变化**（新建/深化/恶化/破裂）
    - 必须填写 characterNameTarget 字段（目标角色名），否则无法写入关系网络
    - 与 emotion 的区别：emotion 是内心感受（"仇恨"、"同情"），social 是外部关系状态（"仇敌"、"恩人"、"盟友"）
    - 正确示例：
      dimension="social", characterName="林默", characterNameTarget="血屠",
      prevState="无直接交集", currState="血海深仇", detail="灭门之仇，誓要报仇"
      dimension="social", characterName="林默", characterNameTarget="刀疤脸散修",
      prevState="陌生人", currState="仇敌", detail="目睹其残杀少年散修，立誓复仇"
    - 错误示例（不应归入social）：
      × 得知某角色的信息 → 归入 knowledge
      × 对某角色产生情绪反应 → 归入 emotion
      × 纯粹的敌对描述无关系变化 → 不提取
19. 社交关系的 prevState 应基于前文已有关系推断，而非默认"无关系"：
    如果前文已建立过该关系，prevState应填写前次记录的currState；
    如果是首次建立关系，prevState才填"无交集"/"陌生人"/"未知"

输出JSON格式：
{
  "entities": [
    {
      "entityType": "character|artifact|technique|location|item|faction",
      "name": "实体名称",
      "description": "一句话描述（来自原文）",
      "aliases": "别名（可选）",
      "stateType": "如果实体有初始状态则填写（如实力等级、品阶等，使用本小说设定的名称）",
      "initState": "初始状态描述",
      "isGrowable": true/false
    }
  ],
  "stateChanges": [
    {
      "entityName": "实体名",
      "entityType": "character|artifact|technique|...",
      "stateType": "升级|突破|强化|损毁|失效|消耗|取走|死亡|消失|覆灭|扩张|削弱|觉醒|封印|解封|转变",
      "prevState": "变化前状态（如未知可为空）",
      "currState": "变化后状态（必须是一句完整的当前状态描述，而非动作本身；例如：角色死亡→'已死亡'，道具被取走→'已被主角取走存入储物袋'）",
      "stateSummary": "变化摘要（30字内，描述发生了什么）",
      "stateDetail": "变化细节（可选）"
    }
  ],
  "characterGrowths": [
    {
      "characterName": "角色名",
      "dimension": "ability|social|knowledge|emotion|combat|growth",
      "characterNameTarget": "如果维度涉及目标角色则填写（如社交关系）",
      "prevState": "变化前状态",
      "currState": "变化后状态",
      "detail": "细节说明（可选）"
    }
  ],
  "knowledgeReveals": [
    {
      "characterName": "角色名",
      "targetEntityName": "得知的实体/信息名",
      "revealDetail": "得知的具体内容",
      "isSecret": true/false
    }
  ]
}`

function buildUserPrompt(
  chapterTitle: string,
  chapterContent: string,
  knownCharacterNames: string[],
  existingSettingNames: string[],
  recentStructuredData: string,
): string {
  return `【章节标题】${chapterTitle}

【本章正文】（分析前12000字）：
${chapterContent.slice(0, 12000)}

【已知角色列表】（不要提取为新实体，包括主角、反派、配角等所有已登记角色）：
${knownCharacterNames.length > 0 ? knownCharacterNames.join('、') : '暂无'}

【已知设定列表】（不要提取为新实体）：
${existingSettingNames.length > 0 ? existingSettingNames.join('、') : '暂无'}

${recentStructuredData ? `【前文角色信息参考】\n${recentStructuredData}` : ''}

请严格按照JSON格式输出，不要输出任何非JSON内容。`
}

export async function extractEntitiesFromChapter(
  env: Env,
  chapterId: string,
  novelId: string,
): Promise<EntityExtractResult> {
  const db = drizzle(env.DB)

  const chapter = await db
    .select({
      title: chapters.title,
      content: chapters.content,
      sortOrder: chapters.sortOrder,
    })
    .from(chapters)
    .where(eq(chapters.id, chapterId))
    .limit(1)

  if (chapter.length === 0 || !chapter[0].content) {
    LOG_STYLES.ERROR(`[step7] 找不到章节或内容为空: ${chapterId}`)
    return { entities: [], stateChanges: [], characterGrowths: [], knowledgeReveals: [] }
  }

  const { title, content, sortOrder } = chapter[0]

  const allCharacters = await db
    .select({ name: characters.name, aliases: characters.aliases })
    .from(characters)
    .where(and(
      eq(characters.novelId, novelId),
      sql`${characters.deletedAt} IS NULL`,
    ))

  const knownCharacterNames = allCharacters.flatMap(c => {
    const names = [c.name]
    if (c.aliases) {
      try {
        const parsed = JSON.parse(c.aliases)
        if (Array.isArray(parsed)) names.push(...parsed)
      } catch { /* 忽略 */ }
    }
    return names
  })

  const existingSettings = await db
    .select({ name: novelSettings.name })
    .from(novelSettings)
    .where(and(eq(novelSettings.novelId, novelId), eq(novelSettings.type, 'power_system')))

  const existingSettingNames = existingSettings.map(s => s.name)

  const recentStructured = await db
    .select({
      characterChanges: chapterStructuredData.characterChanges,
      newEntities: chapterStructuredData.newEntities,
      chapterOrder: chapterStructuredData.chapterOrder,
    })
    .from(chapterStructuredData)
    .where(and(
      eq(chapterStructuredData.novelId, novelId),
      eq(chapterStructuredData.chapterOrder, sortOrder - 1),
    ))
    .limit(1)

  let recentStructuredData = ''
  if (recentStructured.length > 0) {
    const sd = recentStructured[0]
    if (sd.characterChanges) recentStructuredData += `【上一章角色变化】\n${sd.characterChanges}\n`
    if (sd.newEntities) recentStructuredData += `【上一章新出现元素】\n${sd.newEntities}\n`
  }

  let extractConfig
  try {
    extractConfig = await resolveConfig(db, 'analysis', novelId)
    extractConfig.apiKey = extractConfig.apiKey || ''
  } catch {
    throw new Error('❌ 未配置"智能分析"模型！请在全局配置中设置 analysis 阶段的模型')
  }

  const userPrompt = buildUserPrompt(title, content, knownCharacterNames, existingSettingNames, recentStructuredData)

  const metrics = await generateWithMetrics(
    { ...extractConfig, params: { ...(extractConfig.params || {}), temperature: 0.1 } },
    [
      { role: 'system', content: EXTRACT_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
  )

  const jsonMatch = metrics.text.match(/\{[\s\S]*?\}(?=\s*$)/)
  if (!jsonMatch) {
    LOG_STYLES.ERROR('[step7] LLM返回内容无有效JSON')
    return { entities: [], stateChanges: [], characterGrowths: [], knowledgeReveals: [], metrics }
  }

  try {
    const parsed = JSON.parse(jsonMatch[0])
    return {
      entities: parsed.entities || [],
      stateChanges: parsed.stateChanges || [],
      characterGrowths: parsed.characterGrowths || [],
      knowledgeReveals: parsed.knowledgeReveals || [],
      metrics,
    }
  } catch {
    LOG_STYLES.ERROR('[step7] JSON解析失败')
    return { entities: [], stateChanges: [], characterGrowths: [], knowledgeReveals: [], metrics }
  }
}

export async function persistExtractedEntities(
  env: Env,
  chapterId: string,
  novelId: string,
  result: EntityExtractResult,
): Promise<{ entityCount: number; stateChangeCount: number }> {
  const db = drizzle(env.DB)
  const chapter = await db
    .select({ sortOrder: chapters.sortOrder })
    .from(chapters)
    .where(eq(chapters.id, chapterId))
    .limit(1)

  if (chapter.length === 0) return { entityCount: 0, stateChangeCount: 0 }

  const chapterOrder = chapter[0].sortOrder
  let entityCount = 0
  let stateChangeCount = 0

  for (const entity of result.entities) {
    const existingEntity = await db
      .select({ id: novelInlineEntities.id, description: novelInlineEntities.description })
      .from(novelInlineEntities)
      .where(and(
        eq(novelInlineEntities.novelId, novelId),
        eq(novelInlineEntities.name, entity.name),
      ))
      .limit(1)

    let entityId: string

    if (existingEntity.length > 0) {
      const mergedDescription = existingEntity[0].description !== entity.description
        ? `${existingEntity[0].description} | ${entity.entityType}形态：${entity.description}`
        : entity.description

      await db.update(novelInlineEntities)
        .set({
          description: mergedDescription,
          aliases: entity.aliases ?? null,
          lastChapterId: chapterId,
          lastChapterOrder: chapterOrder,
          updatedAt: Math.floor(Date.now() / 1000),
        })
        .where(eq(novelInlineEntities.id, existingEntity[0].id))

      entityId = existingEntity[0].id
    } else {
      const inserted = await db.insert(novelInlineEntities).values({
        novelId,
        entityType: entity.entityType,
        name: entity.name,
        aliases: entity.aliases ?? null,
        description: entity.description,
        firstChapterId: chapterId,
        firstChapterOrder: chapterOrder,
        lastChapterId: chapterId,
        lastChapterOrder: chapterOrder,
        isGrowable: entity.isGrowable ? 1 : 0,
      }).returning({ id: novelInlineEntities.id })

      entityId = inserted[0].id
      entityCount++
    }

    if (entity.stateType && entity.initState) {
      await db.insert(entityStateLog).values({
        novelId,
        sourceType: entity.entityType === 'character' ? 'character' : 'inline_entity',
        sourceId: entityId,
        entityName: entity.name,
        entityType: entity.entityType,
        chapterId,
        chapterOrder,
        stateType: entity.stateType,
        stateSummary: `初始状态：${entity.initState}`,
        currState: entity.initState,
      })
      stateChangeCount++
    }
  }

  for (const change of result.stateChanges) {
    const sourceEntity = await db
      .select({ id: novelInlineEntities.id })
      .from(novelInlineEntities)
      .where(and(
        eq(novelInlineEntities.novelId, novelId),
        eq(novelInlineEntities.name, change.entityName),
      ))
      .limit(1)

    const sourceId = sourceEntity.length > 0 ? sourceEntity[0].id : ''
    const sourceType = change.entityType === 'character' ? 'character' : 'inline_entity'

    await db.insert(entityStateLog).values({
      novelId,
      sourceType,
      sourceId,
      entityName: change.entityName,
      entityType: change.entityType,
      chapterId,
      chapterOrder,
      stateType: change.stateType,
      stateSummary: change.stateSummary,
      stateDetail: change.stateDetail ?? null,
      prevState: change.prevState ?? null,
      currState: change.currState,
    })
    stateChangeCount++
  }

  return { entityCount, stateChangeCount }
}

export async function triggerEntityVectorize(
  env: Env,
  novelId: string,
  result: EntityExtractResult,
): Promise<void> {
  if (!env.VECTORIZE) return

  const db = drizzle(env.DB)

  for (const entity of result.entities) {
    const existingEntity = await db
      .select({ id: novelInlineEntities.id })
      .from(novelInlineEntities)
      .where(and(
        eq(novelInlineEntities.novelId, novelId),
        eq(novelInlineEntities.name, entity.name),
      ))
      .limit(1)

    if (existingEntity.length > 0) {
      try {
        const vectorIds = await indexContent(
          env,
          'inline_entity',
          existingEntity[0].id,
          novelId,
          entity.name,
          `${entity.name}：${entity.description}`,
          { sourceType: 'inline_entity' },
        )

        await db.update(novelInlineEntities)
          .set({ vectorId: vectorIds[0] ?? null, indexedAt: Math.floor(Date.now() / 1000) })
          .where(eq(novelInlineEntities.id, existingEntity[0].id))
      } catch (error) {
        LOG_STYLES.ERROR(`[step7] 实体向量化失败: ${entity.name} - ${error}`)
      }
    }
  }
}
