/**
 * @file auth.ts
 * @description 认证与安全工具模块（v2.0），提供JWT认证、密码哈希、Token管理等功能
 * @version 2.0.0
 * @modified 2026-04-22 - 添加用户认证系统
 */

import type { Context, Next } from 'hono'
import type { AppType, Env } from './types'

export interface AuthConfig {
  apiKey?: string
}

const AUTH_HEADER = 'X-API-Key'
const TOKEN_HEADER = 'Authorization'

interface JwtPayload {
  userId: string
  username: string
  role: string
  iat: number
  exp: number
}

interface AuthUser {
  userId: string
  username: string
  role: string
}

async function generateJwtSecret(): Promise<string> {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

function base64UrlEncode(data: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function base64UrlDecode(str: string): Promise<Uint8Array> {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

async function hmacSha256(key: string, data: string): Promise<string> {
  const encoder = new TextEncoder()
  const keyData = encoder.encode(key)
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data))
  return base64UrlEncode(new Uint8Array(signature))
}

export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  )
  
  const hashArray = new Uint8Array(bits)
  const combined = new Uint8Array(salt.length + hashArray.length)
  combined.set(salt)
  combined.set(hashArray, salt.length)
  
  return base64UrlEncode(combined)
}

export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  try {
    const combined = await base64UrlDecode(hashedPassword)
    const salt = combined.slice(0, 16)
    const storedHash = combined.slice(16)
    
    const encoder = new TextEncoder()
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    )
    
    const bits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      256
    )
    
    const computedHash = new Uint8Array(bits)
    
    if (storedHash.length !== computedHash.length) return false
    
    let result = 0
    for (let i = 0; i < storedHash.length; i++) {
      result |= storedHash[i] ^ computedHash[i]
    }
    return result === 0
  } catch (error) {
    console.error('Password verification error:', error)
    return false
  }
}

export async function generateToken(payload: Omit<JwtPayload, 'iat' | 'exp'>, secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const fullPayload: JwtPayload = {
    ...payload,
    iat: now,
    exp: now + 7 * 24 * 60 * 60
  }
  
  const header = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const payloadEncoded = base64UrlEncode(new TextEncoder().encode(JSON.stringify(fullPayload)))
  const signature = await hmacSha256(secret, `${header}.${payloadEncoded}`)
  
  return `${header}.${payloadEncoded}.${signature}`
}

export async function verifyToken(token: string, secret: string): Promise<JwtPayload | null> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    
    const [header, payload, signature] = parts
    const expectedSignature = await hmacSha256(secret, `${header}.${payload}`)
    
    if (signature !== expectedSignature) return null
    
    const decoded: JwtPayload = JSON.parse(new TextDecoder().decode(await base64UrlDecode(payload)))
    
    if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
      return null
    }
    
    return decoded
  } catch (error) {
    console.error('Token verification error:', error)
    return null
  }
}

export function extractTokenFromHeader(authHeader: string | undefined): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null
  return authHeader.substring(7)
}

export async function getJwtSecret(env: Env): Promise<string> {
  if (env.JWT_SECRET) return env.JWT_SECRET
  
  try {
    const result = await env.DB.prepare(
      'SELECT value FROM system_settings WHERE key = ?'
    ).bind('jwt_secret').first<{ value: string }>()
    
    if (result?.value && result.value !== 'CHANGE_ME_IN_PRODUCTION') {
      return result.value
    }
    
    const newSecret = await generateJwtSecret()
    await env.DB.prepare(
      'INSERT OR REPLACE INTO system_settings (key, value, description, updated_at) VALUES (?, ?, ?, unixepoch())'
    ).bind('jwt_secret', newSecret, 'JWT密钥（自动生成）').run()
    
    return newSecret
  } catch (error) {
    console.error('Failed to get/create JWT secret:', error)
    throw new Error('Failed to initialize authentication system')
  }
}

export async function authenticateUser(token: string | null, env: Env): Promise<AuthUser | null> {
  if (!token) return null
  
  const secret = await getJwtSecret(env)
  const payload = await verifyToken(token, secret)
  
  if (!payload) return null
  
  const user = await env.DB.prepare(
    'SELECT id, username, role, status FROM users WHERE id = ? AND deleted_at IS NULL'
  ).bind(payload.userId).first<{ id: string; username: string; role: string; status: string }>()
  
  if (!user || user.status !== 'active') return null
  
  return {
    userId: user.id,
    username: user.username,
    role: user.role
  }
}

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

export function jwtAuthMiddleware() {
  return async (c: Context<AppType>, next: Next) => {
    const authHeader = c.req.header(TOKEN_HEADER)
    const token = extractTokenFromHeader(authHeader)
    
    if (!token) {
      return c.json({
        error: 'Unauthorized',
        code: 'TOKEN_REQUIRED',
        message: 'Authentication required. Please login first.'
      }, 401)
    }
    
    const user = await authenticateUser(token, c.env)
    
    if (!user) {
      return c.json({
        error: 'Unauthorized',
        code: 'INVALID_TOKEN',
        message: 'Invalid or expired token. Please login again.'
      }, 401)
    }
    
    c.set('user', user)
    await next()
  }
}

export function adminAuthMiddleware() {
  return async (c: Context<AppType>, next: Next) => {
    const authHeader = c.req.header(TOKEN_HEADER)
    const token = extractTokenFromHeader(authHeader)
    
    if (!token) {
      return c.json({
        error: 'Unauthorized',
        code: 'TOKEN_REQUIRED',
        message: 'Authentication required. Please login first.'
      }, 401)
    }
    
    const user = await authenticateUser(token, c.env)
    
    if (!user) {
      return c.json({
        error: 'Unauthorized',
        code: 'INVALID_TOKEN',
        message: 'Invalid or expired token. Please login again.'
      }, 401)
    }
    
    if (user.role !== 'admin') {
      return c.json({
        error: 'Forbidden',
        code: 'ADMIN_REQUIRED',
        message: 'Admin privileges required.'
      }, 403)
    }
    
    c.set('user', user)
    await next()
  }
}

export function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return 'An unexpected error occurred'
}
