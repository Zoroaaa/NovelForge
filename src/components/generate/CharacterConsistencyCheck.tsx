/**
 * @file CharacterConsistencyCheck.tsx
 * @description 角色一致性检查组件，检测章节内容中的角色设定冲突
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Shield, ShieldAlert, AlertTriangle, CheckCircle, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { api } from '@/lib/api'
import type { Character } from '@/lib/types'

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
  chapterId: string
  novelId: string
}

export function CharacterConsistencyCheck({ chapterId, novelId }: CharacterConsistencyCheckProps) {
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<CheckResult | null>(null)
  const [expandedConflict, setExpandedConflict] = useState<number | null>(null)

  const { data: characters } = useQuery({
    queryKey: ['characters', novelId],
    queryFn: () => api.characters.list(novelId),
    enabled: !!novelId,
  })

  const handleCheck = async () => {
    setChecking(true)
    setResult(null)

    try {
      const resp = await fetch('/api/generate/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chapterId,
          characterIds: characters?.map(c => c.id) || [],
        }),
      })

      if (!resp.ok) {
        throw new Error('检查失败')
      }

      const data = await resp.json()
      setResult(data)
    } catch (error) {
      setResult({ conflicts: [], warnings: [`检查失败: ${(error as Error).message}`] })
    } finally {
      setChecking(false)
    }
  }

  const conflictCount = result?.conflicts.length || 0
  const warningCount = result?.warnings.length || 0

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground uppercase tracking-wider">
          <Shield className="h-3.5 w-3.5" />
          角色一致性检查
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
              开始检查
            </>
          )}
        </Button>
      </div>

      {result && (
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
    </div>
  )
}
