/**
 * @file QualityScoreCard.tsx
 * @description 质量总分卡片 - 展示当前章节的综合质量评分和维度得分
 * @date 2026-05-04
 */
import { Card, CardContent } from '@/components/ui/card'
import type { QualitySummary } from './types'
import { Link2, Users, Target, Award } from 'lucide-react'

interface QualityScoreCardProps {
  data: QualitySummary['averages']
}

export function QualityScoreCard({ data }: QualityScoreCardProps) {
  const cards = [
    {
      title: '平均连贯性',
      score: data.coherence,
      icon: <Link2 className="w-5 h-5 text-blue-600" />,
      color: 'blue',
    },
    {
      title: '角色一致性',
      score: data.character,
      icon: <Users className="w-5 h-5 text-purple-600" />,
      color: 'purple',
    },
    {
      title: '进度符合度',
      score: data.progress,
      icon: <Target className="w-5 h-5 text-green-600" />,
      color: 'green',
    },
    {
      title: '综合评分',
      score: data.overall,
      icon: <Award className="w-5 h-5 text-orange-600" />,
      color: 'orange',
    },
  ]

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => (
        <ScoreCard
          key={card.title}
          title={card.title}
          score={card.score}
          icon={card.icon}
          color={card.color}
        />
      ))}
    </div>
  )
}

function ScoreCard({
  title,
  score,
  icon,
  color,
}: {
  title: string
  score: number
  icon: React.ReactNode
  color: string
}) {
  const getScoreColor = (s: number): string => {
    if (s >= 80) return `text-${color}-600`
    if (s >= 60) return `text-yellow-600`
    return `text-red-600`
  }

  const getBgColor = (s: number): string => {
    if (s >= 80) return `bg-${color}-50 dark:bg-${color}-950`
    if (s >= 60) return 'bg-yellow-50 dark:bg-yellow-950'
    return 'bg-red-50 dark:bg-red-950'
  }

  const getStatusText = (s: number): string => {
    if (s >= 90) return '优秀'
    if (s >= 80) return '良好'
    if (s >= 60) return '一般'
    if (s >= 40) return '较差'
    return '需改进'
  }

  const circumference = 2 * Math.PI * 36
  const strokeDashoffset = circumference - (score / 100) * circumference

  return (
    <Card className={`hover:shadow-md transition-all ${getBgColor(score)} border-${color}-200`}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          {icon}
        </div>

        <div className="flex items-center justify-between">
          <div className="relative w-20 h-20">
            <svg className="w-20 h-20 transform -rotate-90" viewBox="0 0 80 80">
              <circle
                cx="40"
                cy="40"
                r="36"
                fill="none"
                stroke="currentColor"
                strokeWidth="6"
                className="text-gray-200 dark:text-gray-700"
              />
              <circle
                cx="40"
                cy="40"
                r="36"
                fill="none"
                stroke="currentColor"
                strokeWidth="6"
                strokeLinecap="round"
                className={getScoreColor(score)}
                style={{
                  strokeDasharray: circumference,
                  strokeDashoffset,
                  transition: 'stroke-dashoffset 0.8s ease-in-out',
                }}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className={`text-xl font-bold ${getScoreColor(score)}`}>
                {Math.round(score)}
              </span>
            </div>
          </div>

          <div className="space-y-1 text-right">
            <p className={`text-sm font-semibold ${getScoreColor(score)}`}>
              {getStatusText(score)}
            </p>
            <p className="text-xs text-muted-foreground">满分100</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
