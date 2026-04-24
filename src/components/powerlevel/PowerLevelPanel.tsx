import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { PowerLevelHistoryItem, PowerLevelHistoryBreakthrough } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Swords, TrendingUp, ChevronDown, ChevronUp, Loader2, Zap, Clock, AlertCircle } from 'lucide-react'

interface PowerLevelPanelProps {
  novelId: string
}

export function PowerLevelPanel({ novelId }: PowerLevelPanelProps) {
  const queryClient = useQueryClient()
  const [expandedCharacterId, setExpandedCharacterId] = useState<string | null>(null)
  const [showTimeline, setShowTimeline] = useState(false)
  const [batchDetecting, setBatchDetecting] = useState(false)

  const { data: historyData, isLoading, refetch } = useQuery({
    queryKey: ['power-level-history', novelId],
    queryFn: () => api.powerLevel.history(novelId),
  })

  const history = historyData?.history || []

  const allBreakthroughs: Array<PowerLevelHistoryBreakthrough & { characterName: string; system: string }> = []
  for (const item of history) {
    for (const bt of item.breakthroughs) {
      allBreakthroughs.push({ ...bt, characterName: item.characterName, system: item.system })
    }
  }
  allBreakthroughs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))

  const batchDetectMutation = useMutation({
    mutationFn: () => api.powerLevel.batchDetect({ novelId }),
    onSuccess: (data) => {
      toast.success(`批量检测完成：${data.totalChapters} 章，发现 ${data.totalBreakthroughs} 次突破`)
      if (data.errorCount > 0) {
        toast.warning(`${data.errorCount} 章检测失败`)
      }
      queryClient.invalidateQueries({ queryKey: ['power-level-history', novelId] })
      queryClient.invalidateQueries({ queryKey: ['characters', novelId] })
      setBatchDetecting(false)
    },
    onError: (error: Error) => {
      toast.error(`批量检测失败: ${error.message}`)
      setBatchDetecting(false)
    },
  })

  const handleBatchDetect = () => {
    setBatchDetecting(true)
    batchDetectMutation.mutate()
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">加载境界数据...</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-2">
          <Swords className="h-4 w-4 text-purple-500" />
          <span className="text-sm font-medium">境界追踪</span>
          {history.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 font-medium">
              {history.length} 角色
            </span>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleBatchDetect}
          disabled={batchDetecting}
          className="text-xs h-7 gap-1"
        >
          {batchDetecting ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Zap className="h-3 w-3" />
          )}
          批量检测
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {history.length === 0 ? (
          <EmptyState onDetect={handleBatchDetect} detecting={batchDetecting} />
        ) : (
          <>
            {history.map((item) => (
              <CharacterCard
                key={item.characterId}
                item={item}
                isExpanded={expandedCharacterId === item.characterId}
                onToggle={() => setExpandedCharacterId(
                  expandedCharacterId === item.characterId ? null : item.characterId
                )}
              />
            ))}

            {allBreakthroughs.length > 0 && (
              <div className="mt-4 pt-3 border-t">
                <button
                  onClick={() => setShowTimeline(!showTimeline)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
                >
                  <Clock className="h-3.5 w-3.5" />
                  <span>成长时间线 ({allBreakthroughs.length} 次突破)</span>
                  {showTimeline ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
                </button>

                {showTimeline && (
                  <TimelineView breakthroughs={allBreakthroughs} />
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function EmptyState({ onDetect, detecting }: { onDetect: () => void; detecting: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-12 h-12 rounded-full bg-purple-50 dark:bg-purple-950 flex items-center justify-center mb-3">
        <Swords className="h-6 w-6 text-purple-400" />
      </div>
      <p className="text-sm text-muted-foreground mb-1">暂无境界数据</p>
      <p className="text-[11px] text-muted-foreground/60 mb-4">生成章节后会自动检测，或手动触发扫描</p>
      <Button size="sm" onClick={onDetect} disabled={detecting} className="gap-1">
        {detecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
        批量回溯检测
      </Button>
    </div>
  )
}

function CharacterCard({
  item,
  isExpanded,
  onToggle,
}: {
  item: PowerLevelHistoryItem
  isExpanded: boolean
  onToggle: () => void
}) {
  return (
    <div className="rounded-lg border bg-card overflow-hidden transition-all">
      <button
        onClick={onToggle}
        className="w-full px-3 py-2.5 flex items-center gap-3 hover:bg-muted/40 transition-colors text-left"
      >
        <div className="w-8 h-8 rounded-md bg-purple-50 dark:bg-purple-950 flex items-center justify-center shrink-0">
          <Swords className="h-4 w-4 text-purple-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{item.characterName}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 font-medium truncate max-w-[120px]">
              {item.currentLevel}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-muted-foreground">{item.system}</span>
            {item.totalBreakthroughs > 0 && (
              <span className="text-[10px] text-purple-500 flex items-center gap-0.5">
                <TrendingUp className="h-2.5 w-2.5" />
                突破 {item.totalBreakthroughs} 次
              </span>
            )}
          </div>
        </div>
        {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 pt-1 border-t border-border/50 space-y-2">
          <div className="grid grid-cols-2 gap-2 text-[11px] mt-2">
            <div className="bg-muted/50 rounded p-2">
              <span className="text-muted-foreground block mb-0.5">体系</span>
              <span className="font-medium">{item.system}</span>
            </div>
            <div className="bg-purple-50 dark:bg-purple-950 rounded p-2">
              <span className="text-purple-500 block mb-0.5">当前境界</span>
              <span className="font-medium text-purple-700 dark:text-purple-300">{item.currentLevel}</span>
            </div>
          </div>

          {item.nextMilestone && (
            <div className="bg-blue-50 dark:bg-blue-950 rounded p-2 text-[11px]">
              <span className="text-blue-500">下一目标：</span>
              <span className="font-medium text-blue-700 dark:text-blue-300">{item.nextMilestone}</span>
            </div>
          )}

          {item.breakthroughs.length > 0 ? (
            <div className="space-y-1.5 mt-2">
              <div className="text-[10px] font-medium text-muted-foreground flex items-center gap-1">
                <TrendingUp className="h-3 w-3" />
                突破历史（{item.breakthroughs.length} 次）
              </div>
              {item.breakthroughs.map((bt, idx) => (
                <div key={idx} className="bg-muted/30 rounded p-2 text-[10px] space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground">{bt.chapterTitle}</span>
                    {bt.timestamp && (
                      <span className="text-muted-foreground">
                        {new Date(bt.timestamp).toLocaleDateString('zh-CN')}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground line-through">{bt.from}</span>
                    <Zap className="h-3 w-3 text-purple-400" />
                    <span className="font-medium text-purple-600 dark:text-purple-400">{bt.to}</span>
                  </div>
                  {bt.note && (
                    <p className="text-muted-foreground/70 italic">{bt.note}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground/50 italic mt-2">暂无突破记录</p>
          )}
        </div>
      )}
    </div>
  )
}

function TimelineView({ breakthroughs }: { breakthroughs: Array<PowerLevelHistoryBreakthrough & { characterName: string; system: string }> }) {
  return (
    <div className="mt-3 pl-2 space-y-0">
      {breakthroughs.map((bt, idx) => (
        <div key={idx} className="relative flex gap-3 pb-4 last:pb-0">
          <div className="flex flex-col items-center">
            <div className="w-2.5 h-2.5 rounded-full bg-purple-500 ring-4 ring-purple-100 dark:ring-purple-950 z-10" />
            {idx < breakthroughs.length - 1 && (
              <div className="w-px flex-1 bg-purple-200 dark:bg-purple-800 mt-1" />
            )}
          </div>
          <div className="flex-1 min-w-0 pb-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium">{bt.characterName}</span>
              <span className="text-[10px] px-1.5 py-0 rounded bg-green-50 text-green-600">
                {bt.from} → {bt.to}
              </span>
              {bt.timestamp && (
                <span className="text-[10px] text-muted-foreground">
                  {new Date(bt.timestamp).toLocaleDateString('zh-CN')}
                </span>
              )}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              《{bt.chapterTitle}》
              {bt.note && <span className="ml-1 italic">— {bt.note}</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
