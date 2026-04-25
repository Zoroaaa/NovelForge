/**
 * @file VolumeProgressCheck.tsx
 * @description 卷完成程度检查组件
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { VolumeProgressResult } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Loader2, AlertTriangle, CheckCircle, TrendingUp, Clock, Target } from 'lucide-react'

interface VolumeProgressCheckProps {
  novelId: string
  chapterId: string | null
}

const healthStatusConfig: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  healthy: { label: '进度正常', color: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300', icon: <CheckCircle className="h-4 w-4" /> },
  ahead: { label: '进度稍快', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300', icon: <TrendingUp className="h-4 w-4" /> },
  behind: { label: '进度偏慢', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300', icon: <Clock className="h-4 w-4" /> },
  critical: { label: '严重偏离', color: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300', icon: <AlertTriangle className="h-4 w-4" /> },
}

export function VolumeProgressCheck({ novelId, chapterId }: VolumeProgressCheckProps) {
  const queryClient = useQueryClient()
  const [result, setResult] = useState<VolumeProgressResult | null>(null)

  const checkMutation = useMutation({
    mutationFn: () => api.generate.checkVolumeProgress({ chapterId: chapterId!, novelId }),
    onSuccess: (data) => {
      setResult(data)
      queryClient.invalidateQueries({ queryKey: ['check-logs'] })
      toast.success('卷完成度检查完成')
    },
    onError: (err) => toast.error(`检查失败: ${(err as Error).message}`),
  })

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
            <Target className="h-4 w-4" />
            卷完成程度检查
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => checkMutation.mutate()}
            disabled={checkMutation.isPending}
          >
            {checkMutation.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                检查中...
              </>
            ) : (
              '开始检查'
            )}
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {!result && !checkMutation.isPending && (
          <div className="text-center py-6 text-muted-foreground text-sm">
            点击"开始检查"评估当前卷的进度是否健康
          </div>
        )}

        {checkMutation.isPending && (
          <div className="flex items-center justify-center py-6 gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在分析卷的完成程度...
          </div>
        )}

        {result && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatItem label="当前章节" value={`第 ${result.currentChapter} 章`} />
              <StatItem label="目标章节" value={result.targetChapter ? `${result.targetChapter} 章` : '未设定'} />
              <StatItem label="当前字数" value={`${(result.currentWordCount / 10000).toFixed(1)} 万字`} />
              <StatItem label="目标字数" value={result.targetWordCount ? `${(result.targetWordCount / 10000).toFixed(0)} 万字` : '未设定'} />
            </div>

            {(result.targetChapter || result.targetWordCount) && (
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-muted/50 rounded-lg">
                  <div className="text-xs text-muted-foreground mb-1">章节进度</div>
                  <div className="text-lg font-semibold">{result.chapterProgress.toFixed(1)}%</div>
                  <div className="mt-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${Math.min(result.chapterProgress, 100)}%` }}
                    />
                  </div>
                </div>
                <div className="p-3 bg-muted/50 rounded-lg">
                  <div className="text-xs text-muted-foreground mb-1">字数进度</div>
                  <div className="text-lg font-semibold">{result.wordProgress.toFixed(1)}%</div>
                  <div className="mt-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${Math.min(result.wordProgress, 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between p-3 rounded-lg border">
              <span className="text-sm font-medium">健康状态</span>
              <Badge className={healthStatusConfig[result.healthStatus]?.color || ''}>
                {healthStatusConfig[result.healthStatus]?.icon}
                <span className="ml-1">{healthStatusConfig[result.healthStatus]?.label}</span>
              </Badge>
            </div>

            {result.risk && (
              <div className="p-3 rounded-lg border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                      风险提示：{result.risk === 'early_ending' ? '可能提前收尾' : '可能延期收尾'}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {result.suggestion && (
              <ScrollArea className="max-h-32">
                <div className="p-3 rounded-lg bg-muted/30 text-sm leading-relaxed">
                  <div className="text-xs text-muted-foreground mb-1">AI 建议：</div>
                  {result.suggestion}
                </div>
              </ScrollArea>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-2.5 bg-muted/30 rounded-lg text-center">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-sm font-medium mt-0.5 tabular-nums">{value}</div>
    </div>
  )
}
