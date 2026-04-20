/**
 * NovelForge · Agent 上下文组装器
 *
 * 章节生成时，决定注入哪些内容作为 LLM 上下文。
 * 策略：强制注入（小体积高相关）+ RAG 检索（语义相关大纲片段）
 */

export interface ContextBundle {
  /** 强制注入部分（每次必带）*/
  mandatory: {
    chapterOutline: string         // 本章大纲全文
    prevChapterSummary: string     // 上一章摘要
    volumeSummary: string          // 当前卷摘要
    protagonistCards: string[]     // 本章出场主角角色卡
  }
  /** RAG 检索部分（语义最相关的大纲片段，按分数截断）*/
  ragChunks: Array<{
    sourceType: 'outline' | 'character' | 'chapter_summary'
    title: string
    content: string
    score: number
  }>
  /** 诊断信息（前端 ContextPreview 组件展示用）*/
  debug: {
    totalTokenEstimate: number
    ragHitsCount: number
    skippedByBudget: number
  }
}

/**
 * Token 预算分配（可在 model_configs.params 中覆盖）
 */
const DEFAULT_BUDGET = {
  total: 12000,          // 总上下文 token 上限
  mandatory: 6000,       // 强制注入预留
  rag: 4000,             // RAG 片段可用额度
  systemPrompt: 2000,    // 系统 prompt 保留
}

export async function buildChapterContext(
  env: Env,
  novelId: string,
  chapterId: string,
  budget = DEFAULT_BUDGET
): Promise<ContextBundle> {

  // 1. 并发拉取强制注入内容（走 D1，精准 ID 查询）
  const [chapterOutline, prevSummary, volumeSummary, protagonists] =
    await Promise.all([
      fetchChapterOutline(env.DB, chapterId),
      fetchPrevChapterSummary(env.DB, chapterId),
      fetchVolumeSummary(env.DB, chapterId),
      fetchProtagonistCards(env.DB, chapterId),
    ])

  // 2. 用本章大纲作为 query，RAG 检索语义相关片段
  const queryText = chapterOutline   // 本章大纲是最好的检索 query
  const queryVector = await embed(env.AI, queryText)

  const ragResults = await env.VECTORIZE.query(queryVector, {
    topK: 20,
    filter: { novelId },
    returnMetadata: true,
  })

  // 3. 按 token 预算截断 RAG 结果
  let usedTokens = 0
  const ragChunks = []
  let skipped = 0

  for (const match of ragResults.matches) {
    const content = match.metadata?.content as string
    const estimated = estimateTokens(content)
    if (usedTokens + estimated > budget.rag) { skipped++; continue }
    usedTokens += estimated
    ragChunks.push({
      sourceType: match.metadata?.sourceType as any,
      title: match.metadata?.title as string,
      content,
      score: match.score,
    })
  }

  return {
    mandatory: {
      chapterOutline,
      prevChapterSummary: prevSummary,
      volumeSummary,
      protagonistCards: protagonists,
    },
    ragChunks,
    debug: {
      totalTokenEstimate: estimateMandatoryTokens({ chapterOutline, prevSummary, volumeSummary, protagonists }) + usedTokens,
      ragHitsCount: ragChunks.length,
      skippedByBudget: skipped,
    }
  }
}

/** 中文 token 粗估：1 汉字 ≈ 1.3 token，英文 1 词 ≈ 1.3 token */
function estimateTokens(text: string): number {
  if (!text) return 0
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length
  const other = text.length - cjk
  return Math.ceil(cjk * 1.3 + other * 0.3)
}

function estimateMandatoryTokens(m: any): number {
  return estimateTokens(m.chapterOutline)
    + estimateTokens(m.prevSummary)
    + estimateTokens(m.volumeSummary)
    + m.protagonists.reduce((s: number, c: string) => s + estimateTokens(c), 0)
}

async function embed(ai: Ai, text: string): Promise<number[]> {
  const result = await ai.run('@cf/baai/bge-base-zh-v1.5', { text: [text] })
  return (result as any).data[0]
}

// --- D1 查询函数（省略具体 SQL，由 drizzle 生成）---
async function fetchChapterOutline(db: D1Database, chapterId: string): Promise<string> {
  // SELECT outlines.content FROM chapters JOIN outlines ON chapters.outline_id = outlines.id
  // WHERE chapters.id = chapterId
  return ''
}
async function fetchPrevChapterSummary(db: D1Database, chapterId: string): Promise<string> {
  // SELECT summary FROM chapters WHERE sort_order = (current - 1) AND novel_id = ...
  return ''
}
async function fetchVolumeSummary(db: D1Database, chapterId: string): Promise<string> {
  // SELECT summary FROM volumes WHERE id = (SELECT volume_id FROM chapters WHERE id = ...)
  return ''
}
async function fetchProtagonistCards(db: D1Database, chapterId: string): Promise<string[]> {
  // 从 chapter_outline.content 中解析出场角色名，查 characters 表
  return []
}
