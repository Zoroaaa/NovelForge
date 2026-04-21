/**
 * @file mcp.ts
 * @description MCP路由模块，提供Model Context Protocol HTTP端点
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { Hono } from 'hono'
import type { Env } from '../lib/types'
import { handleMCPRequest, type MCPRequest } from '../mcp'

const router = new Hono<{ Bindings: Env }>()

/**
 * POST / - MCP JSON-RPC 端点
 * @description 处理MCP JSON-RPC请求，支持Claude Desktop等MCP客户端连接
 * @param {Object} body - MCP请求对象
 * @returns {Object} MCP响应对象
 * @throws {400} 解析错误
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
 * GET / - MCP 服务状态检查
 * @description 返回MCP服务的基本信息和状态
 * @returns {Object} { ok: boolean, service: string, version: string, protocolVersion: string, tools: number }
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
