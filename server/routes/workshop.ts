/**
 * @file workshop.ts
 * @description 创作工坊路由模块 - 对话式创作引擎 API
 * @version 1.0.0
 * @created 2026-04-21 - Phase 3 对话式创作引擎
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { Env } from '../lib/types'
import {
  createWorkshopSession,
  getWorkshopSession,
  processWorkshopMessage,
  commitWorkshopSession,
} from '../services/workshop'
import { drizzle } from 'drizzle-orm/d1'
import { eq, isNull, and } from 'drizzle-orm'
import { volumes } from '../db/schema'

const router = new Hono<{ Bindings: Env }>()

// POST /api/workshop/session - 创建新的对话会话
router.post('/session', async (c) => {
  try {
    const body = await c.req.json()
    const session = await createWorkshopSession(c.env, {
      novelId: body.novelId,
      stage: body.stage || 'concept',
    })

    return c.json({
      ok: true,
      session: {
        id: session.id,
        stage: session.stage,
        status: session.status,
        createdAt: session.createdAt,
      },
    })
  } catch (error) {
    console.error('Create workshop session failed:', error)
    return c.json({ ok: false, error: (error as Error).message }, 500)
  }
})

// GET /api/workshop/session/:id - 获取会话历史
router.get('/session/:id', async (c) => {
  try {
    const sessionId = c.req.param('id')
    const session = await getWorkshopSession(c.env, sessionId)

    const messages = JSON.parse(session.messages || '[]')
    const extractedData = JSON.parse(session.extractedData || '{}')

    // 如果 extractedData 里没有 volumes，尝试两种补充途径：
    // 1. 关联了 novelId 时从 volumes 表读
    // 2. 从历史消息里扫描最后一条含 volumes 的 json 块（兼容纯工坊构思、未关联小说的场景）
    if (!extractedData.volumes) {
      // 途径1：从 volumes 表补充
      if (session.novelId) {
        try {
          const db = drizzle(c.env.DB)
          const vols = await db
            .select()
            .from(volumes)
            .where(and(eq(volumes.novelId, session.novelId), isNull(volumes.deletedAt)))
            .all()
          if (vols.length > 0) {
            extractedData.volumes = vols.map((v) => {
              let eventLine: string[] = []
              let notes: string[] = []
              let foreshadowingSetup: string[] = []
              let foreshadowingResolve: string[] = []
              try {
                if (v.eventLine) eventLine = JSON.parse(v.eventLine)
                if (v.notes) notes = JSON.parse(v.notes)
                if ((v as any).foreshadowingSetup) foreshadowingSetup = JSON.parse((v as any).foreshadowingSetup)
                if ((v as any).foreshadowingResolve) foreshadowingResolve = JSON.parse((v as any).foreshadowingResolve)
              } catch {}
              return {
                title: v.title,
                summary: v.summary || '',
                blueprint: v.blueprint || '',
                eventLine,
                notes,
                foreshadowingSetup,
                foreshadowingResolve,
                targetWordCount: v.targetWordCount || null,
                targetChapterCount: v.targetChapterCount || null,
              }
            })
          }
        } catch (e) {
          console.warn('[workshop GET] failed to supplement volumes from DB:', e)
        }
      }

      // 途径2：从历史消息里扫描（适用于全新构思、未关联小说的场景）
      if (!extractedData.volumes) {
        try {
          const assistantMessages = messages
            .filter((m: { role: string }) => m.role === 'assistant')
            .map((m: { content: string }) => m.content)
          // 倒序扫描，取最后一条含 volumes 的 json 块
          for (let i = assistantMessages.length - 1; i >= 0; i--) {
            const allBlocks = [...(assistantMessages[i] as string).matchAll(/```(?:json)?\s*([\s\S]*?)```/g)]
            for (let j = allBlocks.length - 1; j >= 0; j--) {
              try {
                const raw = allBlocks[j][1].trim()
                // 修复 AI 输出的未转义换行
                let inStr = false, esc = false, fixed = ''
                for (const ch of raw) {
                  if (esc) { esc = false; fixed += ch; continue }
                  if (ch === '\\') { esc = true; fixed += ch; continue }
                  if (ch === '"') { inStr = !inStr; fixed += ch; continue }
                  if (inStr && ch === '\n') { fixed += '\\n'; continue }
                  if (inStr && ch === '\r') { fixed += '\\r'; continue }
                  fixed += ch
                }
                const parsed = JSON.parse(fixed)
                if (parsed.volumes && Array.isArray(parsed.volumes) && parsed.volumes.length > 0) {
                  extractedData.volumes = parsed.volumes
                  console.log(`[workshop GET] recovered volumes from message history, count=${parsed.volumes.length}`)
                  break
                }
              } catch {}
            }
            if (extractedData.volumes) break
          }
        } catch (e) {
          console.warn('[workshop GET] failed to recover volumes from messages:', e)
        }
      }
    }

    return c.json({
      ok: true,
      session: {
        id: session.id,
        novelId: session.novelId,
        stage: session.stage,
        status: session.status,
        messages,
        extractedData,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      },
    })
  } catch (error) {
    if ((error as Error).message === 'Workshop session not found') {
      return c.json({ ok: false, error: '会话不存在' }, 404)
    }
    console.error('Get workshop session failed:', error)
    return c.json({ ok: false, error: (error as Error).message }, 500)
  }
})

// POST /api/workshop/session/:id/message - 发送消息（SSE 流式响应）
router.post('/session/:id/message', async (c) => {
  const sessionId = c.req.param('id')

  try {
    const body = await c.req.json()
    const { message, stage } = body

    if (!message || typeof message !== 'string') {
      return c.json({ ok: false, error: '消息内容不能为空' }, 400)
    }

    // 创建 SSE 流
    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()
    const encoder = new TextEncoder()

    // 启动异步处理
    processWorkshopMessage(
      c.env,
      sessionId,
      message,
      stage,
      (chunk) => {
        // 发送文本块
        const data = `data: ${JSON.stringify({ content: chunk })}\n\n`
        writer.write(encoder.encode(data))
      },
      (extractedData) => {
        // 发送完成事件 + 提取的结构化数据
        const doneData = `data: ${JSON.stringify({
          type: 'done',
          extractedData,
        })}\n\ndata: [DONE]\n\n`
        writer.write(encoder.encode(doneData))
        writer.close()
      },
      (error) => {
        // 发送错误
        const errorData = `data: ${JSON.stringify({
          type: 'error',
          error: error.message,
        })}\n\n`
        writer.write(encoder.encode(errorData))
        writer.close()
      }
    )

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (error) {
    console.error('Workshop message failed:', error)
    return c.json({ ok: false, error: (error as Error).message }, 500)
  }
})

// POST /api/workshop/session/:id/commit - 提交确认，写入数据库
router.post('/session/:id/commit', async (c) => {
  try {
    const sessionId = c.req.param('id')
    const result = await commitWorkshopSession(c.env, sessionId)

    return c.json({
      ...result,
      message: '创作数据已成功提交到数据库！',
    })
  } catch (error) {
    console.error('Commit workshop session failed:', error)
    return c.json({ ok: false, error: (error as Error).message }, 500)
  }
})

// GET /api/workshop/sessions - 列出所有活跃会话
router.get('/sessions', async (c) => {
  try {
    const { drizzle } = await import('drizzle-orm/d1')
    const { eq, desc } = await import('drizzle-orm')
    const { workshopSessions } = await import('../db/schema')

    const db = drizzle(c.env.DB)
    const sessions = await db.select().from(workshopSessions)
      .where(eq(workshopSessions.status, 'active'))
      .orderBy(desc(workshopSessions.updatedAt))
      .all()

    return c.json({
      ok: true,
      sessions: sessions.map(s => ({
        id: s.id,
        title: s.title || undefined,
        stage: s.stage,
        status: s.status,
        updatedAt: s.updatedAt,
      })),
    })
  } catch (error) {
    console.error('List workshop sessions failed:', error)
    return c.json({ ok: false, error: (error as Error).message }, 500)
  }
})

// DELETE /api/workshop/session/:id - 删除会话
router.delete('/session/:id', async (c) => {
  try {
    const sessionId = c.req.param('id')
    const { drizzle } = await import('drizzle-orm/d1')
    const { eq } = await import('drizzle-orm')
    const { workshopSessions } = await import('../db/schema')

    const db = drizzle(c.env.DB)
    await db.delete(workshopSessions).where(eq(workshopSessions.id, sessionId)).run()

    return c.json({ ok: true, message: '会话已删除' })
  } catch (error) {
    console.error('Delete workshop session failed:', error)
    return c.json({ ok: false, error: (error as Error).message }, 500)
  }
})

// PATCH /api/workshop/session/:id - 更新会话（如标题）
router.patch('/session/:id', async (c) => {
  try {
    const sessionId = c.req.param('id')
    const body = await c.req.json()
    
    const { drizzle } = await import('drizzle-orm/d1')
    const { eq } = await import('drizzle-orm')
    const { workshopSessions } = await import('../db/schema')

    const db = drizzle(c.env.DB)
    
    const updateData: Record<string, any> = {}
    if (body.title !== undefined) updateData.title = body.title
    if (body.stage !== undefined) updateData.stage = body.stage
    
    if (Object.keys(updateData).length === 0) {
      return c.json({ ok: false, error: '没有要更新的字段' }, 400)
    }

    await db.update(workshopSessions)
      .set({ ...updateData, updatedAt: Math.floor(Date.now() / 1000) })
      .where(eq(workshopSessions.id, sessionId))
      .run()

    return c.json({ ok: true, message: '会话已更新' })
  } catch (error) {
    console.error('Update workshop session failed:', error)
    return c.json({ ok: false, error: (error as Error).message }, 500)
  }
})

export { router as workshop }
