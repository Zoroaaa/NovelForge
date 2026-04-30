export interface CostSummary {
  totalTokens: number
  totalCost: number
  avgCostPerChapter: number
  modelBreakdown: Array<{
    modelId: string
    tokens: number
    cost: number
    percentage: number
  }>
  dailyTrend: Array<{
    date: string
    inputTokens: number
    outputTokens: number
    cost: number
  }>
  stageBreakdown: Array<{
    stage: string
    tokens: number
    count: number
  }>
}

export interface CostDetail {
  id: string
  chapterId: string
  chapterNumber: number
  stage: string
  modelId: string
  promptTokens: number
  completionTokens: number
  cost: number
  createdAt: number
}

export interface QualityChapterData {
  id: string
  chapterNumber: number
  title: string
  lastCheckedAt: number | null
  coherenceScore: number | null
  characterScore: number | null
  progressScore: number | null
  overallScore: number | null
  issueCount: number
  issues: Array<{
    severity: 'error' | 'warning'
    category: string
    message: string
  }>
}

export interface QualitySummary {
  chapters: QualityChapterData[]
  averages: {
    coherence: number
    character: number
    progress: number
    overall: number
  }
}

export type PeriodType = 'day' | 'week' | 'month'

export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4': { input: 0.03, output: 0.06 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  'gpt-4o': { input: 0.005, output: 0.015 },
  'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
  'claude-3-opus': { input: 0.015, output: 0.075 },
  'claude-3-sonnet': { input: 0.003, output: 0.015 },
  'claude-3-haiku': { input: 0.00025, output: 0.00125 },
}

export function calculateCost(modelId: string, promptTokens: number, completionTokens: number): number {
  const pricing = MODEL_PRICING[modelId] || { input: 0.01, output: 0.02 }
  return (promptTokens / 1000) * pricing.input + (completionTokens / 1000) * pricing.output
}
