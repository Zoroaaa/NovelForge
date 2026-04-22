/**
 * @file index.ts
 * @description 后端服务入口文件，配置Hono应用、认证中间件和所有API路由
 * @version 3.1.0
 * @modified 2026-04-22 - 修复路由路径双重叠加导致 login/register/account 页面 401 的 bug
 *
 * 修复说明：
 *   原代码 publicApi.route('/auth/login', authRouter) 将整个 authRouter 挂在 /auth/login，
 *   而 authRouter 内部路径为 /login，导致实际生效路径变成 /api/auth/login/login。
 *   前端请求 /api/auth/login 匹配不到任何处理器，返回 401/404。
 *
 * 修复方案：
 *   直接在 app 层内联注册 POST /auth/login 和 POST /auth/register 为公开路由，
 *   Hono 先到先得，不经过后续 jwtAuthMiddleware。
 *   protectedApi 仍挂完整 authRouter 处理 /me /password /account，
 *   c.get('user') 由 jwtAuthMiddleware 正常注入。
 */
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { AppType } from './lib/types'
import { authMiddleware, jwtAuthMiddleware, adminAuthMiddleware, hashPassword, verifyPassword, generateToken, getJwtSecret } from './lib/auth'

import { novels } from './routes/novels'
import { volumes } from './routes/volumes'
import { chapters } from './routes/chapters'
import { characters } from './routes/characters'
import { settings } from './routes/settings'
import { generate } from './routes/generate'
import { export as exportRouter } from './routes/export'
import { search } from './routes/search'
import { vectorize, handleVectorStatus } from './routes/vectorize'
import { mcp } from './routes/mcp'

import { masterOutlineRouter } from './routes/master-outline'
import { novelSettingsRouter } from './routes/novel-settings'
import { writingRulesRouter } from './routes/writing-rules'
import { foreshadowing } from './routes/foreshadowing'
import { entityIndexRouter } from './routes/entity-index'
import { workshop } from './routes/workshop'

import authRouter from './routes/auth'
import inviteCodesRouter from './routes/invite-codes'
import systemSettingsRouter from './routes/system-settings'
import setupRouter from './routes/setup'

const app = new Hono<AppType>().basePath('/api')

app.use('*', cors())
app.get('/health', (c) => c.json({ status: 'ok', version: '3.1' }))

// ─── 公开路由：先于所有中间件注册，Hono 先到先得 ─────────────────────────────

// POST /api/auth/login
app.post('/auth/login', async (c) => {
  const body = await c.req.json()
  const { username, password } = body

  if (!username || !password) {
    return c.json({ error: 'Bad Request', code: 'VALIDATION_ERROR', message: '用户名和密码不能为空' }, 400)
  }

  try {
    const user = await c.env.DB.prepare(
      `SELECT id, username, email, password_hash, role, status
       FROM users
       WHERE (username = ? OR email = ?) AND deleted_at IS NULL`
    ).bind(username, username).first<{
      id: string; username: string; email: string
      password_hash: string; role: string; status: string
    }>()

    if (!user) {
      return c.json({ error: 'Unauthorized', code: 'INVALID_CREDENTIALS', message: '用户名或密码错误' }, 401)
    }
    if (user.status !== 'active') {
      return c.json({ error: 'Forbidden', code: 'ACCOUNT_DISABLED', message: '账号已被禁用，请联系管理员' }, 403)
    }

    const isValid = await verifyPassword(password, user.password_hash)
    if (!isValid) {
      return c.json({ error: 'Unauthorized', code: 'INVALID_CREDENTIALS', message: '用户名或密码错误' }, 401)
    }

    await c.env.DB.prepare(
      'UPDATE users SET last_login_at = unixepoch(), updated_at = unixepoch() WHERE id = ?'
    ).bind(user.id).run()

    const secret = await getJwtSecret(c.env)
    const token = await generateToken({ userId: user.id, username: user.username, role: user.role }, secret)

    return c.json({
      success: true,
      data: { token, user: { id: user.id, username: user.username, email: user.email, role: user.role } }
    })
  } catch (error) {
    console.error('Login error:', error)
    return c.json({ error: 'Internal Server Error', code: 'LOGIN_FAILED', message: '登录失败，请稍后重试' }, 500)
  }
})

// POST /api/auth/register
app.post('/auth/register', async (c) => {
  const body = await c.req.json()
  const { username, email, password, inviteCode } = body

  if (!username || username.length < 3 || username.length > 20 || !/^[a-zA-Z0-9_]+$/.test(username)) {
    return c.json({ error: 'Bad Request', code: 'VALIDATION_ERROR', message: '用户名3-20位，只能包含字母、数字和下划线' }, 400)
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: 'Bad Request', code: 'VALIDATION_ERROR', message: '请输入有效的邮箱地址' }, 400)
  }
  if (!password || password.length < 8 || !/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
    return c.json({ error: 'Bad Request', code: 'VALIDATION_ERROR', message: '密码至少8位，必须包含大小写字母和数字' }, 400)
  }

  try {
    const regSetting = await c.env.DB.prepare(
      'SELECT value FROM system_settings WHERE key = ?'
    ).bind('registration_enabled').first<{ value: string }>()

    if (!regSetting || regSetting.value !== 'true') {
      return c.json({ error: 'Forbidden', code: 'REGISTRATION_DISABLED', message: '注册功能已关闭' }, 403)
    }

    const existing = await c.env.DB.prepare(
      'SELECT id FROM users WHERE (username = ? OR email = ?) AND deleted_at IS NULL'
    ).bind(username, email).first()

    if (existing) {
      return c.json({ error: 'Conflict', code: 'USER_EXISTS', message: '用户名或邮箱已被使用' }, 409)
    }

    let inviteCodeId: string | null = null
    if (inviteCode) {
      const validCode = await c.env.DB.prepare(
        `SELECT id, max_uses, used_count, expires_at FROM invite_codes WHERE code = ? AND status = 'active'`
      ).bind(inviteCode).first<{ id: string; max_uses: number; used_count: number; expires_at: number | null }>()

      if (!validCode) {
        return c.json({ error: 'Bad Request', code: 'INVALID_INVITE_CODE', message: '无效的邀请码' }, 400)
      }
      if (validCode.expires_at && validCode.expires_at < Math.floor(Date.now() / 1000)) {
        await c.env.DB.prepare("UPDATE invite_codes SET status = 'expired', updated_at = unixepoch() WHERE id = ?").bind(validCode.id).run()
        return c.json({ error: 'Bad Request', code: 'EXPIRED_INVITE_CODE', message: '邀请码已过期' }, 400)
      }
      if (validCode.used_count >= validCode.max_uses) {
        await c.env.DB.prepare("UPDATE invite_codes SET status = 'used', updated_at = unixepoch() WHERE id = ?").bind(validCode.id).run()
        return c.json({ error: 'Bad Request', code: 'USED_UP_INVITE_CODE', message: '邀请码已用完' }, 400)
      }
      inviteCodeId = validCode.id
      await c.env.DB.prepare(
        'UPDATE invite_codes SET used_count = used_count + 1, updated_at = unixepoch() WHERE id = ?'
      ).bind(validCode.id).run()
    }

    const passwordHash = await hashPassword(password)
    const userId = Array.from(crypto.getRandomValues(new Uint8Array(8))).map(b => b.toString(16).padStart(2, '0')).join('')

    await c.env.DB.prepare(
      `INSERT INTO users (id, username, email, password_hash, role, invite_code_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'user', ?, unixepoch(), unixepoch())`
    ).bind(userId, username, email, passwordHash, inviteCodeId).run()

    const secret = await getJwtSecret(c.env)
    const token = await generateToken({ userId, username, role: 'user' }, secret)

    return c.json({
      success: true,
      data: { token, user: { id: userId, username, email, role: 'user' } }
    })
  } catch (error) {
    console.error('Register error:', error)
    return c.json({ error: 'Internal Server Error', code: 'REGISTER_FAILED', message: '注册失败，请稍后重试' }, 500)
  }
})

// GET /api/system-settings/registration（注册页面无需登录查询是否开放注册）
app.get('/system-settings/registration', async (c) => {
  try {
    const setting = await c.env.DB.prepare(
      "SELECT value FROM system_settings WHERE key = 'registration_enabled'"
    ).first<{ value: string }>()
    return c.json({ success: true, data: { registrationEnabled: setting?.value === 'true' } })
  } catch (error) {
    return c.json({ error: 'Internal Server Error', code: 'GET_REGISTRATION_STATUS_FAILED', message: '获取注册状态失败' }, 500)
  }
})

// GET /api/vectorize/status（诊断接口，公开访问，用于排查 503 问题）
app.get('/vectorize/status', handleVectorStatus)

// GET /api/novels/:id/cover（封面是 <img src> 直接加载，浏览器不带 Authorization header，必须公开）
app.get('/novels/:id/cover', async (c) => {
  const id = c.req.param('id')
  try {
    const novel = await c.env.DB.prepare(
      'SELECT cover_r2_key FROM novels WHERE id = ? AND deleted_at IS NULL'
    ).bind(id).first<{ cover_r2_key: string }>()

    if (!novel?.cover_r2_key) return c.json({ error: 'No cover' }, 404)

    const obj = await c.env.STORAGE.get(novel.cover_r2_key)
    if (!obj) return c.json({ error: 'Cover not found' }, 404)

    const blob = await obj.arrayBuffer()
    return c.body(blob, 200, {
      'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000',
    })
  } catch (error) {
    console.error('Get cover error:', error)
    return c.json({ error: 'Internal Server Error' }, 500)
  }
})

// GET /api/characters/:id/image（角色图片是 <img src> 直接加载，浏览器不带 Authorization header，必须公开）
app.get('/characters/:id/image', async (c) => {
  const id = c.req.param('id')
  try {
    const character = await c.env.DB.prepare(
      'SELECT image_r2_key FROM characters WHERE id = ? AND deleted_at IS NULL'
    ).bind(id).first<{ image_r2_key: string }>()

    if (!character?.image_r2_key) return c.json({ error: 'No image' }, 404)

    const obj = await c.env.STORAGE.get(character.image_r2_key)
    if (!obj) return c.json({ error: 'Image not found' }, 404)

    const blob = await obj.arrayBuffer()
    return c.body(blob, 200, {
      'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000',
    })
  } catch (error) {
    console.error('Get character image error:', error)
    return c.json({ error: 'Internal Server Error' }, 500)
  }
})

// ─── API Key 保护路由（初始化管理员）──────────────────────────────────────────
const apiKeyProtectedApi = new Hono<AppType>()
apiKeyProtectedApi.use('*', async (c, next) => {
  return authMiddleware(c.env.API_KEY)(c, next)
})
apiKeyProtectedApi.route('/setup', setupRouter)
app.route('/', apiKeyProtectedApi)

// ─── JWT 保护路由 ─────────────────────────────────────────────────────────────
// /auth/login 和 /auth/register 已在上方注册为公开路由，此处的 authRouter 只会处理
// /auth/me /auth/password /auth/account（这些路由在 authRouter 内部定义为 /me /password /account）
const protectedApi = new Hono<AppType>()
protectedApi.use('*', jwtAuthMiddleware())

protectedApi.route('/auth', authRouter)
protectedApi.route('/invite-codes', inviteCodesRouter)
protectedApi.route('/system-settings', systemSettingsRouter)

protectedApi.route('/novels', novels)
protectedApi.route('/chapters', chapters)
protectedApi.route('/volumes', volumes)
protectedApi.route('/characters', characters)
protectedApi.route('/settings', novelSettingsRouter)
protectedApi.route('/rules', writingRulesRouter)
protectedApi.route('/master-outline', masterOutlineRouter)
protectedApi.route('/generate', generate)
protectedApi.route('/foreshadowing', foreshadowing)
protectedApi.route('/entities', entityIndexRouter)
protectedApi.route('/export', exportRouter)
protectedApi.route('/search', search)
protectedApi.route('/vectorize', vectorize)
protectedApi.route('/config', settings)
protectedApi.route('/workshop', workshop)

app.route('/', protectedApi)

// ─── 管理员专属路由 ────────────────────────────────────────────────────────────
const adminApi = new Hono<AppType>()
adminApi.use('*', adminAuthMiddleware())
adminApi.route('/admin/system-settings', systemSettingsRouter)
app.route('/', adminApi)

// ─── MCP 路由 ─────────────────────────────────────────────────────────────────
const mcpApi = new Hono<AppType>()
mcpApi.use('*', jwtAuthMiddleware())
mcpApi.route('/', mcp)
app.route('/', mcpApi)

export { app }
