/**
 * @file CheckSummary.tsx
 * @description 章节健康检查最新结果摘要组件
 */
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2 } from 'lucide-react'
import type { CheckLog, CombinedReport } from './types'
import { api } from '@/lib/api'

interface CheckSummaryProps {
  latestCheckLog: CheckLog | null
  chapterId: string | null
  novelId: string
  onViewReport: (report: CombinedReport) => void
  onLoadHistory: () => void
}

export function CheckSummary({
  latestCheckLog,
  chapterId,
  novelId,
  onViewReport,
  onLoadHistory,
}: CheckSummaryProps) {
  if (!latestCheckLog) {
    return null
  }

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600'
    if (score >= 60) return 'text-amber-600'
    return 'text-red-600'
  }

  const getCheckTypeLabel = (checkType: string) => {
    switch (checkType) {
      case 'character_consistency':
        return '角色'
      case 'chapter_coherence':
        return '连贯性'
      case 'combined':
        return '综合'
      case 'volume_progress':
        return '卷进度'
      default:
        return checkType
    }
  }

  const handleViewReport = async () => {
    if (!latestCheckLog.coherenceResult && latestCheckLog.checkType !== 'chapter_coherence') {
      return
    }

    let volumeProgressResult = latestCheckLog.volumeProgressResult
    if (!volumeProgressResult && latestCheckLog.checkType === 'combined') {
      const volumeData = await api.generate.getCheckLogsLatest(chapterId!, 'volume_progress')
      volumeProgressResult = volumeData.log?.volumeProgressResult ?? undefined
    }

    const defaultVolumeProgress = {
      volumeId: '',
      currentChapter: 0,
      targetChapter: null,
      currentWordCount: 0,
      targetWordCount: null,
      chapterProgress: 0,
      wordProgress: 0,
      perChapterEstimate: null,
      wordCountIssues: [],
      rhythmIssues: [],
      wordCountScore: 100,
      rhythmScore: 100,
      diagnosis: '无数据',
      suggestion: '',
      score: 100,
    }

    onViewReport({
      characterCheck: latestCheckLog.characterResult || { conflicts: [], warnings: [], score: 100 },
      coherenceCheck: latestCheckLog.coherenceResult || { score: 100, issues: [] },
      volumeProgressCheck: volumeProgressResult || defaultVolumeProgress,
      score: latestCheckLog.score ?? 100,
    })
  }

  const canViewReport =
    (latestCheckLog.checkType === 'chapter_coherence' || latestCheckLog.checkType === 'combined') &&
    (latestCheckLog.coherenceResult?.issues?.length ?? 0) > 0

  return (
    <div className="flex items-center justify-between p-2.5 bg-muted/40 rounded-lg text-xs group hover:bg-muted/60 transition-colors">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Badge variant="outline" className="text-[10px] shrink-0">
          {getCheckTypeLabel(latestCheckLog.checkType)}
        </Badge>
        <span className={`font-semibold ${getScoreColor(latestCheckLog.score)}`}>
          {latestCheckLog.score}分
        </span>
        <span className="text-muted-foreground truncate ml-1">
          {latestCheckLog.issuesCount && latestCheckLog.issuesCount > 0 ? `${latestCheckLog.issuesCount}个问题` : '✓ 通过'}
        </span>
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-[10px] px-1.5"
          onClick={onLoadHistory}
        >
          历史
        </Button>
        {canViewReport && (
          <Button
            variant="default"
            size="sm"
            className="h-6 text-[10px] px-2 bg-blue-600 hover:bg-blue-700"
            onClick={handleViewReport}
          >
            查看报告
          </Button>
        )}
      </div>
    </div>
  )
}