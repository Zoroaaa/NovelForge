import { Card, CardContent } from '@/components/ui/card'
import type { CostSummary, PeriodType } from './types'
import { DollarSign, Coins, FileText, TrendingUp, AlertTriangle } from 'lucide-react'

interface CostSummaryCardsProps {
  data: CostSummary
  period: PeriodType
}

export function CostSummaryCards({ data, period }: CostSummaryCardsProps) {
  const periodLabels: Record<PeriodType, string> = {
    day: '今日',
    week: '本周',
    month: '本月',
  }

  const cards = [
    {
      title: `总Token消耗`,
      value: formatToken(data.totalTokens),
      icon: <Coins className="w-5 h-5 text-blue-600" />,
      subtitle: `${periodLabels[period]}累计`,
    },
    {
      title: '总成本',
      value: `$${data.totalCost.toFixed(4)}`,
      icon: <DollarSign className="w-5 h-5 text-green-600" />,
      subtitle: `均章 $${data.avgCostPerChapter.toFixed(4)}`,
    },
    {
      title: '生成次数',
      value: data.stageBreakdown.reduce((sum, s) => sum + s.count, 0).toString(),
      icon: <FileText className="w-5 h-5 text-purple-600" />,
      subtitle: `${data.stageBreakdown.length} 种任务类型`,
    },
    {
      title: '使用模型数',
      value: data.modelBreakdown.length.toString(),
      icon: <TrendingUp className="w-5 h-5 text-orange-600" />,
      subtitle: data.modelBreakdown.map(m => m.modelId).join(', ') || '-',
    },
  ]

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card, index) => (
        <Card key={index} className="hover:shadow-md transition-shadow">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-muted-foreground">{card.title}</p>
              {card.icon}
            </div>
            <div className="space-y-1">
              <p className="text-2xl font-bold">{card.value}</p>
              <p className="text-xs text-muted-foreground">{card.subtitle}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function formatToken(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return n.toString()
}
