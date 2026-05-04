/**
 * @file ChapterQualityList.tsx
 * @description 章节质量列表 - 按质量评分排序展示所有章节，支持快速定位问题章节
 * @date 2026-05-04
 */
import { ChevronRight, AlertTriangle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { QualityChapterData } from './types'

interface ChapterQualityListProps {
  chapters: QualityChapterData[]
  onViewDetail: (chapter: QualityChapterData) => void
}

export function ChapterQualityList({ chapters, onViewDetail }: ChapterQualityListProps) {
  if (!chapters || chapters.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p className="text-sm">暂无章节质量数据</p>
      </div>
    )
  }

  const sortedChapters = [...chapters].sort((a, b) => a.chapterNumber - b.chapterNumber)

  return (
    <div className="space-y-2">
      {sortedChapters.map((chapter) => (
        <ChapterListItem
          key={chapter.id}
          chapter={chapter}
          onClick={() => onViewDetail(chapter)}
        />
      ))}
    </div>
  )
}

function ChapterListItem({
  chapter,
  onClick,
}: {
  chapter: QualityChapterData
  onClick: () => void
}) {
  const getScoreColor = (score: number | null): string => {
    if (score === null) return 'bg-gray-100 text-gray-500'
    if (score >= 80) return 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
    if (score >= 60) return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'
    return 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
  }

  const getOverallColor = (): string => {
    if (chapter.overallScore === null) return 'border-gray-200 hover:bg-gray-50/50'
    if (chapter.overallScore >= 80) return 'border-green-200 hover:bg-green-50/30'
    if (chapter.overallScore >= 60) return 'border-yellow-200 hover:bg-yellow-50/30'
    return 'border-red-200 hover:bg-red-50/30'
  }

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center justify-between p-4 border rounded-lg transition-all ${getOverallColor()}`}
    >
      <div className="flex items-center gap-4 min-w-0 flex-1">
        <div className="font-semibold text-base whitespace-nowrap truncate">
          {chapter.title || '未命名章节'}
        </div>

        {chapter.issueCount > 0 && (
          <Badge variant="destructive" className="text-xs animate-pulse flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            {chapter.issueCount}个问题
          </Badge>
        )}

        {chapter.lastCheckedAt && (
          <span className="text-xs text-muted-foreground hidden lg:inline">
            检查于 {formatTime(chapter.lastCheckedAt)}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 shrink-0 ml-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground hidden sm:inline">连贯</span>
          <Badge
            variant="secondary"
            className={`text-xs font-mono font-bold ${getScoreColor(chapter.coherenceScore)}`}
          >
            {chapter.coherenceScore !== null ? Math.round(chapter.coherenceScore) : '-'}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground hidden sm:inline">角色</span>
          <Badge
            variant="secondary"
            className={`text-xs font-mono font-bold ${getScoreColor(chapter.characterScore)}`}
          >
            {chapter.characterScore !== null ? Math.round(chapter.characterScore) : '-'}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground hidden sm:inline">进度</span>
          <Badge
            variant="secondary"
            className={`text-xs font-mono font-bold ${getScoreColor(chapter.progressScore)}`}
          >
            {chapter.progressScore !== null ? Math.round(chapter.progressScore) : '-'}
          </Badge>
        </div>

        <ChevronRight className="w-4 h-4 text-muted-foreground" />
      </div>
    </button>
  )
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp * 1000)
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}
