import { useState, useEffect } from 'react'
import { api } from '../../lib/api'
import type { QualityScore } from '../../lib/types'

interface QualityScoreBadgeProps {
  chapterId: string
  novelId: string
}

export function QualityScoreBadge({ chapterId, novelId }: QualityScoreBadgeProps) {
  const [score, setScore] = useState<QualityScore | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.quality.getChapterScore(chapterId).then(s => { setScore(s); setLoading(false) }).catch(() => setLoading(false))
  }, [chapterId])

  if (loading) return <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] rounded bg-gray-100 dark:bg-gray-800 text-gray-400">--</span>
  if (!score?.totalScore) return null

  const colorClass =
    score.totalScore >= 80 ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' :
    score.totalScore >= 60 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300' :
    'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'

  return (
    <span title={`质量分: ${score.totalScore}\n情节:${score.plotScore} 人物:${score.consistencyScore}\n伏笔:${score.foreshadowingScore} 节奏:${score.pacingScore} 文笔:${score.fluencyScore}`}
      className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded ${colorClass}`}>
      {score.totalScore}
    </span>
  )
}
