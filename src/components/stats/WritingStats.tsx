/**
 * @file WritingStats.tsx
 * @description 写作统计面板组件，展示AI生成日志和写作统计信息（Phase 2.4 增强版）
 * @version 2.0.0
 * @modified 2026-04-21 - 添加每日字数趋势、章节耗时分析等高级统计
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { BarChart3, FileText, BookOpen, Clock, TrendingUp, AlertCircle, Calendar, Zap } from 'lucide-react'
import { api } from '@/lib/api'

interface WritingStatsProps {
  novelId?: string
}

export function WritingStats({ novelId }: WritingStatsProps) {
  const { data: logs, isLoading } = useQuery({
    queryKey: ['writing-stats', novelId],
    queryFn: async () => {
      const data = await api.generate.getLogs(novelId, 200)
      return data.logs
    },
  })

  const { data: chapters } = useQuery({
    queryKey: ['stats-chapters', novelId],
    queryFn: async () => {
      const data = await api.chapters.list(novelId!)
      return data
    },
    enabled: !!novelId,
  })

  // Phase 2.4: 计算每日字数趋势
  const dailyWordCount = useMemo(() => {
    if (!chapters?.length) return []

    const dailyMap = new Map<string, number>()
    chapters.forEach((c: any) => {
      const date = new Date(c.createdAt || c.updatedAt).toLocaleDateString('zh-CN')
      const words = (c.content?.length || 0) + (c.title?.length || 0)
      dailyMap.set(date, (dailyMap.get(date) || 0) + words)
    })

    return Array.from(dailyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-14) // 最近14天
  }, [chapters])

  // Phase 2.4: 计算各章生成统计
  const chapterGenerationStats = useMemo(() => {
    if (!logs?.length || !chapters?.length) return []

    return chapters.slice(0, 20).map((chapter: any) => {
      const relatedLogs = logs.filter(
        (l: any) => l.chapterId === chapter.id && l.status === 'success'
      )

      const latestLog = relatedLogs[relatedLogs.length - 1]
      const avgDuration = relatedLogs.length > 0
        ? Math.round(relatedLogs.reduce((s: number, l: any) => s + (l.durationMs || 0), 0) / relatedLogs.length)
        : null

      const totalTokens = relatedLogs.reduce((s: number, l: any) =>
        s + (l.promptTokens || 0) + (l.completionTokens || 0), 0)

      return {
        id: chapter.id,
        title: chapter.title,
        wordCount: (chapter.content?.length || 0),
        generationCount: relatedLogs.length,
        avgDuration,
        totalTokens,
        modelId: latestLog?.modelId || '-',
        lastGenerated: latestLog?.createdAt,
      }
    }).filter((stat: any) => stat.generationCount > 0)
  }, [logs, chapters])

  if (isLoading) {
    return <div className="animate-pulse space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-14 bg-muted rounded" />)}</div>
  }

  const totalLogs = logs?.length || 0
  const successLogs = logs?.filter((l: any) => l.status === 'success') || []
  const errorLogs = logs?.filter((l: any) => l.status === 'error') || []

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
    <div className="space-y-5">
      {/* 基础指标卡片 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <MetricCard label="章节数" value={chapterCount} icon={<BookOpen className="h-4 w-4" />} />
        <MetricCard label="总字数" value={totalWords.toLocaleString()} icon={<FileText className="h-4 w-4" />} />
        <MetricCard label="生成次数" value={totalLogs} icon={<BarChart3 className="h-4 w-4" />} />
        <MetricCard label="成功率" value={`${successRate}%`} icon={<TrendingUp className="h-4 w-4" />} />
        <MetricCard label="总 Tokens" value={formatToken(totalTokens)} icon={<Clock className="h-4 w-4" />} />
        <MetricCard label="平均耗时" value={`${avgDuration}ms`} icon={<Clock className="h-4 w-4" />} />
      </div>

      {/* Phase 2.4: 每日字数趋势 */}
      {dailyWordCount.length > 1 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            每日字数趋势（最近 {dailyWordCount.length} 天）
          </h4>
          <DailyTrendChart data={dailyWordCount} />
        </div>
      )}

      {/* Phase 2.4: 各章生成统计 */}
      {chapterGenerationStats.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Zap className="h-3 w-3" />
            章节生成详情（{chapterGenerationStats.length} 章）
          </h4>
          <ScrollArea className="max-h-[400px] rounded-md border bg-background/50">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">章节</th>
                  <th className="px-3 py-2 text-right font-medium">字数</th>
                  <th className="px-3 py-2 text-right font-medium">生成次数</th>
                  <th className="px-3 py-2 text-right font-medium">平均耗时</th>
                  <th className="px-3 py-2 text-right font-medium">Tokens</th>
                  <th className="px-3 py-2 text-left font-medium">模型</th>
                </tr>
              </thead>
              <tbody>
                {chapterGenerationStats.map((stat: any) => (
                  <tr key={stat.id} className="border-t hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2 font-medium truncate max-w-[120px]" title={stat.title}>
                      {stat.title}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{stat.wordCount.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <Badge variant="outline" className="text-[10px] px-1.5 h-5">
                        {stat.generationCount}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {stat.avgDuration ? `${(stat.avgDuration / 1000).toFixed(1)}s` : '-'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {formatToken(stat.totalTokens)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="secondary" className="text-[10px] font-mono max-w-[80px] truncate block">
                        {stat.modelId}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        </div>
      )}

      {/* 模型分布 */}
      {Object.keys(modelDistribution).length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">模型分布</h4>
          <div className="space-y-1.5">
            {Object.entries(modelDistribution)
              .sort((a, b) => b[1] - a[1])
              .map(([model, count]) => {
                const percentage = ((count / successLogs.length) * 100).toFixed(1)
                return (
                  <div key={model} className="flex items-center justify-between p-2 bg-muted/20 rounded border">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Badge variant="outline" className="text-xs font-mono shrink-0">{model}</Badge>
                      <div className="flex-1 mx-2 h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary transition-all"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0 ml-2">
                      {count} 次 ({percentage}%)
                    </span>
                  </div>
                )
              })}
          </div>
        </div>
      )}

      {/* 错误日志 */}
      {errorLogs.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <AlertCircle className="h-3 w-3 text-destructive" />
            最近失败记录 ({errorLogs.length})
          </h4>
          <ScrollArea className="max-h-40">
            <div className="space-y-1">
              {errorLogs.slice(0, 10).map((l: any) => (
                <div key={l.id} className="flex items-center justify-between p-2 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded text-xs text-red-700 dark:text-red-300">
                  <span className="font-mono truncate max-w-[80px]" title={l.modelId}>{l.modelId}</span>
                  <span className="truncate flex-1 mx-2" title={l.errorMsg}>{l.errorMsg || '未知错误'}</span>
                  <span className="text-muted-foreground shrink-0">{formatTime(l.createdAt)}</span>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  )
}

// ========== Phase 2.4: 每日趋势图表组件 ==========

function DailyTrendChart({ data }: { data: [string, number][] }) {
  if (!data || data.length < 2) return null

  const maxValue = Math.max(...data.map(d => d[1]))
  const minValue = Math.min(...data.map(d => d[1]))
  const range = maxValue - minValue || 1
  const height = 120
  const width = Math.max(data.length * 60, 280)
  const padding = { top: 15, right: 10, bottom: 25, left: 55 }

  // 计算点坐标
  const points = data.map((d, i) => ({
    x: padding.left + (i / (data.length - 1)) * (width - padding.left - padding.right),
    y: padding.top + height - padding.top - padding.bottom - ((d[1] - minValue) / range) * (height - padding.top - padding.bottom),
    date: d[0],
    value: d[1],
  }))

  // 生成路径
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${height - padding.bottom} L ${points[0].x} ${height - padding.bottom} Z`

  return (
    <div className="rounded-lg border bg-background p-3 overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ minHeight: height }}>
        {/* 网格线 */}
        {[0, 0.25, 0.5, 0.75, 1].map(ratio => (
          <line
            key={ratio}
            x1={padding.left}
            y1={padding.top + (height - padding.top - padding.bottom) * (1 - ratio)}
            x2={width - padding.right}
            y2={padding.top + (height - padding.top - padding.bottom) * (1 - ratio)}
            stroke="currentColor"
            strokeWidth="0.5"
            opacity="0.1"
          />
        ))}

        {/* 面积填充 */}
        <path
          d={areaPath}
          fill="url(#gradient)"
          opacity="0.3"
        />

        {/* 折线 */}
        <path
          d={linePath}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-primary"
        />

        {/* 数据点 */}
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="3" fill="currentColor" className="text-primary" />
            {(i === 0 || i === points.length - 1 || p.value === maxValue || p.value === minValue) && (
              <>
                <text x={p.x} y={p.y - 8} textAnchor="middle" fontSize="9" fill="currentColor" opacity="0.7">
                  {formatToken(p.value)}
                </text>
                <text x={p.x} y={height - 5} textAnchor="middle" fontSize="8" fill="currentColor" opacity="0.5" transform={`rotate(-45, ${p.x}, ${height - 5})`}>
                  {p.date.slice(5)}
                </text>
              </>
            )}
          </g>
        ))}

        {/* 渐变定义 */}
        <defs>
          <linearGradient id="gradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.4" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
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
