/**
 * @file CombinedCheck.tsx
 * @description 组合检查组件，同时执行角色一致性检查和章节连贯性检查
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Shield,
  Link,
  ShieldAlert,
  AlertTriangle,
  CheckCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { api } from '@/lib/api'
import { getToken } from '@/lib/api'

interface Conflict {
  characterName: string
  conflict: string
  excerpt: string
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
    conflicts: Conflict[]
    warnings: string[]
  }
  coherenceCheck: {
    score: number
    issues: CoherenceIssue[]
  }
  hasIssues: boolean
}

interface CombinedCheckProps {
  chapterId: string
  novelId: string
  onCheckComplete?: (result: CombinedCheckResult) => void
}

export function CombinedCheck({
  chapterId,
  novelId,
  onCheckComplete,
}: CombinedCheckProps) {
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<CombinedCheckResult | null>(null)
  const [expandedItem, setExpandedItem] = useState<string | null>(null)

  const { data: characters } = useQuery({
    queryKey: ['characters', novelId],
    queryFn: () => api.characters.list(novelId),
    enabled: !!novelId,
  })

  const handleCheck = async () => {
    setChecking(true)
    setResult(null)

    try {
      const token = getToken()
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res = await fetch('/api/generate/combined-check', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          chapterId,
          novelId,
          characterIds: characters?.map(c => c.id) || [],
        }),
      })

      if (!res.ok) throw new Error('检查请求失败')

      const data = await res.json()
      setResult(data)
      onCheckComplete?.(data)
    } catch (error) {
      setResult({
        score: 0,
        characterCheck: { conflicts: [], warnings: [`检查失败: ${(error as Error).message}`] },
        coherenceCheck: { score: 0, issues: [] },
        hasIssues: true,
      })
    } finally {
      setChecking(false)
    }
  }

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600'
    if (score >= 60) return 'text-amber-600'
    return 'text-red-600'
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground uppercase tracking-wider">
          <Shield className="h-3.5 w-3.5" />
          <Link className="h-3.5 w-3.5 -ml-1" />
          综合质量检查
        </h4>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 h-7 text-xs"
          onClick={handleCheck}
          disabled={checking}
        >
          {checking ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              检查中...
            </>
          ) : (
            <>
              <Shield className="h-3 w-3" />
              <Link className="h-3 w-3" />
              开始检查
            </>
          )}
        </Button>
      </div>

      {result && (
        <div className="space-y-3">
          {/* 综合评分 */}
          <div className="flex items-center gap-2 flex-wrap p-3 bg-muted/30 rounded-lg border">
            <div className="flex items-baseline gap-1">
              <span className="text-xs text-muted-foreground">综合评分:</span>
              <span className={`text-lg font-bold ${getScoreColor(result.score)}`}>
                {result.score}/100
              </span>
            </div>

            <div className="flex items-center gap-2 ml-auto">
              {/* 角色一致性评分 */}
              <Badge variant="outline" className="gap-1 text-xs">
                <Shield className="h-3 w-3" />
                角色:
                <span className={getScoreColor(
                  result.characterCheck.conflicts.length > 0
                    ? Math.max(0, 100 - result.characterCheck.conflicts.length * 20)
                    : 100
                )}>
                  {result.characterCheck.conflicts.length > 0
                    ? Math.max(0, 100 - result.characterCheck.conflicts.length * 20)
                    : 100}
                </span>
              </Badge>

              {/* 连贯性评分 */}
              <Badge variant="outline" className="gap-1 text-xs">
                <Link className="h-3 w-3" />
                连贯:
                <span className={getScoreColor(result.coherenceCheck.score)}>
                  {result.coherenceCheck.score}
                </span>
              </Badge>
            </div>
          </div>

          {/* 角色冲突列表 */}
          {result.characterCheck.conflicts.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-destructive flex items-center gap-1">
                <ShieldAlert className="h-3.5 w-3.5" />
                角色冲突 ({result.characterCheck.conflicts.length})
              </p>
              <ScrollArea className="max-h-48">
                <div className="space-y-1">
                  {result.characterCheck.conflicts.map((conflict, i) => (
                    <div key={`char-${i}`} className="border rounded-md overflow-hidden">
                      <button
                        onClick={() =>
                          setExpandedItem(expandedItem === `char-${i}` ? null : `char-${i}`)
                        }
                        className="w-full flex items-center justify-between p-2 text-left hover:bg-muted/30 transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <ShieldAlert className="h-4 w-4 text-destructive shrink-0" />
                          <span className="text-xs font-medium truncate">{conflict.characterName}</span>
                        </div>
                        {expandedItem === `char-${i}` ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </button>
                      {expandedItem === `char-${i}` && (
                        <div className="px-3 pb-3 space-y-2 bg-muted/20 border-t">
                          <div className="pt-2">
                            <span className="text-xs text-muted-foreground">冲突：</span>
                            <p className="text-xs mt-1">{conflict.conflict}</p>
                          </div>
                          {conflict.excerpt && (
                            <div className="p-2 bg-background rounded border text-xs text-muted-foreground italic">
                              "{conflict.excerpt}"
                            </div>
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
              {result.characterCheck.warnings
                .filter(w => !w.includes('失败'))
                .map((w, i) => (
                  <div
                    key={`char-warn-${i}`}
                    className="flex items-start gap-2 p-2 bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded text-xs text-yellow-700 dark:text-yellow-300"
                  >
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{w}</span>
                  </div>
                ))}
            </div>
          )}

          {/* 连贯性问题列表 */}
          {result.coherenceCheck.issues.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-amber-600 flex items-center gap-1">
                <Link className="h-3.5 w-3.5" />
                连贯性问题 ({result.coherenceCheck.issues.length})
              </p>
              <ScrollArea className="max-h-48">
                <div className="space-y-1">
                  {result.coherenceCheck.issues.map((issue, i) => (
                    <div
                      key={`coh-${i}`}
                      className={`border rounded-md overflow-hidden ${
                        issue.severity === 'error'
                          ? 'border-red-200 dark:border-red-800'
                          : 'border-amber-200 dark:border-amber-800'
                      }`}
                    >
                      <button
                        onClick={() =>
                          setExpandedItem(expandedItem === `coh-${i}` ? null : `coh-${i}`)
                        }
                        className="w-full flex items-center justify-between p-2 text-left hover:bg-muted/30 transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <AlertTriangle
                            className={`h-4 w-4 shrink-0 ${
                              issue.severity === 'error' ? 'text-destructive' : 'text-yellow-600'
                            }`}
                          />
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
                            {issue.category || '其他'}
                          </Badge>
                          {expandedItem === `coh-${i}` ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </div>
                      </button>
                      {expandedItem === `coh-${i}` && issue.suggestion && (
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
            </div>
          )}

          {/* 无问题提示 */}
          {!result.hasIssues && (
            <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <span className="text-xs text-green-700 dark:text-green-300">
                恭喜！角色一致性和章节连贯性均未发现问题。
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
