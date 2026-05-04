/**
 * @file CostBreakdownTable.tsx
 * @description 成本明细表 - 按章节/模型/操作类型展示Token消耗和费用明细
 * @date 2026-05-04
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { CostDetail } from './types'
import { ChevronLeft, ChevronRight, Clock, Coins, FileText } from 'lucide-react'

interface CostBreakdownTableProps {
  novelId: string
}

export function CostBreakdownTable({ novelId }: CostBreakdownTableProps) {
  const [page, setPage] = useState(1)
  const limit = 20

  const { data, isLoading } = useQuery({
    queryKey: ['cost-details', novelId, page],
    queryFn: () => api.costAnalysis.getDetails(novelId, page, limit),
    enabled: !!novelId,
  })

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>消耗明细</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 bg-muted rounded" />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  const records = data?.records || []
  const total = data?.total || 0
  const totalPages = Math.ceil(total / limit)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>消耗明细</CardTitle>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>共 {total} 条记录</span>
          <span>·</span>
          <span>第 {page}/{totalPages || 1} 页</span>
        </div>
      </CardHeader>
      <CardContent>
        {records.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Coins className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">暂无明细数据</p>
          </div>
        ) : (
          <>
            <ScrollArea className="max-h-[400px]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30 sticky top-0">
                    <th className="text-left p-3 font-medium">时间</th>
                    <th className="text-left p-3 font-medium">章节</th>
                    <th className="text-left p-3 font-medium">任务类型</th>
                    <th className="text-left p-3 font-medium">模型</th>
                    <th className="text-right p-3 font-medium">Input Tokens</th>
                    <th className="text-right p-3 font-medium">Output Tokens</th>
                    <th className="text-right p-3 font-medium">成本</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => (
                    <CostRow key={record.id} record={record} />
                  ))}
                </tbody>
              </table>
            </ScrollArea>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-4 pt-4 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>

                <div className="flex gap-1">
                  {getPageNumbers(page, totalPages).map((p) => (
                    <Button
                      key={p}
                      variant={p === page ? 'default' : 'outline'}
                      size="sm"
                      className="w-8 h-8 p-0"
                      onClick={() => setPage(p)}
                    >
                      {p}
                    </Button>
                  ))}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function CostRow({ record }: { record: CostDetail }) {
  const stageLabels: Record<string, string> = {
    chapter_gen: '章节生成',
    summary_gen: '摘要生成',
    foreshadowing_extraction: '伏笔提取',
    power_level_detection: '境界检测',
    semantic_search: '语义检索',
  }

  return (
    <tr className="border-b hover:bg-muted/20 transition-colors">
      <td className="p-3">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Clock className="w-3.5 h-3.5" />
          {formatTime(record.createdAt)}
        </div>
      </td>
      <td className="p-3">
        <div className="flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5 text-muted-foreground" />
          第{record.chapterNumber}章
        </div>
      </td>
      <td className="p-3">
        <Badge variant="secondary" className="text-xs">
          {stageLabels[record.stage] || record.stage}
        </Badge>
      </td>
      <td className="p-3">
        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{record.modelId}</code>
      </td>
      <td className="p-3 text-right font-mono text-xs">
        {formatToken(record.promptTokens)}
      </td>
      <td className="p-3 text-right font-mono text-xs">
        {formatToken(record.completionTokens)}
      </td>
      <td className="p-3 text-right font-semibold text-green-600">
        ${record.cost.toFixed(4)}
      </td>
    </tr>
  )
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp * 1000)
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

function formatToken(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return n.toString()
}

function getPageNumbers(current: number, total: number): number[] {
  const pages: number[] = []
  const maxVisible = 7

  if (total <= maxVisible) {
    for (let i = 1; i <= total; i++) pages.push(i)
  } else {
    pages.push(1)

    if (current > 3) pages.push(-1)

    const start = Math.max(2, current - 1)
    const end = Math.min(total - 1, current + 1)

    for (let i = start; i <= end; i++) {
      if (!pages.includes(i)) pages.push(i)
    }

    if (current < total - 2) pages.push(-1)

    if (!pages.includes(total)) pages.push(total)
  }

  return pages
}
