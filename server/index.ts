/**
 * @file index.ts
 * @description 后端服务入口文件，配置Hono应用、认证中间件和所有API路由
 * @version 3.0.0
 * @modified 2026-04-22 - 添加用户认证系统（JWT + 邀请码）
 */
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Env } from './lib/types'
import { authMiddleware, jwtAuthMiddleware, adminAuthMiddleware } from './lib/auth'

import { novels } from './routes/novels'
import { volumes } from './routes/volumes'
import { chapters } from './routes/chapters'
import { characters } from './routes/characters'
import { settings } from './routes/settings'
import { generate } from './routes/generate'
import { export as exportRouter } from './routes/export'
import { search } from './routes/search'
import { vectorize } from './routes/vectorize'
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

const app = new Hono<{ Bindings: Env }>().basePath('/api')

app.use('*', cors())
app.get('/health', (c) => c.json({ status: 'ok', version: '3.0' }))

const publicApi = new Hono<{ Bindings: Env }>()

publicApi.use('*', async (c, next) => {
  return authMiddleware(c.env.API_KEY)(c, next)
})

publicApi.route('/auth/login', authRouter)
publicApi.route('/auth/register', authRouter)
publicApi.route('/setup', setupRouter)

app.route('/', publicApi)

const protectedApi = new Hono<{ Bindings: Env }>()

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

const adminApi = new Hono<{ Bindings: Env }>()

adminApi.use('*', adminAuthMiddleware())
adminApi.route('/system-settings', systemSettingsRouter)

app.route('/', adminApi)

const mcpApi = new Hono<{ Bindings: Env }>()
mcpApi.use('*', jwtAuthMiddleware())
mcpApi.route('/', mcp)

app.route('/', mcpApi)

export { app }
