/**
 * @file CharacterConsistencyCheck.tsx
 * @description 角色一致性检查组件（章节检查模块专用）
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Shield, ShieldAlert, AlertTriangle, CheckCircle, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { StreamRepairOutput } from './StreamRepairOutput'

interface Conflict {
  characterName: string
  conflict: string
  excerpt: string
  dimension?: string
  issue?: string
  suggestion?: string
}

interface CheckResult {
  score: number
  conflicts: Conflict[]
  warnings: string[]
}

interface CharacterConsistencyCheckProps {
  novelId: string
  chapterId: string | null
  onRepairComplete?: () => void
}

export function CharacterConsistencyCheck({ novelId, chapterId, onRepairComplete }: CharacterConsistencyCheckProps) {
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<CheckResult | null>(null)
  const [expandedConflict, setExpandedConflict] = useState<number | null>(null)
  const [repairOutput, setRepairOutput] = useState('')
  const [repairStatus, setRepairStatus] = useState<'idle' | 'repairing' | 'done' | 'error'>('idle')
  const [repairError, setRepairError] = useState<string | null>(null)

  const { data: characters } = useQuery({
    queryKey: ['characters', novelId],
    queryFn: () => api.characters.list(novelId),
    enabled: !!novelId,
  })

  const handleRepair = async () => {
    if (!chapterId || !result || result.conflicts.length === 0) return
    setRepairStatus('repairing')
    setRepairOutput('')
    setRepairError(null)

    try {
      const data = await api.generate.repairChapter({
        chapterId, novelId, repairType: 'character',
        characterConflicts: result.conflicts.map(c => ({
          characterName: c.characterName,
          dimension: c.dimension || '角色一致性',
          issue: c.issue || c.conflict,
          excerpt: c.excerpt,
          suggestion: c.suggestion,
        })),
      })
      if (data.ok && data.repairedContent) {
        setRepairOutput(data.repairedContent)
        setRepairStatus('done')
      } else {
        setRepairError(data.error || '修复失败')
        setRepairStatus('error')
      }
    } catch (error) {
      setRepairError((error as Error).message)
      setRepairStatus('error')
    }
  }

  const handleWrite = async (content: string) => {
    if (!chapterId) return
    await api.chapters.update(chapterId, { content })
    setRepairOutput('')
    setRepairStatus('idle')
    onRepairComplete?.()
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
        <CardTitle className="text-base flex items-center gap-2">
          <Shield className="h-4 w-4" />
          角色一致性检查
        </CardTitle>
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

            {conflictCount > 0 && (
              <ScrollArea className="max-h-48">
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

            {repairStatus === 'idle' && result.conflicts.length > 0 && (
              <div className="pt-2 border-t">
                <button
                  onClick={handleRepair}
                  className="w-full px-4 py-2 text-sm border rounded-md hover:bg-muted/50 transition-colors flex items-center justify-center gap-2"
                >
                  修复角色冲突
                </button>
              </div>
            )}

            {(repairStatus === 'repairing' || repairStatus === 'done' || repairStatus === 'error') && (
              <StreamRepairOutput
                content={repairOutput}
                status={repairStatus}
                error={repairError}
                onWrite={handleWrite}
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}