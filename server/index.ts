/**
 * @file index.ts
 * @description 后端服务入口文件，配置Hono应用、认证中间件和所有API路由
 * @version 2.1.0
 * @modified 2026-04-21 - P0修复：添加API Key认证中间件
 */
import { Hono } from 'hono'
import type { Env } from './lib/types'
import { authMiddleware } from './lib/auth'

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

const app = new Hono<{ Bindings: Env }>().basePath('/api')

app.get('/health', (c) => c.json({ status: 'ok', version: '2.1' }))

const api = new Hono<{ Bindings: Env }>()

api.use('*', async (c, next) => {
  return authMiddleware(c.env.API_KEY)(c, next)
})

api.route('/novels', novels)
api.route('/chapters', chapters)
api.route('/volumes', volumes)
api.route('/characters', characters)
api.route('/settings', novelSettingsRouter)
api.route('/rules', writingRulesRouter)
api.route('/master-outline', masterOutlineRouter)
api.route('/generate', generate)
api.route('/foreshadowing', foreshadowing)
api.route('/entities', entityIndexRouter)
api.route('/export', exportRouter)
api.route('/search', search)
api.route('/vectorize', vectorize)
api.route('/config', settings)
api.route('/workshop', workshop)

app.route('/', api)

app.route('/mcp', mcp)

export { app }
