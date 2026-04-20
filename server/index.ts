import { Hono } from 'hono'
import type { Env } from './lib/types'
import { novels } from './routes/novels'
import { masterOutlineRouter as outlines } from './routes/master-outline'
import { volumes } from './routes/volumes'
import { chapters } from './routes/chapters'
import { characters } from './routes/characters'
import { generate } from './routes/generate'
import { settings } from './routes/settings'
import { vectorize } from './routes/vectorize'
import { search } from './routes/search'
import * as exportModule from './routes/export'
import { mcp } from './routes/mcp'

export const app = new Hono<{ Bindings: Env }>().basePath('/api')

app.route('/novels', novels)
app.route('/outlines', outlines)
app.route('/volumes', volumes)
app.route('/chapters', chapters)
app.route('/characters', characters)
app.route('/generate', generate)
app.route('/settings', settings)
app.route('/vectorize', vectorize)
app.route('/search', search)
app.route('/export', exportModule.export)
app.route('/mcp', mcp)

app.get('/health', (c) => c.json({ ok: true, ts: Date.now(), phase: 3 }))
