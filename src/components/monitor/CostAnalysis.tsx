/**
 * @file CostAnalysis.tsx
 * @description 成本分析面板 - 整合成本趋势/明细/汇总的完整分析界面
 * @date 2026-05-04
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { CostSummaryCards } from './CostSummaryCards'
import { CostTrendChart } from './CostTrendChart'
import { CostBreakdownTable } from './CostBreakdownTable'
import type { CostSummary, PeriodType } from './types'
import { DollarSign, TrendingUp, Calendar, Download } from 'lucide-react'

interface CostAnalysisProps {
  novelId: string
}

export function CostAnalysis({ novelId }: CostAnalysisProps) {
  const [period, setPeriod] = useState<PeriodType>('week')

  const { data: costData, isLoading, refetch } = useQuery<CostSummary>({
    queryKey: ['cost-summary', novelId, period],
    queryFn: () => api.costAnalysis.getSummary(novelId, period),
    enabled: !!novelId,
    refetchInterval: 60000,
  })

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-48" />
          <div className="grid grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-32 bg-muted rounded" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (!costData) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <DollarSign className="h-12 w-12 mx-auto mb-3 opacity-30" />
        <p className="text-lg font-medium">暂无成本数据</p>
        <p className="text-sm mt-1">开始生成章节后，这里将显示Token消耗统计</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Select value={period} onValueChange={(v) => setPeriod(v as PeriodType)}>
            <SelectTrigger className="w-[140px]">
              <Calendar className="w-4 h-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="day">今日</SelectItem>
              <SelectItem value="week">本周</SelectItem>
              <SelectItem value="month">本月</SelectItem>
            </SelectContent>
          </Select>

          <Badge variant="secondary" className="text-xs">
            自动刷新中
          </Badge>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <TrendingUp className="w-4 h-4 mr-2" />
            刷新
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleExport(costData)}>
            <Download className="w-4 h-4 mr-2" />
            导出
          </Button>
        </div>
      </div>

      <CostSummaryCards data={costData} period={period} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>消耗趋势</CardTitle>
            <CardDescription>Token使用量与成本变化</CardDescription>
          </CardHeader>
          <CardContent>
            <CostTrendChart data={costData.dailyTrend} period={period} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>模型分布</CardTitle>
            <CardDescription>各模型Token消耗占比</CardDescription>
          </CardHeader>
          <CardContent>
            <ModelBreakdown data={costData.modelBreakdown} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>任务类型分布</CardTitle>
          <CardDescription>按生成阶段统计</CardDescription>
        </CardHeader>
        <CardContent>
          <StageBreakdown data={costData.stageBreakdown} />
        </CardContent>
      </Card>

      <CostBreakdownTable novelId={novelId} />
    </div>
  )
}

function handleExport(data: CostSummary): void {
  const exportData = {
    summary: {
      totalTokens: data.totalTokens,
      totalCost: `$${data.totalCost.toFixed(4)}`,
      avgCostPerChapter: `$${data.avgCostPerChapter.toFixed(4)}`,
    },
    modelBreakdown: data.modelBreakdown,
    dailyTrend: data.dailyTrend,
    stageBreakdown: data.stageBreakdown,
    exportedAt: new Date().toISOString(),
  }

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `cost-analysis-${new Date().toISOString().split('T')[0]}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function ModelBreakdown({ data }: { data: CostSummary['modelBreakdown'] }) {
  if (!data || data.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-8">暂无数据</p>
  }

  const maxPercentage = Math.max(...data.map(d => d.percentage))

  return (
    <div className="space-y-3">
      {data.map((item) => (
        <div key={item.modelId} className="space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium font-mono">{item.modelId}</span>
            <div className="flex gap-3 text-muted-foreground">
              <span>{item.tokens.toLocaleString()} tokens</span>
              <span>${item.cost.toFixed(4)}</span>
              <span>{item.percentage.toFixed(1)}%</span>
            </div>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all duration-500"
              style={{ width: `${(item.percentage / maxPercentage) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

function StageBreakdown({ data }: { data: CostSummary['stageBreakdown'] }) {
  if (!data || data.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-8">暂无数据</p>
  }

  const stageLabels: Record<string, string> = {
    chapter_gen: '章节生成',
    summary_gen: '摘要生成',
    foreshadowing_extraction: '伏笔提取',
    power_level_detection: '境界检测',
    semantic_search: '语义检索',
  }

  const totalTokens = data.reduce((sum, item) => sum + item.tokens, 0)

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
      {data.map((item) => (
        <div key={item.stage} className="p-4 bg-muted/30 rounded-lg border text-center">
          <p className="text-xs text-muted-foreground mb-1">
            {stageLabels[item.stage] || item.stage}
          </p>
          <p className="text-lg font-bold">{formatToken(item.tokens)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {item.count} 次 · {((item.tokens / totalTokens) * 100).toFixed(1)}%
          </p>
        </div>
      ))}
    </div>
  )
}

function formatToken(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return n.toString()
}
