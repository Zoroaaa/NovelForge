/**
 * @file auth.ts
 * @description 认证与安全工具模块，提供API Key认证、数据加密等功能
 * @version 1.0.0
 */

import type { Context, Next } from 'hono'

export interface AuthConfig {
  apiKey?: string
}

const AUTH_HEADER = 'X-API-Key'

export async function verifyApiKey(apiKey: string | undefined, expectedKey: string): Promise<boolean> {
  if (!apiKey || !expectedKey) return false
  return apiKey === expectedKey
}

export function authMiddleware(expectedKey: string | undefined) {
  return async (c: Context, next: Next) => {
    if (!expectedKey) {
      console.warn('⚠️ API_KEY not configured, skipping authentication')
      return next()
    }

    const apiKey = c.req.header(AUTH_HEADER)
    const isValid = await verifyApiKey(apiKey, expectedKey)

    if (!isValid) {
      return c.json(
        { 
          error: 'Forbidden', 
          code: 'AUTH_REQUIRED',
          message: 'Valid API key required. Provide it via X-API-Key header.' 
        }, 
        403
      )
    }

    await next()
  }
}

export function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return 'An unexpected error occurred'
}
