/**
 * @file CharacterConsistencyCheck.tsx
 * @description 角色一致性检查组件（章节检查模块专用）
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Shield, ShieldAlert, AlertTriangle, CheckCircle, Loader2, ChevronDown, ChevronUp } from 'lucide-react'

interface Conflict {
  characterName: string
  conflict: string
  excerpt: string
}

interface CheckResult {
  conflicts: Conflict[]
  warnings: string[]
}

interface CharacterConsistencyCheckProps {
  novelId: string
  chapterId: string | null
}

export function CharacterConsistencyCheck({ novelId, chapterId }: CharacterConsistencyCheckProps) {
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<CheckResult | null>(null)
  const [expandedConflict, setExpandedConflict] = useState<number | null>(null)

  const { data: characters } = useQuery({
    queryKey: ['characters', novelId],
    queryFn: () => api.characters.list(novelId),
    enabled: !!novelId,
  })

  const handleCheck = async () => {
    if (!chapterId) return
    setChecking(true)
    setResult(null)

    try {
      const data = await api.generate.checkCharacterConsistency({
        chapterId,
        characterIds: characters?.map(c => c.id) || [],
      })
      setResult(data)
    } catch (error) {
      console.error('角色一致性检查失败:', error)
      setResult({ conflicts: [], warnings: [`检查失败: ${(error as Error).message}`] })
    } finally {
      setChecking(false)
    }
  }

  const conflictCount = result?.conflicts.length || 0
  const warningCount = result?.warnings.length || 0

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
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4" />
            角色一致性检查
          </CardTitle>
          <Button size="sm" variant="outline" onClick={handleCheck} disabled={checking}>
            {checking ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />检查中...</> : '开始检查'}
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {!result && !checking && (
          <div className="text-center py-6 text-muted-foreground text-sm">
            检测章节中角色的设定是否与角色库一致（姓名、境界、能力、性格等）
          </div>
        )}

        {checking && (
          <div className="flex items-center justify-center py-6 gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在分析角色一致性...
          </div>
        )}

        {result && !checking && (
          <div className="space-y-2">
            {/* 结果概览 */}
            <div className="flex items-center gap-2">
              {conflictCount > 0 ? (
                <Badge variant="destructive" className="gap-1 text-xs">
                  <ShieldAlert className="h-3 w-3" />
                  {conflictCount} 个冲突
                </Badge>
              ) : (
                <Badge variant="default" className="gap-1 text-xs bg-green-600">
                  <CheckCircle className="h-3 w-3" />
                  无冲突
                </Badge>
              )}
              {warningCount > 0 && (
                <Badge variant="outline" className="gap-1 text-xs text-yellow-600 border-yellow-300">
                  <AlertTriangle className="h-3 w-3" />
                  {warningCount} 个警告
                </Badge>
              )}
            </div>

            {/* 冲突列表 */}
            {conflictCount > 0 && (
              <ScrollArea className="max-h-64">
                <div className="space-y-1.5">
                  {result.conflicts.map((c, i) => (
                    <div key={i} className="border rounded-md overflow-hidden">
                      <button
                        onClick={() => setExpandedConflict(expandedConflict === i ? null : i)}
                        className="w-full flex items-center justify-between p-2.5 text-left hover:bg-muted/30 transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <ShieldAlert className="h-4 w-4 text-destructive shrink-0" />
                          <span className="text-xs font-medium truncate">{c.characterName}</span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {expandedConflict === i ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </div>
                      </button>

                      {expandedConflict === i && (
                        <div className="px-3 pb-3 space-y-2 bg-muted/20 border-t">
                          <div className="pt-2">
                            <span className="text-xs text-muted-foreground">冲突：</span>
                            <p className="text-xs mt-1">{c.conflict}</p>
                          </div>
                          {c.excerpt && (
                            <div className="p-2 bg-background rounded border text-xs text-muted-foreground italic">
                              "{c.excerpt}"
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}

            {/* 警告列表 */}
            {warningCount > 0 && (
              <div className="space-y-1">
                {result.warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2 p-2 bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded text-xs text-yellow-700 dark:text-yellow-300">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
