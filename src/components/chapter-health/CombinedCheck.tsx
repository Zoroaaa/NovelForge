/**
 * @file CombinedCheck.tsx
 * @description 综合检查组件（章节检查模块专用）
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Shield, Link, Target, ShieldAlert, AlertTriangle, CheckCircle,
  Loader2, ChevronDown, ChevronUp, Wand2, Check,
} from 'lucide-react'
import { api } from '@/lib/api'
import type { VolumeProgressResult } from '@/lib/types'

interface Conflict {
  characterName: string
  conflict: string
  excerpt: string
  dimension?: string
  issue?: string
  suggestion?: string
}

interface CoherenceIssue {
  severity: 'error' | 'warning'
  category?: string
  message: string
  suggestion?: string
}

interface CombinedCheckResult {
  score: number
  characterCheck: {
    score: number
    conflicts: Conflict[]
    warnings: string[]
  }
  coherenceCheck: {
    score: number
    issues: CoherenceIssue[]
  }
  volumeProgressCheck: VolumeProgressResult
  hasIssues: boolean
}

interface CombinedCheckProps {
  novelId: string
  chapterId: string | null
  onCheckComplete?: (result: CombinedCheckResult) => void
  combinedReport?: any
}

export function CombinedCheck({ novelId, chapterId, onCheckComplete, combinedReport }: CombinedCheckProps) {
  const [checking, setChecking] = useState(false)
  const [expandedItem, setExpandedItem] = useState<string | null>(null)
  const [repairing, setRepairing] = useState<string | null>(null)
  const [repairedContent, setRepairedContent] = useState<string | null>(null)
  const [repairError, setRepairError] = useState<string | null>(null)
  const [internalResult, setInternalResult] = useState<CombinedCheckResult | null>(null)

  const result: CombinedCheckResult | null = internalResult || (combinedReport as CombinedCheckResult | null) || null

  const { data: characters } = useQuery({
    queryKey: ['characters', novelId],
    queryFn: () => api.characters.list(novelId),
    enabled: !!novelId,
  })

  const handleCheck = async () => {
    if (!chapterId) return
    setChecking(true)
    setInternalResult(null)
    setRepairedContent(null)
    setRepairError(null)

    try {
      const data = await api.generate.combinedCheck({ chapterId, novelId })
      const typedResult: CombinedCheckResult = {
        ...data,
        characterCheck: {
          ...data.characterCheck,
          score: data.characterCheck.score,
          conflicts: data.characterCheck.conflicts || [],
          warnings: data.characterCheck.warnings || [],
        },
        coherenceCheck: {
          ...data.coherenceCheck,
          issues: (data.coherenceCheck.issues || []).map((i: any) => ({
            ...i,
            severity: i.severity as 'error' | 'warning'
          }))
        },
        volumeProgressCheck: data.volumeProgressCheck,
      }
      setInternalResult(typedResult)
      onCheckComplete?.(typedResult)
    } catch (error) {
      console.error('综合检查失败:', error)
      setInternalResult({
        score: 0,
        characterCheck: { score: 0, conflicts: [], warnings: [`检查失败: ${(error as Error).message}`] },
        coherenceCheck: { score: 0, issues: [] },
        volumeProgressCheck: {
          volumeId: '', currentChapter: 0, targetChapter: null, currentWordCount: 0,
          targetWordCount: null, chapterProgress: 0, wordProgress: 0,
          perChapterEstimate: null, wordCountIssues: [], rhythmIssues: [],
          wordCountScore: 0, rhythmScore: 0, diagnosis: '检查失败', suggestion: '', score: 0,
        },
        hasIssues: true,
      })
    } finally {
      setChecking(false)
    }
  }

  const handleRepair = async (type: 'coherence' | 'character' | 'volume') => {
    if (!chapterId || !result) return
    setRepairing(type)
    setRepairedContent(null)
    setRepairError(null)

    try {
      let body: Parameters<typeof api.generate.repairChapter>[0] = {
        chapterId, novelId, repairType: type,
      }

      if (type === 'coherence') {
        body.coherenceIssues = result.coherenceCheck.issues.map(i => ({
          severity: i.severity, message: i.message, suggestion: i.suggestion, category: i.category,
        }))
        body.coherenceScore = result.coherenceCheck.score
      } else if (type === 'character') {
        body.characterConflicts = result.characterCheck.conflicts.map(c => ({
          characterName: c.characterName,
          dimension: c.dimension || '角色一致性',
          issue: c.issue || c.conflict,
          excerpt: c.excerpt,
          suggestion: c.suggestion,
        }))
      } else if (type === 'volume') {
        body.wordCountIssues = result.volumeProgressCheck.wordCountIssues.map(w => ({
          chapterNumber: w.chapterNumber, chapterTitle: w.chapterTitle, message: w.message,
        }))
        body.rhythmIssues = result.volumeProgressCheck.rhythmIssues.map(r => ({
          chapterNumber: r.chapterNumber, chapterTitle: r.chapterTitle,
          dimension: r.dimension, deviation: r.deviation, suggestion: r.suggestion,
        }))
        body.volumeContext = `${result.volumeProgressCheck.diagnosis}。${result.volumeProgressCheck.suggestion}`
      }

      const data = await api.generate.repairChapter(body)
      if (data.ok && data.repairedContent) {
        setRepairedContent(data.repairedContent)
      } else {
        setRepairError(data.error || '修复失败')
      }
    } catch (error) {
      setRepairError((error as Error).message)
    } finally {
      setRepairing(null)
    }
  }

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600'
    if (score >= 60) return 'text-amber-600'
    return 'text-red-600'
  }

  if (!chapterId) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground text-sm">请先选择一个章节</div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Shield className="h-4 w-4" /><Link className="h-4 w-4" /><Target className="h-4 w-4" />
          综合质量检查
        </CardTitle>
      </CardHeader>

      <CardContent>
        {!result && !checking && (
          <div className="text-center py-6 text-muted-foreground text-sm">
            同时执行角色一致性检查、章节连贯性检查和卷完成度检查，提供全面的健康评估
          </div>
        )}

        {checking && (
          <div className="flex items-center justify-center py-6 gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />正在执行综合检查...
          </div>
        )}

        {result && !checking && (
          <div className="space-y-3">
            {/* 综合评分 */}
            <div className="flex items-center gap-2 flex-wrap p-3 bg-muted/30 rounded-lg border">
              <div className="flex items-baseline gap-1">
                <span className="text-xs text-muted-foreground">综合评分:</span>
                <span className={`text-lg font-bold ${getScoreColor(result.score)}`}>{result.score}/100</span>
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <Badge variant="outline" className="gap-1 text-xs">
                  <Shield className="h-3 w-3" />角色:<span className={getScoreColor(result.characterCheck.score)}>{result.characterCheck.score}</span>
                </Badge>
                <Badge variant="outline" className="gap-1 text-xs">
                  <Link className="h-3 w-3" />连贯:<span className={getScoreColor(result.coherenceCheck.score)}>{result.coherenceCheck.score}</span>
                </Badge>
                <Badge variant="outline" className="gap-1 text-xs">
                  <Target className="h-3 w-3" />卷进度:<span className={getScoreColor(result.volumeProgressCheck.score)}>{result.volumeProgressCheck.score}</span>
                </Badge>
              </div>
            </div>

            {/* 角色冲突列表 */}
            {result.characterCheck.conflicts.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-destructive flex items-center gap-1">
                    <ShieldAlert className="h-3.5 w-3.5" />角色冲突 ({result.characterCheck.conflicts.length})
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-[10px] gap-1"
                    disabled={repairing !== null}
                    onClick={() => handleRepair('character')}
                  >
                    {repairing === 'character' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                    AI修复
                  </Button>
                </div>
                <ScrollArea className="max-h-48">
                  <div className="space-y-1">
                    {result.characterCheck.conflicts.map((conflict, i) => (
                      <div key={`char-${i}`} className="border rounded-md overflow-hidden">
                        <button
                          onClick={() => setExpandedItem(expandedItem === `char-${i}` ? null : `char-${i}`)}
                          className="w-full flex items-center justify-between p-2 text-left hover:bg-muted/30 transition-colors"
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <ShieldAlert className="h-4 w-4 text-destructive shrink-0" />
                            <span className="text-xs font-medium truncate">{conflict.characterName}</span>
                          </div>
                          {expandedItem === `char-${i}` ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                        {expandedItem === `char-${i}` && (
                          <div className="px-3 pb-3 space-y-2 bg-muted/20 border-t">
                            <div className="pt-2">
                              <span className="text-xs text-muted-foreground">冲突：</span>
                              <p className="text-xs mt-1">{conflict.conflict || conflict.issue}</p>
                            </div>
                            {conflict.excerpt && (
                              <div className="p-2 bg-background rounded border text-xs text-muted-foreground italic">"{conflict.excerpt}"</div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* 角色警告列表 */}
            {result.characterCheck.warnings.filter(w => !w.includes('失败')).length > 0 && (
              <div className="space-y-1">
                {result.characterCheck.warnings.filter(w => !w.includes('失败')).map((w, i) => (
                  <div key={`char-warn-${i}`} className="flex items-start gap-2 p-2 bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded text-xs text-yellow-700 dark:text-yellow-300">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /><span>{w}</span>
                  </div>
                ))}
              </div>
            )}

            {/* 连贯性问题列表 */}
            {result.coherenceCheck.issues.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-amber-600 flex items-center gap-1">
                    <Link className="h-3.5 w-3.5" />连贯性问题 ({result.coherenceCheck.issues.length})
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-[10px] gap-1"
                    disabled={repairing !== null}
                    onClick={() => handleRepair('coherence')}
                  >
                    {repairing === 'coherence' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                    AI修复
                  </Button>
                </div>
                <ScrollArea className="max-h-48">
                  <div className="space-y-1">
                    {result.coherenceCheck.issues.map((issue, i) => (
                      <div key={`coh-${i}`} className={`border rounded-md overflow-hidden ${issue.severity === 'error' ? 'border-red-200 dark:border-red-800' : 'border-amber-200 dark:border-amber-800'}`}>
                        <button
                          onClick={() => setExpandedItem(expandedItem === `coh-${i}` ? null : `coh-${i}`)}
                          className="w-full flex items-center justify-between p-2 text-left hover:bg-muted/30 transition-colors"
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <AlertTriangle className={`h-4 w-4 shrink-0 ${issue.severity === 'error' ? 'text-destructive' : 'text-yellow-600'}`} />
                            <span className="text-xs font-medium truncate">{issue.message}</span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${issue.severity === 'error' ? 'text-red-600 border-red-300' : 'text-yellow-600 border-yellow-300'}`}>
                              {issue.category || '其他'}
                            </Badge>
                            {expandedItem === `coh-${i}` ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </div>
                        </button>
                        {expandedItem === `coh-${i}` && issue.suggestion && (
                          <div className="px-3 pb-3 space-y-2 bg-muted/20 border-t">
                            <div className="pt-2"><span className="text-xs text-muted-foreground">建议：</span><p className="text-xs mt-1">{issue.suggestion}</p></div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* 卷进度摘要 */}
            {(result.volumeProgressCheck.wordCountIssues.length > 0 || result.volumeProgressCheck.rhythmIssues.length > 0) && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-blue-600 flex items-center gap-1">
                    <Target className="h-3.5 w-3.5" />卷完成度问题
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-[10px] gap-1"
                    disabled={repairing !== null}
                    onClick={() => handleRepair('volume')}
                  >
                    {repairing === 'volume' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                    AI修复
                  </Button>
                </div>
                <div className="p-2.5 border rounded-md bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs">字数健康度 {result.volumeProgressCheck.wordCountScore} · 节奏健康度 {result.volumeProgressCheck.rhythmScore}</span>
                  </div>
                  {result.volumeProgressCheck.diagnosis && (
                    <p className="text-xs text-muted-foreground mt-1">{result.volumeProgressCheck.diagnosis}</p>
                  )}
                  {result.volumeProgressCheck.suggestion && (
                    <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">{result.volumeProgressCheck.suggestion}</p>
                  )}
                </div>
              </div>
            )}

            {/* 无问题提示 */}
            {!result.hasIssues && (
              <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <span className="text-xs text-green-700 dark:text-green-300">恭喜！角色一致性、章节连贯性和卷完成度均未发现问题。</span>
              </div>
            )}

            {/* 修复结果展示 */}
            {repairError && (
              <div className="p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-600 dark:text-red-400">
                修复失败：{repairError}
              </div>
            )}

            {repairedContent && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 p-2 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg">
                  <Check className="h-4 w-4 text-green-600 shrink-0" />
                  <span className="text-xs text-green-700 dark:text-green-300 font-medium">修复完成</span>
                </div>
                <div className="border rounded-lg overflow-hidden">
                  <button
                    onClick={() => setExpandedItem(expandedItem === 'repaired' ? null : 'repaired')}
                    className="w-full flex items-center justify-between p-2 text-left hover:bg-muted/30 transition-colors"
                  >
                    <span className="text-xs font-medium">查看修复后正文</span>
                    {expandedItem === 'repaired' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                  {expandedItem === 'repaired' && (
                    <ScrollArea className="max-h-64 border-t">
                      <div className="p-3 text-xs leading-relaxed whitespace-pre-wrap text-foreground">
                        {repairedContent}
                      </div>
                    </ScrollArea>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
