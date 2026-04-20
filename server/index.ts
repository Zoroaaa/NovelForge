import { Hono } from 'hono'
import type { Env } from './lib/types'

// 导入各功能域路由
import { router as novelsRouter } from './routes/novels'
import { router as volumesRouter } from './routes/volumes'
import { router as chaptersRouter } from './routes/chapters'
import { router as charactersRouter } from './routes/characters'
import { router as settingsConfigRouter } from './routes/settings'
import { router as generateRouter } from './routes/generate'
import { router as exportRouter } from './routes/export'
import { router as searchRouter } from './routes/search'
import { router as vectorizeRouter } from './routes/vectorize'
import { router as mcpRouter } from './routes/mcp'

// v2.0 新增路由
import { router as masterOutlineRouter } from './routes/master-outline'
import { router as novelSettingsRouter } from './routes/novel-settings'
import { router as writingRulesRouter } from './routes/writing-rules'
import { router as foreshadowingRouter } from './routes/foreshadowing'
import { router as entityIndexRouter } from './routes/entity-index'

const app = new Hono<{ Bindings: Env }>().basePath('/api')

// 健康检查
app.get('/health', (c) => c.json({ status: 'ok', version: '2.0' }))

// --- 小说基础管理 ---
app.route('/novels', novelsRouter)

// --- 内容创作管理 ---
app.route('/chapters', chaptersRouter)
app.route('/volumes', volumesRouter)

// --- 角色与设定 ---
app.route('/characters', charactersRouter)
app.route('/settings', novelSettingsRouter)

// --- 创作规则 ---
app.route('/rules', writingRulesRouter)

// --- 总纲管理 ---
app.route('/master-outline', masterOutlineRouter)

// --- AI 智能服务 ---
app.route('/generate', generateRouter)

// --- 伏笔追踪 ---
app.route('/foreshadowing', foreshadowingRouter)

// --- 总索引（树形结构）---
app.route('/entities', entityIndexRouter)

// --- 辅助工具 ---
app.route('/export', exportRouter)
app.route('/search', searchRouter)
app.route('/vectorize', vectorizeRouter)

// --- 系统配置（模型配置）---
app.route('/config', settingsConfigRouter)

// --- MCP 协议 ---
app.route('/mcp', mcpRouter)

export { app }
