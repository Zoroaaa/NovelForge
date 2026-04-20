/**
 * NovelForge · 路由入口 & 注册中心（v2.0 重构版）
 *
 * 统一注册所有子路由，按功能域分类：
 * - 小说基础管理 (novels)
 * - 内容创作管理 (chapters, volumes)
 * - 角色与设定 (characters, settings)
 * - 创作规则 (rules)
 * - 总纲管理 (master-outline)
 * - AI 智能服务 (generate)
 * - 伏笔追踪 (foreshadowing)
 * - 总索引树形结构 (entities)
 * - 辅助工具 (export, search, vectorize)
 * - 系统配置 (settings-config)
 */

import { Hono } from 'hono'
import type { Env } from '../lib/types'

// 导入各功能域路由
import { router as novelsRouter } from './novels'
import { router as chaptersRouter } from './chapters'
import { router as volumesRouter } from './volumes'
import { router as charactersRouter } from './characters'
import { router as settingsConfigRouter } from './settings'
import { router as generateRouter } from './generate'
import { router as exportRouter } from './export'
import { router as searchRouter } from './search'
import { router as vectorizeRouter } from './vectorize'
import { router as mcpRouter } from './mcp'

// v2.0 新增路由（按功能域清晰分类）
import { router as novelSettingsRouter } from './novel-settings'       // 小说设定 CRUD
import { router as writingRulesRouter } from './writing-rules'        // 创作规则 CRUD
import { router as masterOutlineRouter } from './master-outline'      // 总纲管理
import { router as foreshadowingRouter } from './foreshadowing'      // 伏笔追踪 CRUD
import { router as entityIndexRouter } from './entity-index'          // 总索引/树形结构

const app = new Hono<{ Bindings: Env }>()

// 健康检查
app.get('/health', (c) => c.json({ status: 'ok', version: '2.0' }))

// ============================================================
// API 版本前缀
// ============================================================
const apiV1 = new Hono<{ Bindings: Env }>()

// --- 小说基础管理 ---
apiV1.route('/novels', novelsRouter)

// --- 内容创作管理 ---
apiV1.route('/chapters', chaptersRouter)
apiV1.route('/volumes', volumesRouter)

// --- 角色与设定 ---
apiV1.route('/characters', charactersRouter)
apiV1.route('/settings', novelSettingsRouter)       // v2.0: 小说设定（世界观/境界/势力等）

// --- 创作规则 ---
apiV1.route('/rules', writingRulesRouter)           // v2.0: 创作规则（文风/节奏/禁忌等）

// --- 总纲管理 ---
apiV1.route('/master-outline', masterOutlineRouter) // v2.0: 总纲（替代原 outlines）

// --- AI 智能服务 ---
apiV1.route('/generate', generateRouter)

// --- 伏笔追踪 ---
apiV1.route('/foreshadowing', foreshadowingRouter)   // Phase 1.2 / v2.0

// --- 总索引（树形结构）---
apiV1.route('/entities', entityIndexRouter)         // v2.0: 实体索引

// --- 辅助工具 ---
apiV1.route('/export', exportRouter)
apiV1.route('/search', searchRouter)
apiV1.route('/vectorize', vectorizeRouter)

// --- 系统配置 ---
apiV1.route('/config', settingsConfigRouter)

// --- MCP 协议 ---
apiV1.route('/mcp', mcpRouter)

app.route('/api/v1', apiV1)

export default app
