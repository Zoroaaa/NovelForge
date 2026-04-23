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
  mode?: 'generate' | 'continue' | 'rewrite'
  existingContent?: string
  targetWords?: number
  issuesContext?: string[]
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
