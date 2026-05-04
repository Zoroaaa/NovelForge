/**
 * @file QualityChart.tsx
 * @description 质量评分趋势图 - 用折线图展示各章节质量分数变化趋势
 * @date 2026-05-04
 */
import type { QualityChapterData } from './types'

interface QualityChartProps {
  chapters: QualityChapterData[]
}

export function QualityChart({ chapters }: QualityChartProps) {
  const validChapters = chapters
    .filter(ch => ch.coherenceScore !== null || ch.characterScore !== null || ch.progressScore !== null)
    .sort((a, b) => a.chapterNumber - b.chapterNumber)

  if (validChapters.length < 2) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-sm">至少需要2章有质量数据才能显示趋势</p>
      </div>
    )
  }

  const width = 700
  const height = 300
  const padding = { top: 30, right: 30, bottom: 50, left: 50 }
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom

  const generatePath = (key: 'coherenceScore' | 'characterScore' | 'progressScore') => {
    return validChapters.map((ch, i) => {
      const x = padding.left + (i / (validChapters.length - 1)) * chartWidth
      const value = ch[key] ?? 0
      const y = padding.top + chartHeight - (value / 100) * chartHeight
      return { x, y, ch }
    })
  }

  const coherencePoints = generatePath('coherenceScore')
  const characterPoints = generatePath('characterScore')
  const progressPoints = generatePath('progressScore')

  const toPathD = (points: typeof coherencePoints) =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} className="mx-auto" viewBox={`0 0 ${width} ${height}`}>
        {/* 网格线 */}
        {[0, 20, 40, 60, 80, 100].map((score) => {
          const y = padding.top + chartHeight - (score / 100) * chartHeight
          return (
            <g key={score}>
              <line
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
                stroke="currentColor"
                strokeOpacity="0.08"
                strokeWidth="1"
              />
              <text
                x={padding.left - 8}
                y={y + 4}
                textAnchor="end"
                className="text-xs fill-muted-foreground"
                fontSize="9"
              >
                {score}
              </text>
            </g>
          )
        })}

        {/* 连贯性曲线 */}
        <path
          d={toPathD(coherencePoints)}
          fill="none"
          stroke="#3b82f6"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {coherencePoints.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="4" fill="#3b82f6" stroke="white" strokeWidth="2" />
        ))}

        {/* 角色一致性曲线 */}
        <path
          d={toPathD(characterPoints)}
          fill="none"
          stroke="#8b5cf6"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="6 3"
        />
        {characterPoints.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="4" fill="#8b5cf6" stroke="white" strokeWidth="2" />
        ))}

        {/* 进度符合度曲线 */}
        <path
          d={toPathD(progressPoints)}
          fill="none"
          stroke="#10b981"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="3 3"
        />
        {progressPoints.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="4" fill="#10b981" stroke="white" strokeWidth="2" />
        ))}

        {/* X轴标签 */}
        {validChapters.map((ch, i) => {
          const x = padding.left + (i / (validChapters.length - 1)) * chartWidth
          return (
            <g key={ch.id}>
              <line
                x1={x}
                y1={height - padding.bottom}
                x2={x}
                y2={height - padding.bottom + 5}
                stroke="currentColor"
                strokeOpacity="0.3"
                strokeWidth="1"
              />
              <text
                x={x}
                y={height - 8}
                textAnchor="middle"
                className="fill-muted-foreground"
                fontSize="9"
              >
                第{ch.chapterNumber}章
              </text>
            </g>
          )
        })}

        {/* 坐标轴 */}
        <line
          x1={padding.left}
          y1={padding.top}
          x2={padding.left}
          y2={height - padding.bottom}
          stroke="currentColor"
          strokeOpacity="0.2"
          strokeWidth="1.5"
        />
        <line
          x1={padding.left}
          y1={height - padding.bottom}
          x2={width - padding.right}
          y2={height - padding.bottom}
          stroke="currentColor"
          strokeOpacity="0.2"
          strokeWidth="1.5"
        />

        {/* 图例 */}
        <rect x={width - 160} y={8} width="152" height="76" fill="white" fillOpacity="0.95" rx="4" stroke="#e5e7eb" strokeWidth="1" />
        <g transform={`translate(${width - 152}, 18)`}>
          <line x1="0" y1="6" x2="24" y2="6" stroke="#3b82f6" strokeWidth="2.5" />
          <circle cx="12" cy="6" r="3" fill="#3b82f6" />
          <text x="32" y="10" className="fill-gray-700" fontSize="10">连贯性</text>

          <line x1="0" y1="28" x2="24" y2="28" stroke="#8b5cf6" strokeWidth="2.5" strokeDasharray="6 3" />
          <circle cx="12" cy="28" r="3" fill="#8b5cf6" />
          <text x="32" y="32" className="fill-gray-700" fontSize="10">角色一致性</text>

          <line x1="0" y1="50" x2="24" y2="50" stroke="#10b981" strokeWidth="2.5" strokeDasharray="3 3" />
          <circle cx="12" cy="50" r="3" fill="#10b981" />
          <text x="32" y="54" className="fill-gray-700" fontSize="10">进度符合度</text>
        </g>
      </svg>
    </div>
  )
}
