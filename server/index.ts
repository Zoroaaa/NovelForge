import { Hono } from 'hono'
import type { Env } from './lib/types'
import { novels } from './routes/novels'
import { outlines } from './routes/outlines'
import { volumes } from './routes/volumes'
import { chapters } from './routes/chapters'
import { characters } from './routes/characters'
import { generate } from './routes/generate'
import { settings } from './routes/settings'

export const app = new Hono<{ Bindings: Env }>().basePath('/api')

app.route('/novels', novels)
app.route('/outlines', outlines)
app.route('/volumes', volumes)
app.route('/chapters', chapters)
app.route('/characters', characters)
app.route('/generate', generate)
app.route('/settings', settings)

app.get('/health', (c) => c.json({ ok: true, ts: Date.now() }))
