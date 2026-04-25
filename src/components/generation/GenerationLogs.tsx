/**
 * @file GenerationLogs.tsx
 * @description 生成日志面板组件，展示AI生成记录和token消耗统计
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Activity, Clock, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react'

interface GenerationLog {
  id: string
  novelId: string
  chapterId: string | null
  stage: string
  modelId: string
  promptTokens: number | null
  completionTokens: number | null
  durationMs: number | null
  status: 'success' | 'error'
  errorMsg: string | null
  contextSnapshot: string | null
  createdAt: number
}

interface GenerationLogsProps {
  novelId?: string
}

export function GenerationLogs({ novelId }: GenerationLogsProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [limit] = useState(50)

  const { data: logs, isLoading } = useQuery({
    queryKey: ['generation-logs', novelId, limit],
    queryFn: async () => {
      const data = await api.generate.getLogs(novelId, limit)
      return data.logs as GenerationLog[]
    },
  })

  if (isLoading) {
    return <div className="animate-pulse space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-muted rounded" />)}</div>
  }

  if (!logs || logs.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Activity className="h-8 w-8 mx-auto mb-2 opacity-30" />
        <p className="text-sm">暂无生成记录</p>
        <p className="text-xs mt-1">AI 生成章节后会自动记录日志</p>
      </div>
    )
  }

  const totalPromptTokens = logs.filter(l => l.status === 'success').reduce((s, l) => s + (l.promptTokens || 0), 0)
  const totalCompletionTokens = logs.filter(l => l.status === 'success').reduce((s, l) => s + (l.completionTokens || 0), 0)
  const errorCount = logs.filter(l => l.status === 'error').length
  const avgDuration = logs.filter(l => l.durationMs).reduce((s, l) => s + (l.durationMs || 0), 0) / (logs.length - errorCount || 1)

  const stageLabels: Record<string, string> = {
    chapter_gen: '章节生成',
    summary_gen: '摘要生成',
    foreshadowing_extraction: '伏笔提取',
    power_level_detection: '境界检测',
    semantic_search: '语义检索',
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatCard label="总生成次数" value={logs.length} />
        <StatCard label="总 Input Tokens" value={formatToken(totalPromptTokens)} />
        <StatCard label="总 Output Tokens" value={formatToken(totalCompletionTokens)} />
        <StatCard label="平均耗时" value={`${Math.round(avgDuration)}ms`} />
      </div>

      {errorCount > 0 && (
        <div className="flex items-center gap-2 p-2 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded text-xs text-red-700 dark:text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          近 {limit} 条记录中有 {errorCount} 次失败
        </div>
      )}

      <Tabs defaultValue="list">
        <TabsList className="grid w-full grid-cols-2 h-8">
          <TabsTrigger value="list" className="text-xs">记录列表</TabsTrigger>
          <TabsTrigger value="chart" className="text-xs">消耗趋势</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="mt-3">
          <ScrollArea className="max-h-96">
            <div className="space-y-1.5">
              {logs.map((log) => (
                <div key={log.id} className="border rounded-md overflow-hidden">
                  <button
                    onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                    className="w-full flex items-center justify-between p-3 text-left hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <Badge
                        variant={log.status === 'success' ? 'default' : 'destructive'}
                        className="text-xs shrink-0"
                      >
                        {log.status === 'success' ? '成功' : '失败'}
                      </Badge>
                      <span className="text-xs font-medium truncate">
                        {stageLabels[log.stage] || log.stage}
                      </span>
                      <span className="text-xs text-muted-foreground hidden sm:inline">
                        {log.modelId}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs text-muted-foreground">
                        {log.promptTokens ? `↓${formatToken(log.promptTokens)} ↑${formatToken(log.completionTokens || 0)}` : '-'}
                      </span>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {log.durationMs ? `${Math.round(log.durationMs)}ms` : '-'}
                      </span>
                      {expandedId === log.id ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </div>
                  </button>

                  {expandedId === log.id && (
                    <div className="px-3 pb-3 text-xs space-y-2 bg-muted/20 border-t">
                      <div className="grid grid-cols-2 gap-2 pt-2">
                        <div>
                          <span className="text-muted-foreground">章节ID：</span>
                          <span className="font-mono">{log.chapterId || '-'}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">时间：</span>
                          {formatTime(log.createdAt)}
                        </div>
                        <div>
                          <span className="text-muted-foreground">Input Tokens：</span>
                          {log.promptTokens?.toLocaleString() || '-'}
                        </div>
                        <div>
                          <span className="text-muted-foreground">Output Tokens：</span>
                          {log.completionTokens?.toLocaleString() || '-'}
                        </div>
                        <div>
                          <span className="text-muted-foreground">模型：</span>
                          <span className="font-mono">{log.modelId}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">耗时：</span>
                          {log.durationMs ? `${Math.round(log.durationMs)}ms` : '-'}
                        </div>
                      </div>
                      {log.contextSnapshot && (
                        <div className="pt-2 border-t">
                          <div className="text-muted-foreground mb-1">详细信息：</div>
                          <pre className="p-2 bg-background rounded border text-[11px] font-mono whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                            {(() => {
                              try {
                                const parsed = JSON.parse(log.contextSnapshot)
                                return JSON.stringify(parsed, null, 2)
                              } catch {
                                return log.contextSnapshot
                              }
                            })()}
                          </pre>
                        </div>
                      )}
                      {log.errorMsg && (
                        <div className="p-2 bg-red-50 dark:bg-red-950 rounded border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300">
                          <span className="text-muted-foreground">错误：</span>
                          {log.errorMsg}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="chart" className="mt-3">
          <TokenChart logs={logs} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="p-3 bg-muted/30 rounded-lg border text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold mt-1">{value}</p>
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

function TokenChart({ logs }: { logs: GenerationLog[] }) {
  const successLogs = logs.filter(l => l.status === 'success' && l.promptTokens).slice(0, 20).reverse()

  if (successLogs.length < 2) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        至少需要 2 条成功记录才能展示趋势
      </div>
    )
  }

  const maxTokens = Math.max(...successLogs.map(l => (l.promptTokens || 0) + (l.completionTokens || 0)))
  const width = 500
  const height = 200
  const padding = { top: 20, right: 20, bottom: 30, left: 50 }
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom

  const points = successLogs.map((log, i) => {
    const x = padding.left + (i / (successLogs.length - 1)) * chartWidth
    const total = (log.promptTokens || 0) + (log.completionTokens || 0)
    const y = padding.top + chartHeight - (total / maxTokens) * chartHeight
    return { x, y, log }
  })

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} className="mx-auto" viewBox={`0 0 ${width} ${height}`}>
        {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
          const y = padding.top + chartHeight * (1 - pct)
          return (
            <g key={pct}>
              <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="currentColor" strokeOpacity="0.1" />
              <text x={padding.left - 5} y={y + 4} textAnchor="end" className="text-xs fill-muted-foreground" fontSize="10">
                {formatToken(maxTokens * pct)}
              </text>
            </g>
          )
        })}

        <path d={pathD} fill="none" stroke="hsl(var(--primary))" strokeWidth="2" />

        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="3" fill="hsl(var(--primary))" />
            <text x={p.x} y={height - 5} textAnchor="middle" className="fill-muted-foreground" fontSize="8">
              {i + 1}
            </text>
          </g>
        ))}

        <text x={width / 2} y={height - 2} textAnchor="middle" className="fill-muted-foreground" fontSize="10">
          最近 {successLogs.length} 次生成（总 tokens）
        </text>
      </svg>
    </div>
  )
}
