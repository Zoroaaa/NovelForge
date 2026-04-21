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
  VOLCENGINE_API_KEY: string
  ANTHROPIC_API_KEY: string
  OPENAI_API_KEY: string
}
