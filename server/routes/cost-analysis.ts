/**
 * @file cost-analysis.ts
 * @description 成本分析路由模块 - 提供Token消耗统计、成本追踪、趋势分析等功能
 * @version 1.0.0
 * @created 2026-04-30 - 新增AI监控中心成本分析功能
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { Env } from '../lib/types'
import { generationLogs, chapters } from '../db/schema'
import { eq, and, desc, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'

const router = new Hono<{ Bindings: Env }>()

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4': { input: 0.03, output: 0.06 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  'gpt-4o': { input: 0.005, output: 0.015 },
  'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
  'claude-3-opus': { input: 0.015, output: 0.075 },
  'claude-3-sonnet': { input: 0.003, output: 0.015 },
  'claude-3-haiku': { input: 0.00025, output: 0.00125 },
}

function calculateCost(modelId: string, promptTokens: number, completionTokens: number): number {
  const pricing = MODEL_PRICING[modelId] || { input: 0.01, output: 0.02 }
  return (promptTokens / 1000) * pricing.input + (completionTokens / 1000) * pricing.output
}

function getTimeRange(period: string): number {
  const now = Math.floor(Date.now() / 1000)
  switch (period) {
    case 'day':
      return now - 86400
    case 'week':
      return now - 604800
    case 'month':
      return now - 2592000
    default:
      return now - 604800
  }
}

/**
 * GET /summary - 获取成本汇总数据
 * @description 返回指定小说在指定时间范围内的Token消耗和成本统计
 * @query {string} novelId - 小说ID（必填）
 * @query {string} [period='week'] - 时间范围：day | week | month
 * @returns {Object} 包含totalTokens、totalCost、modelBreakdown、dailyTrend、stageBreakdown
 */
router.get('/summary', zValidator('query', z.object({
  novelId: z.string().min(1),
  period: z.enum(['day', 'week', 'month']).optional().default('week'),
})), async (c) => {
  const { novelId, period } = c.req.valid('query')
  const db = drizzle(c.env.DB)
  const startTime = getTimeRange(period)

  try {
    const logs = await db
      .select({
        id: generationLogs.id,
        chapterId: generationLogs.chapterId,
        stage: generationLogs.stage,
        modelId: generationLogs.modelId,
        promptTokens: generationLogs.promptTokens,
        completionTokens: generationLogs.completionTokens,
        status: generationLogs.status,
        createdAt: generationLogs.createdAt,
      })
      .from(generationLogs)
      .where(
        and(
          eq(generationLogs.novelId, novelId),
          sql`${generationLogs.createdAt} >= ${startTime}`
        )
      )
      .orderBy(desc(generationLogs.createdAt))
      .all()

    const successLogs = logs.filter(log => log.status === 'success' && log.promptTokens && log.completionTokens)

    if (successLogs.length === 0) {
      return c.json({
        totalTokens: 0,
        totalCost: 0,
        avgCostPerChapter: 0,
        modelBreakdown: [],
        dailyTrend: [],
        stageBreakdown: [],
      })
    }

    let totalTokens = 0
    let totalCost = 0
    const modelMap = new Map<string, { tokens: number; cost: number }>()
    const dailyMap = new Map<string, { inputTokens: number; outputTokens: number; cost: number }>()
    const stageMap = new Map<string, { tokens: number; count: number }>()
    const chapterSet = new Set<string>()

    successLogs.forEach(log => {
      const tokens = (log.promptTokens || 0) + (log.completionTokens || 0)
      const cost = calculateCost(log.modelId, log.promptTokens || 0, log.completionTokens || 0)

      totalTokens += tokens
      totalCost += cost

      if (log.chapterId) chapterSet.add(log.chapterId)

      const modelData = modelMap.get(log.modelId) || { tokens: 0, cost: 0 }
      modelData.tokens += tokens
      modelData.cost += cost
      modelMap.set(log.modelId, modelData)

      const dateKey = new Date((log.createdAt || 0) * 1000).toISOString().split('T')[0]
      const dailyData = dailyMap.get(dateKey) || { inputTokens: 0, outputTokens: 0, cost: 0 }
      dailyData.inputTokens += log.promptTokens || 0
      dailyData.outputTokens += log.completionTokens || 0
      dailyData.cost += cost
      dailyMap.set(dateKey, dailyData)

      const stageData = stageMap.get(log.stage) || { tokens: 0, count: 0 }
      stageData.tokens += tokens
      stageData.count += 1
      stageMap.set(log.stage, stageData)
    })

    const modelBreakdown = Array.from(modelMap.entries())
      .map(([modelId, data]) => ({
        modelId,
        tokens: data.tokens,
        cost: parseFloat(data.cost.toFixed(6)),
        percentage: parseFloat(((data.tokens / totalTokens) * 100).toFixed(2)),
      }))
      .sort((a, b) => b.tokens - a.tokens)

    const dailyTrend = Array.from(dailyMap.entries())
      .map(([date, data]) => ({
        date,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        cost: parseFloat(data.cost.toFixed(6)),
      }))
      .sort((a, b) => a.date.localeCompare(b.date))

    const stageBreakdown = Array.from(stageMap.entries())
      .map(([stage, data]) => ({
        stage,
        tokens: data.tokens,
        count: data.count,
      }))
      .sort((a, b) => b.tokens - a.tokens)

    return c.json({
      totalTokens,
      totalCost: parseFloat(totalCost.toFixed(6)),
      avgCostPerChapter: parseFloat((totalCost / chapterSet.size).toFixed(6)),
      modelBreakdown,
      dailyTrend,
      stageBreakdown,
    })
  } catch (error) {
    console.error('[CostAnalysis] Summary failed:', error)
    return c.json(
      { error: 'Internal Server Error', code: 'COST_SUMMARY_FAILED', message: '获取成本汇总失败' },
      500
    )
  }
})

/**
 * GET /details - 获取成本明细记录（分页）
 * @description 返回指定小说的生成日志明细，包含分页支持
 * @query {string} novelId - 小说ID（必填）
 * @query {number} [page=1] - 页码
 * @query {number} [limit=20] - 每页条数
 * @returns {Object} { records: Array, total: number, page: number }
 */
router.get('/details', zValidator('query', z.object({
  novelId: z.string().min(1),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
})), async (c) => {
  const { novelId, page, limit } = c.req.valid('query')
  const db = drizzle(c.env.DB)

  try {
    const offset = (page - 1) * limit

    const [recordsResult, countResult] = await Promise.all([
      db
        .select({
          id: generationLogs.id,
          chapterId: generationLogs.chapterId,
          stage: generationLogs.stage,
          modelId: generationLogs.modelId,
          promptTokens: generationLogs.promptTokens,
          completionTokens: generationLogs.completionTokens,
          status: generationLogs.status,
          createdAt: generationLogs.createdAt,
        })
        .from(generationLogs)
        .where(eq(generationLogs.novelId, novelId))
        .orderBy(desc(generationLogs.createdAt))
        .limit(limit)
        .offset(offset)
        .all(),

      db
        .select({ count: sql<number>`count(*)` })
        .from(generationLogs)
        .where(eq(generationLogs.novelId, novelId))
        .get(),
    ])

    const chapterIds = [...new Set(recordsResult.map(r => r.chapterId).filter(Boolean))] as string[]

    let chapterNumberMap: Record<string, number> = {}
    if (chapterIds.length > 0) {
      const chapterRows = await db
        .select({ id: chapters.id, sortOrder: chapters.sortOrder })
        .from(chapters)
        .where(sql`${chapters.id} IN (${chapterIds.join(',')})`)
        .all()

      chapterNumberMap = Object.fromEntries(chapterRows.map(ch => [ch.id, ch.sortOrder]))
    }

    const records = recordsResult.map(log => ({
      id: log.id,
      chapterId: log.chapterId || '',
      chapterNumber: chapterNumberMap[log.chapterId || ''] || 0,
      stage: log.stage,
      modelId: log.modelId,
      promptTokens: log.promptTokens || 0,
      completionTokens: log.completionTokens || 0,
      cost: parseFloat(
        calculateCost(log.modelId, log.promptTokens || 0, log.completionTokens || 0).toFixed(6)
      ),
      createdAt: log.createdAt || 0,
    }))

    const total = countResult?.count ? Number(countResult.count) : 0

    return c.json({
      records,
      total,
      page,
    })
  } catch (error) {
    console.error('[CostAnalysis] Details failed:', error)
    return c.json(
      { error: 'Internal Server Error', code: 'COST_DETAILS_FAILED', message: '获取成本明细失败' },
      500
    )
  }
})

export const costAnalysis = router
