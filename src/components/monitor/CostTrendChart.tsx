/**
 * @file CostTrendChart.tsx
 * @description 成本趋势图 - 用面积图展示每日/每周/每月的API调用成本变化
 * @date 2026-05-04
 */
import type { CostSummary, PeriodType } from './types'

interface CostTrendChartProps {
  data: CostSummary['dailyTrend']
  period: PeriodType
}

export function CostTrendChart({ data, period }: CostTrendChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-sm">暂无趋势数据</p>
      </div>
    )
  }

  const sortedData = [...data].reverse()
  const maxCost = Math.max(...sortedData.map(d => d.cost), 0.01)
  const maxTokens = Math.max(...sortedData.map(d => d.inputTokens + d.outputTokens), 1)

  const width = 600
  const height = 280
  const padding = { top: 30, right: 20, bottom: 50, left: 60 }
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom

  const costPoints = sortedData.map((d, i) => {
    const x = padding.left + (i / (sortedData.length - 1 || 1)) * chartWidth
    const y = padding.top + chartHeight - (d.cost / maxCost) * chartHeight
    return { x, y, d }
  })

  const tokenPoints = sortedData.map((d, i) => {
    const x = padding.left + (i / (sortedData.length - 1 || 1)) * chartWidth
    const total = d.inputTokens + d.outputTokens
    const y = padding.top + chartHeight - (total / maxTokens) * chartHeight
    return { x, y, d }
  })

  const costPathD = costPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  const tokenPathD = tokenPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')

  const formatDate = (dateStr: string): string => {
    if (period === 'day') {
      const [month, day] = dateStr.split('-').slice(1)
      return `${parseInt(month)}/${parseInt(day)}`
    }
    return dateStr.slice(5)
  }

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} className="mx-auto" viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="tokenGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
          const y = padding.top + chartHeight * (1 - pct)
          return (
            <g key={pct}>
              <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="currentColor" strokeOpacity="0.08" strokeWidth="1" />
              <text x={padding.left - 8} y={y + 4} textAnchor="end" className="text-xs fill-muted-foreground" fontSize="9">
                {`$${(maxCost * pct).toFixed(3)}`}
              </text>
            </g>
          )
        })}

        {costPoints.length > 1 && (
          <>
            <path
              d={`${costPathD} L ${costPoints[costPoints.length - 1].x} ${padding.top + chartHeight} L ${costPoints[0].x} ${padding.top + chartHeight} Z`}
              fill="url(#costGradient)"
            />
            <path d={costPathD} fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </>
        )}

        {tokenPoints.length > 1 && (
          <>
            <path
              d={`${tokenPathD} L ${tokenPoints[tokenPoints.length - 1].x} ${padding.top + chartHeight} L ${tokenPoints[0].x} ${padding.top + chartHeight} Z`}
              fill="url(#tokenGradient)"
            />
            <path d={tokenPathD} fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4 2" />
          </>
        )}

        {sortedData.map((d, i) => {
          const x = padding.left + (i / (sortedData.length - 1 || 1)) * chartWidth
          return (
            <g key={i}>
              <circle cx={x} cy={costPoints[i]?.y || 0} r="3.5" fill="#10b981" stroke="white" strokeWidth="1.5" />
              <circle cx={x} cy={tokenPoints[i]?.y || 0} r="3.5" fill="#3b82f6" stroke="white" strokeWidth="1.5" />

              {sortedData.length <= 15 && (
                <text x={x} y={height - 8} textAnchor="middle" className="fill-muted-foreground" fontSize="8" transform={`rotate(-45, ${x}, ${height - 8})`}>
                  {formatDate(d.date)}
                </text>
              )}
            </g>
          )
        })}

        <line x1={padding.left} y1={padding.top} x2={padding.left} y2={height - padding.bottom} stroke="currentColor" strokeOpacity="0.2" strokeWidth="1" />
        <line x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} stroke="currentColor" strokeOpacity="0.2" strokeWidth="1" />

        <rect x={width - 150} y={10} width="140" height="50" fill="white" fillOpacity="0.9" rx="4" stroke="#e5e7eb" strokeWidth="1" />
        <line x1={width - 140} y1={25} x2={width - 120} y2={25} stroke="#10b981" strokeWidth="2.5" />
        <text x={width - 115} y={28} className="fill-gray-700" fontSize="10">成本 ($)</text>
        <line x1={width - 140} y1="45" x2={width - 120} y2="45" stroke="#3b82f6" strokeWidth="2.5" strokeDasharray="4 2" />
        <text x={width - 115} y="48" className="fill-gray-700" fontSize="10">Token量</text>

        <text x={width / 2} y={height - 3} textAnchor="middle" className="fill-muted-foreground" fontSize="9">
          日期
        </text>
      </svg>

      <div className="flex justify-center gap-6 mt-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 bg-green-500 inline-block" />
          成本趋势
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 bg-blue-500 border-dashed border-t-2 border-blue-500 inline-block" />
          Token总量
        </span>
      </div>
    </div>
  )
}
