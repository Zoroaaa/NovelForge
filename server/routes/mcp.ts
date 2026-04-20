/**
 * NovelForge · MCP 路由
 *
 * Model Context Protocol HTTP 端点
 * POST /api/mcp - MCP JSON-RPC 接口
 */

import { Hono } from 'hono'
import type { Env } from '../lib/types'
import { handleMCPRequest, type MCPRequest } from '../mcp'

const router = new Hono<{ Bindings: Env }>()

/**
 * POST /api/mcp
 *
 * MCP JSON-RPC 端点
 * 支持 Claude Desktop 等 MCP 客户端连接
 */
router.post('/', async (c) => {
  try {
    const body = await c.req.json() as MCPRequest
    const response = await handleMCPRequest(c.env, body)
    return c.json(response)
  } catch (error) {
    return c.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: `Parse error: ${(error as Error).message}`,
        },
      },
      400
    )
  }
})

/**
 * GET /api/mcp
 *
 * MCP 服务状态检查
 */
router.get('/', (c) => {
  return c.json({
    ok: true,
    service: 'NovelForge MCP',
    version: '1.0.0',
    protocolVersion: '2024-11-05',
    tools: 5,
  })
})

export { router as mcp }
