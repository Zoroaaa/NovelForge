/**
 * @file entity-index.ts
 * @description 实体索引路由模块，提供实体树查询和索引重建功能
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { Env } from '../lib/types'
import {
  getEntityTree,
  getEntityChildren,
  rebuildEntityIndex,
} from '../services/entity-index'

const router = new Hono<{ Bindings: Env }>()

/**
 * GET /:novelId - 获取实体树
 * @description 获取指定小说的完整实体树结构
 * @param {string} novelId - 小说ID
 * @returns {Object} 实体树结构
 */
router.get('/:novelId', async (c) => {
  const novelId = c.req.param('novelId')
  const result = await getEntityTree(c.env, novelId)
  return c.json(result)
})

/**
 * GET /:novelId/children/:parentId - 获取实体的子节点
 * @description 获取指定父节点下的所有子实体
 * @param {string} novelId - 小说ID
 * @param {string} parentId - 父实体ID
 * @returns {Object} { children: Array }
 */
router.get('/:novelId/children/:parentId', async (c) => {
  const { novelId, parentId } = c.req.param() as { novelId: string; parentId: string }
  const children = await getEntityChildren(c.env, novelId, parentId)
  return c.json({ children })
})

const RebuildSchema = z.object({
  novelId: z.string().min(1),
})

/**
 * POST /rebuild - 重建实体索引
 * @description 重新构建指定小说的实体索引
 * @param {string} novelId - 小说ID
 * @returns {Object} 重建结果
 * @throws {500} 重建失败
 */
router.post('/rebuild', zValidator('json', RebuildSchema), async (c) => {
  const { novelId } = c.req.valid('json')
  const result = await rebuildEntityIndex(c.env, novelId)
  
  if (!result.ok) {
    return c.json({ error: result.message, details: result.error }, 500)
  }
  
  return c.json(result)
})

export { router as entityIndexRouter }
