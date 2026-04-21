/**
 * @file settings.ts
 * @description 模型配置路由模块，提供模型配置的CRUD操作，支持全局配置和小说级配置
 * @version 2.0.0
 * @modified 2026-04-21 - 添加激活/停用接口
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { drizzle } from 'drizzle-orm/d1'
import { modelConfigs as t } from '../db/schema'
import { eq, and } from 'drizzle-orm'
import type { Env } from '../lib/types'

const router = new Hono<{ Bindings: Env }>()

const CreateSchema = z.object({
  novelId: z.string().optional(),
  scope: z.string(),
  stage: z.string(),
  provider: z.string(),
  modelId: z.string(),
  apiBase: z.string().optional(),
  apiKeyEnv: z.string(),
  apiKey: z.string().optional(),
  params: z.string().optional(),
})

const ToggleSchema = z.object({
  isActive: z.boolean(),
})

/**
 * GET / - 获取模型配置列表
 * @description 获取模型配置，支持按小说ID和阶段过滤，优先返回小说级配置
 * @param {string} [novelId] - 小说ID（查询参数）
 * @param {string} [stage] - 生成阶段（查询参数）
 * @returns {Array} 模型配置数组
 */
router.get('/', async (c) => {
  const novelId = c.req.query('novelId')
  const stage = c.req.query('stage')
  const db = drizzle(c.env.DB)

  // 构建查询条件
  const query = db.select().from(t)

  if (stage) {
    // 如果指定了 stage，按优先级返回：novel级 > global级
    const conditions = [eq(t.stage, stage), eq(t.isActive, 1)]
    if (novelId) {
      // 优先查 novel 级配置
      const novelConfig = await db
        .select()
        .from(t)
        .where(and(...conditions, eq(t.novelId, novelId)))
        .limit(1)
        .get()
      if (novelConfig) return c.json([novelConfig])
    }
    // 回退到 global 配置
    const globalConfig = await db
      .select()
      .from(t)
      .where(and(...conditions, eq(t.scope, 'global')))
      .all()
    return c.json(globalConfig)
  }

  // 无 stage 参数，返回所有匹配配置
  if (novelId) {
    return c.json(await query.where(eq(t.novelId, novelId)))
  }
  return c.json(await query.where(eq(t.scope, 'global')))
})

/**
 * POST / - 创建模型配置
 * @param {string} [novelId] - 小说ID（可选，不填则为全局配置）
 * @param {string} scope - 配置范围：global | novel
 * @param {string} stage - 生成阶段
 * @param {string} provider - 模型提供商
 * @param {string} modelId - 模型ID
 * @param {string} [apiBase] - API基础URL
 * @param {string} apiKeyEnv - API密钥环境变量名
 * @param {string} [apiKey] - API密钥（可选）
 * @param {string} [params] - 模型参数JSON
 * @returns {Object} 创建的配置对象
 */
router.post('/', zValidator('json', CreateSchema), async (c) => {
  const db = drizzle(c.env.DB)
  const [row] = await db.insert(t).values(c.req.valid('json')).returning()
  return c.json(row, 201)
})

/**
 * PATCH /:id - 更新模型配置
 * @param {string} id - 配置ID
 * @param {Object} body - 更新内容
 * @returns {Object} 更新后的配置对象
 */
router.patch('/:id', zValidator('json', CreateSchema.partial()), async (c) => {
  const db = drizzle(c.env.DB)
  const [row] = await db.update(t)
    .set(c.req.valid('json'))
    .where(eq(t.id, c.req.param('id')))
    .returning()
  return c.json(row)
})

/**
 * PATCH /:id/toggle - 激活/停用模型配置
 * @param {string} id - 配置ID
 * @param {boolean} isActive - 是否激活
 * @returns {Object} 更新后的配置对象
 */
router.patch('/:id/toggle', zValidator('json', ToggleSchema), async (c) => {
  const db = drizzle(c.env.DB)
  const { isActive } = c.req.valid('json')
  const configId = c.req.param('id')

  // 获取当前配置信息
  const config = await db.select().from(t).where(eq(t.id, configId)).get()
  if (!config) {
    return c.json({ error: '配置不存在' }, 404)
  }

  // 如果要激活，先停用同一 stage 的其他配置
  if (isActive) {
    const deactivateConditions = [eq(t.stage, config.stage)]
    if (config.novelId) {
      deactivateConditions.push(eq(t.novelId, config.novelId))
    } else {
      deactivateConditions.push(eq(t.scope, 'global'))
    }

    await db.update(t)
      .set({ isActive: 0 })
      .where(and(...deactivateConditions, eq(t.isActive, 1)))
  }

  // 更新目标配置
  const [row] = await db.update(t)
    .set({ isActive: isActive ? 1 : 0 })
    .where(eq(t.id, configId))
    .returning()
  return c.json(row)
})

/**
 * DELETE /:id - 删除模型配置
 * @param {string} id - 配置ID
 * @returns {Object} { ok: boolean }
 */
router.delete('/:id', async (c) => {
  const db = drizzle(c.env.DB)
  await db.delete(t).where(eq(t.id, c.req.param('id')))
  return c.json({ ok: true })
})

export { router as settings }
