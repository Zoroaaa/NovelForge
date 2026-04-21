/**
 * @file WritingStats.tsx
 * @description 写作统计面板组件，展示AI生成日志和写作统计信息
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { BarChart3, FileText, BookOpen, Clock, TrendingUp, AlertCircle } from 'lucide-react'

interface WritingStatsProps {
  novelId?: string
}

export function WritingStats({ novelId }: WritingStatsProps) {
  const { data: logs, isLoading } = useQuery({
    queryKey: ['writing-stats', novelId],
    queryFn: () =>
      fetch(`/api/generate/logs?novelId=${novelId || ''}&limit=200`).then((r) => r.json()),
  })

  const { data: chapters } = useQuery({
    queryKey: ['stats-chapters', novelId],
    queryFn: () =>
      fetch(`/api/chapters?novelId=${novelId || ''}&includeContent=false`).then((r) => r.json()),
    enabled: !!novelId,
  })

  if (isLoading) {
    return <div className="animate-pulse space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-14 bg-muted rounded" />)}</div>
  }

  const totalLogs = logs?.logs?.length || 0
  const successLogs = logs?.logs?.filter((l: any) => l.status === 'success') || []
  const errorLogs = logs?.logs?.filter((l: any) => l.status === 'error') || []

  const totalPromptTokens = successLogs.reduce((s: number, l: any) => s + (l.promptTokens || 0), 0)
  const totalCompletionTokens = successLogs.reduce((s: number, l: any) => s + (l.completionTokens || 0), 0)
  const totalTokens = totalPromptTokens + totalCompletionTokens

  const avgDuration = successLogs.length > 0
    ? Math.round(successLogs.reduce((s: number, l: any) => s + (l.durationMs || 0), 0) / successLogs.length)
    : 0

  const successRate = totalLogs > 0 ? ((successLogs.length / totalLogs) * 100).toFixed(1) : '0'

  const chapterCount = chapters?.length || 0
  const totalWords = chapters?.reduce((s: any, c: any) => s + ((c.content?.length || 0) + (c.title?.length || 0)), 0) || 0

  const modelDistribution: Record<string, number> = {}
  successLogs.forEach((l: any) => {
    const m = l.modelId || 'unknown'
    modelDistribution[m] = (modelDistribution[m] || 0) + 1
  })

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <MetricCard label="章节数" value={chapterCount} icon={<BookOpen className="h-4 w-4" />} />
        <MetricCard label="总字数" value={totalWords.toLocaleString()} icon={<FileText className="h-4 w-4" />} />
        <MetricCard label="生成次数" value={totalLogs} icon={<BarChart3 className="h-4 w-4" />} />
        <MetricCard label="成功率" value={`${successRate}%`} icon={<TrendingUp className="h-4 w-4" />} />
        <MetricCard label="总 Tokens" value={formatToken(totalTokens)} icon={<Clock className="h-4 w-4" />} />
        <MetricCard label="平均耗时" value={`${avgDuration}ms`} icon={<Clock className="h-4 w-4" />} />
      </div>

      {Object.keys(modelDistribution).length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">模型分布</h4>
          <div className="space-y-1.5">
            {Object.entries(modelDistribution)
              .sort((a, b) => b[1] - a[1])
              .map(([model, count]) => (
                <div key={model} className="flex items-center justify-between p-2 bg-muted/20 rounded border">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs font-mono">{model}</Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">{count} 次</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {errorLogs.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <AlertCircle className="h-3 w-3 text-destructive" />
            最近失败记录
          </h4>
          <ScrollArea className="max-h-40">
            <div className="space-y-1">
              {errorLogs.slice(0, 5).map((l: any) => (
                <div key={l.id} className="flex items-center justify-between p-2 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded text-xs text-red-700 dark:text-red-300">
                  <span className="font-mono">{l.modelId}</span>
                  <span>{l.errorMsg || '未知错误'}</span>
                  <span className="text-muted-foreground">{formatTime(l.createdAt)}</span>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  )
}

function MetricCard({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return (
    <div className="p-3 bg-muted/30 rounded-lg border">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className="text-xl font-bold">{value}</p>
    </div>
  )
}

function formatToken(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return n.toString()
}

function formatTime(ts: number): string {
  const d = new Date(ts * 1000)
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}
