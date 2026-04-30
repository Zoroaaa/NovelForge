/**
 * @file types.ts
 * @description Agent智能生成系统类型定义
 */
import type { ContextBundle } from '../contextBuilder'

export interface AgentConfig {
  maxIterations?: number
  enableRAG?: boolean
  enableAutoSummary?: boolean
}

export interface GenerationOptions {
  /** 批量生成时设为 true，跳过 post_process_chapter 入队（由 batch 流程自行控制后续）*/
  skipPostProcess?: boolean
  /** 草稿模式：true 时只生成内容不触发后处理，章节状态标记为 draft */
  draftMode?: boolean
  mode?: 'generate' | 'continue' | 'rewrite'
  existingContent?: string
  targetWords?: number
  issuesContext?: string[]
  isBackgroundGeneration?: boolean
}

export interface GenerationResult {
  success: boolean
  contextBundle: ContextBundle | null
  error?: string
  usage?: {
    promptTokens: number
    completionTokens: number
  }
}

export interface ToolCallEvent {
  type: 'tool_call'
  name: string
  args: Record<string, any>
  status: 'running' | 'done'
  result?: string
}

export interface CoherenceCheckResult {
  hasIssues: boolean
  issues: Array<{
    severity: 'warning' | 'error'
    category: 'continuity' | 'foreshadowing' | 'power_level' | 'consistency'
    message: string
    suggestion?: string
  }>
  score: number
}

export const DEFAULT_AGENT_CONFIG: Required<AgentConfig> = {
  maxIterations: 5,
  enableRAG: true,
  enableAutoSummary: true,
}
