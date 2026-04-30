/**
 * @file types.ts
 * @description 后端类型定义文件，定义Cloudflare Worker环境变量类型
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */

export type Env = {
  DB: D1Database
  STORAGE: R2Bucket
  AI: Ai
  VECTORIZE?: VectorizeIndex
  TASK_QUEUE: Queue
  ASSETS: Fetcher
  VOLCENGINE_API_KEY: string
  ANTHROPIC_API_KEY: string
  OPENAI_API_KEY: string
  API_KEY?: string
  JWT_SECRET?: string
  CLOUDFLARE_API_TOKEN?: string
  CLOUDFLARE_ACCOUNT_ID?: string
}

export type UserPayload = {
  userId: string
  username: string
  email?: string
  role: string
}

export type AppType = {
  Bindings: Env
  Variables: {
    user: UserPayload
  }
}
