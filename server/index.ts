/**
 * @file index.ts
 * @description 后端服务入口文件，配置Hono应用和所有API路由
 * @version 2.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { Hono } from 'hono'
import type { Env } from './lib/types'

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

const app = new Hono<{ Bindings: Env }>().basePath('/api')

app.get('/health', (c) => c.json({ status: 'ok', version: '2.0' }))

app.route('/novels', novels)
app.route('/chapters', chapters)
app.route('/volumes', volumes)
app.route('/characters', characters)
app.route('/settings', novelSettingsRouter)
app.route('/rules', writingRulesRouter)
app.route('/master-outline', masterOutlineRouter)
app.route('/generate', generate)
app.route('/foreshadowing', foreshadowing)
app.route('/entities', entityIndexRouter)
app.route('/export', exportRouter)
app.route('/search', search)
app.route('/vectorize', vectorize)
app.route('/config', settings)
app.route('/mcp', mcp)

export { app }
