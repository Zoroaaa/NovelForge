/**
 * @file types.ts
 * @description 章节健康检查模块共享类型
 */

export interface CoherenceIssue {
  severity: string
  category?: string
  message: string
  suggestion?: string
}

export interface CoherenceCheckResult {
  score: number
  issues: CoherenceIssue[]
}

export interface Conflict {
  characterName: string
  conflict: string
  excerpt: string
  dimension?: string
  issue?: string
  suggestion?: string
}

export interface CharacterCheckResult {
  score?: number
  conflicts?: Conflict[]
  warnings?: string[]
}

export interface CheckLog {
  id: string
  checkType: string
  score: number
  issuesCount?: number
  createdAt: number
  characterResult?: CharacterCheckResult
  coherenceResult?: CoherenceCheckResult
  volumeProgressResult?: VolumeProgressResult
}

export interface VolumeProgressResult {
  volumeId: string
  currentChapter: number
  targetChapter: number | null
  currentWordCount: number
  targetWordCount: number | null
  chapterProgress: number
  wordProgress: number
  perChapterEstimate: number | null
  wordCountIssues: WordCountIssue[]
  rhythmIssues: RhythmIssue[]
  wordCountScore: number
  rhythmScore: number
  diagnosis: string
  suggestion: string
  score: number
}

export interface WordCountIssue {
  chapterNumber: number
  chapterTitle: string
  message: string
  severity: 'error' | 'warning'
}

export interface RhythmIssue {
  chapterNumber: number
  chapterTitle: string
  dimension: string
  deviation: string
  suggestion?: string
  severity: 'error' | 'warning'
}

export interface CombinedReport {
  characterCheck: CharacterCheckResult
  coherenceCheck: CoherenceCheckResult
  volumeProgressCheck: VolumeProgressResult
  score: number
}

export interface RepairState {
  repairing: string | null
  repairedContent: string | null
  repairError: string | null
  repairTarget: string | null
  applyingRepair: boolean
  applyRepairSuccess: boolean
}