/**
 * @file ChapterCoherenceCheck.tsx
 * @description 章节连贯性检查组件（章节检查模块专用）
 */
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Link,
  AlertTriangle,
  CheckCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  BookOpen,
  Zap,
} from 'lucide-react'
import { api } from '@/lib/api'

interface CoherenceIssue {
  severity: 'error' | 'warning'
  category?: string
  message: string
  suggestion?: string
}

interface CoherenceCheckResult {
  score: number
  issues: CoherenceIssue[]
}

interface ChapterCoherenceCheckProps {
  novelId: string
  chapterId: string | null
  onCheckComplete?: (result: CoherenceCheckResult) => void
}

export function ChapterCoherenceCheck({ novelId, chapterId, onCheckComplete }: ChapterCoherenceCheckProps) {
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<CoherenceCheckResult | null>(null)
  const [expandedIssue, setExpandedIssue] = useState<number | null>(null)

  const handleCheck = async () => {
    if (!chapterId) return
    setChecking(true)
    setResult(null)

    try {
      const data = await api.generate.checkCoherence({ chapterId, novelId })
      const checkResult: CoherenceCheckResult = {
        score: data.score ?? 100,
        issues: data.issues ?? [],
      }
      setResult(checkResult)
      onCheckComplete?.(checkResult)
    } catch (error) {
      console.error('连贯性检查失败:', error)
      setResult({ score: 0, issues: [{ severity: 'error', message: `检查失败: ${(error as Error).message}` }] })
    } finally {
      setChecking(false)
    }
  }

  const issueCount = result?.issues.length || 0
  const errorCount = result?.issues.filter(i => i.severity === 'error').length || 0
  const warningCount = result?.issues.filter(i => i.severity === 'warning').length || 0

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600'
    if (score >= 60) return 'text-amber-600'
    return 'text-red-600'
  }

  const getCategoryIcon = (category?: string) => {
    switch (category) {
      case 'continuity':
        return <Link className="h-4 w-4" />
      case 'foreshadowing':
        return <BookOpen className="h-4 w-4" />
      case 'power_level':
        return <Zap className="h-4 w-4" />
      default:
        return <AlertTriangle className="h-4 w-4" />
    }
  }

  const getCategoryLabel = (category?: string) => {
    switch (category) {
      case 'continuity':
        return '情节衔接'
      case 'foreshadowing':
        return '伏笔检查'
      case 'power_level':
        return '境界设定'
      default:
        return '其他'
    }
  }

  if (!chapterId) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground text-sm">
            请先选择一个章节
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Link className="h-4 w-4" />
          章节连贯性检查
        </CardTitle>
      </CardHeader>

      <CardContent>
        {!result && !checking && (
          <div className="text-center py-6 text-muted-foreground text-sm">
            检测章节内容的连贯性（情节逻辑、时间线、前后文衔接等）
          </div>
        )}

        {checking && (
          <div className="flex items-center justify-center py-6 gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在分析章节连贯性...
          </div>
        )}

        {result && !checking && (
          <div className="space-y-3">
            {/* 结果概览 */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-baseline gap-1">
                <span className="text-xs text-muted-foreground">评分:</span>
                <span className={`text-sm font-bold ${getScoreColor(result.score)}`}>
                  {result.score}/100
                </span>
              </div>

              {errorCount > 0 && (
                <Badge variant="destructive" className="gap-1 text-xs">
                  <AlertTriangle className="h-3 w-3" />
                  {errorCount} 个错误
                </Badge>
              )}
              {warningCount > 0 && (
                <Badge variant="outline" className="gap-1 text-xs text-yellow-600 border-yellow-300">
                  <AlertTriangle className="h-3 w-3" />
                  {warningCount} 个警告
                </Badge>
              )}
              {issueCount === 0 && (
                <Badge variant="default" className="gap-1 text-xs bg-green-600">
                  <CheckCircle className="h-3 w-3" />
                  无问题
                </Badge>
              )}
            </div>

            {/* 问题列表 */}
            {issueCount > 0 && (
              <ScrollArea className="max-h-64">
                <div className="space-y-1.5">
                  {result.issues.map((issue, i) => (
                    <div
                      key={i}
                      className={`border rounded-md overflow-hidden ${
                        issue.severity === 'error'
                          ? 'border-red-200 dark:border-red-800'
                          : 'border-amber-200 dark:border-amber-800'
                      }`}
                    >
                      <button
                        onClick={() => setExpandedIssue(expandedIssue === i ? null : i)}
                        className="w-full flex items-center justify-between p-2.5 text-left hover:bg-muted/30 transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          {getCategoryIcon(issue.category)}
                          <span className="text-xs font-medium truncate">{issue.message}</span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-1.5 py-0 ${
                              issue.severity === 'error'
                                ? 'text-red-600 border-red-300'
                                : 'text-yellow-600 border-yellow-300'
                            }`}
                          >
                            {getCategoryLabel(issue.category)}
                          </Badge>
                          {expandedIssue === i ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </div>
                      </button>

                      {expandedIssue === i && issue.suggestion && (
                        <div className="px-3 pb-3 space-y-2 bg-muted/20 border-t">
                          <div className="pt-2">
                            <span className="text-xs text-muted-foreground">建议：</span>
                            <p className="text-xs mt-1">{issue.suggestion}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
