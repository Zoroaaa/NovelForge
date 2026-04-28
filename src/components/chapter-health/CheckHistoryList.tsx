/**
 * @file CheckHistoryList.tsx
 * @description 章节健康检查历史记录列表组件
 */
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { CheckLog } from './types'

interface CheckHistoryListProps {
  checkHistory: CheckLog[]
  latestCheckLog: CheckLog | null
  onSelectLog: (log: CheckLog) => void
}

export function CheckHistoryList({
  checkHistory,
  latestCheckLog,
  onSelectLog,
}: CheckHistoryListProps) {
  if (checkHistory.length === 0) {
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
        return '连贯'
      case 'combined':
        return '综合'
      case 'volume_progress':
        return '卷进度'
      default:
        return checkType
    }
  }

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground uppercase tracking-wider">
        检查历史
      </h4>
      <ScrollArea className="max-h-40 rounded-lg border bg-muted/20">
        <div className="p-2 space-y-1">
          {checkHistory.map((log) => (
            <button
              key={log.id}
              className={`w-full flex items-center justify-between p-2 rounded text-xs text-left transition-colors hover:bg-background ${
                log.id === latestCheckLog?.id ? 'bg-primary/5 ring-1 ring-primary/20' : ''
              }`}
              onClick={() => onSelectLog(log)}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <Badge variant="outline" className="text-[9px] shrink-0">
                  {getCheckTypeLabel(log.checkType)}
                </Badge>
                <span className={`font-medium ${getScoreColor(log.score)}`}>
                  {log.score}分
                </span>
              </div>
              <span className="text-muted-foreground text-[10px] shrink-0 ml-2">
                {new Date(log.createdAt * 1000).toLocaleTimeString('zh-CN', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}