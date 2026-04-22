/**
 * @file invite-codes.ts
 * @description 邀请码管理API路由：生成、列表、删除、启用/禁用
 * @version 1.0.0
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import type { AppType } from '../lib/types'

const app = new Hono<AppType>()

const createInviteCodeSchema = z.object({
  maxUses: z.number().int().min(1).max(100).default(1),
  expiresInDays: z.number().int().min(0).max(365).optional()
})

app.get('/', async (c) => {
  try {
    const page = parseInt(c.req.query('page') || '1')
    const pageSize = Math.min(parseInt(c.req.query('pageSize') || '20'), 100)
    const status = c.req.query('status')
    const offset = (page - 1) * pageSize

    let whereClause = '1=1'
    const bindings: unknown[] = []

    if (status && ['active', 'used', 'expired', 'disabled'].includes(status)) {
      whereClause += ' AND ic.status = ?'
      bindings.push(status)
    }

    const countResult = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM invite_codes ic WHERE ${whereClause}`
    ).bind(...bindings).first<{ total: number }>()

    const codes = await c.env.DB.prepare(
      `SELECT ic.*, u.username as created_by_username 
       FROM invite_codes ic 
       LEFT JOIN users u ON ic.created_by = u.id 
       WHERE ${whereClause} 
       ORDER BY ic.created_at DESC 
       LIMIT ? OFFSET ?`
    ).bind(...bindings, pageSize, offset).all()

    return c.json({
      success: true,
      data: {
        items: codes.results,
        pagination: {
          page,
          pageSize,
          total: countResult?.total || 0,
          totalPages: Math.ceil((countResult?.total || 0) / pageSize)
        }
      }
    })
  } catch (error) {
    console.error('Get invite codes error:', error)
    return c.json({
      error: 'Internal Server Error',
      code: 'GET_INVITE_CODES_FAILED',
      message: '获取邀请码列表失败'
    }, 500)
  }
})

app.post('/', async (c) => {
  const user = c.get('user')

  try {
    const body = await c.req.json()
    const parsed = createInviteCodeSchema.safeParse(body)

    if (!parsed.success) {
      return c.json({
        error: 'Validation Error',
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0].message
      }, 400)
    }

    const { maxUses, expiresInDays } = parsed.data

    const id = Array.from(crypto.getRandomValues(new Uint8Array(8)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')

    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    const codeArray = Array.from({ length: 8 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    )
    const code = codeArray.join('')

    const expiresAt = expiresInDays 
      ? Math.floor(Date.now() / 1000) + expiresInDays * 24 * 60 * 60 
      : null

    await c.env.DB.prepare(
      `INSERT INTO invite_codes (id, code, created_by, max_uses, expires_at, status, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, 'active', unixepoch(), unixepoch())`
    ).bind(id, code, user.userId, maxUses, expiresAt).run()

    const newCode = await c.env.DB.prepare(
      `SELECT ic.*, u.username as created_by_username 
       FROM invite_codes ic 
       LEFT JOIN users u ON ic.created_by = u.id 
       WHERE ic.id = ?`
    ).bind(id).first()

    return c.json({
      success: true,
      data: newCode
    })
  } catch (error) {
    console.error('Create invite code error:', error)
    return c.json({
      error: 'Internal Server Error',
      code: 'CREATE_INVITE_CODE_FAILED',
      message: '创建邀请码失败'
    }, 500)
  }
})

app.patch('/:id/status', async (c) => {
  const user = c.get('user')
  const codeId = c.req.param('id')

  try {
    const body = await c.req.json()
    const { status } = body

    if (!['active', 'disabled'].includes(status)) {
      return c.json({
        error: 'Validation Error',
        code: 'INVALID_STATUS',
        message: '状态必须是 active 或 disabled'
      }, 400)
    }

    const existingCode = await c.env.DB.prepare(
      'SELECT id FROM invite_codes WHERE id = ?'
    ).bind(codeId).first()

    if (!existingCode) {
      return c.json({
        error: 'Not Found',
        code: 'INVITE_CODE_NOT_FOUND',
        message: '邀请码不存在'
      }, 404)
    }

    await c.env.DB.prepare(
      "UPDATE invite_codes SET status = ?, updated_at = unixepoch() WHERE id = ?"
    ).bind(status, codeId).run()

    return c.json({
      success: true,
      message: `邀请码已${status === 'active' ? '启用' : '禁用'}`
    })
  } catch (error) {
    console.error('Update invite code status error:', error)
    return c.json({
      error: 'Internal Server Error',
      code: 'UPDATE_INVITE_CODE_FAILED',
      message: '更新邀请码状态失败'
    }, 500)
  }
})

app.delete('/:id', async (c) => {
  const codeId = c.req.param('id')

  try {
    const existingCode = await c.env.DB.prepare(
      'SELECT id, used_count FROM invite_codes WHERE id = ?'
    ).bind(codeId).first<{ id: string; used_count: number }>()

    if (!existingCode) {
      return c.json({
        error: 'Not Found',
        code: 'INVITE_CODE_NOT_FOUND',
        message: '邀请码不存在'
      }, 404)
    }

    if (existingCode.used_count > 0) {
      return c.json({
        error: 'Bad Request',
        code: 'CANNOT_DELETE_USED_CODE',
        message: '无法删除已使用的邀请码，建议禁用该邀请码'
      }, 400)
    }

    await c.env.DB.prepare(
      'DELETE FROM invite_codes WHERE id = ?'
    ).bind(codeId).run()

    return c.json({
      success: true,
      message: '邀请码已删除'
    })
  } catch (error) {
    console.error('Delete invite code error:', error)
    return c.json({
      error: 'Internal Server Error',
      code: 'DELETE_INVITE_CODE_FAILED',
      message: '删除邀请码失败'
    }, 500)
  }
})

export default app
