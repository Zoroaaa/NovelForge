import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { PowerLevelHistoryItem, PowerLevelHistoryBreakthrough, PowerLevelValidationResult } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Swords, TrendingUp, ChevronDown, ChevronUp, Loader2, Zap, Clock, AlertCircle, ShieldCheck, CheckCircle2, TriangleAlert, RefreshCw } from 'lucide-react'

interface PowerLevelPanelProps {
  novelId: string
}

export function PowerLevelPanel({ novelId }: PowerLevelPanelProps) {
  const queryClient = useQueryClient()
  const [expandedCharacterId, setExpandedCharacterId] = useState<string | null>(null)
  const [showTimeline, setShowTimeline] = useState(false)
  const [batchDetecting, setBatchDetecting] = useState(false)
  const [validatingId, setValidatingId] = useState<string | null>(null)
  const [validationResults, setValidationResults] = useState<Map<string, PowerLevelValidationResult>>(new Map())

  const { data: historyData, isLoading } = useQuery({
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
      if (data.errorCount > 0) toast.warning(`${data.errorCount} 章检测失败`)
      queryClient.invalidateQueries({ queryKey: ['power-level-history', novelId] })
      queryClient.invalidateQueries({ queryKey: ['characters', novelId] })
      setBatchDetecting(false)
    },
    onError: (error: Error) => {
      toast.error(`批量检测失败: ${error.message}`)
      setBatchDetecting(false)
    },
  })

  const applySuggestionMutation = useMutation({
    mutationFn: (params: { characterId: string; suggestedCurrent: string; suggestedSystem?: string }) =>
      api.powerLevel.applySuggestion({
        characterId: params.characterId,
        novelId,
        suggestedCurrent: params.suggestedCurrent,
        suggestedSystem: params.suggestedSystem,
        note: '基于校验结果更新',
      }),
    onSuccess: (data, variables) => {
      toast.success(`${data.characterName}: ${data.previousLevel} → ${data.newLevel}`)
      queryClient.invalidateQueries({ queryKey: ['power-level-history', novelId] })
      queryClient.invalidateQueries({ queryKey: ['characters', novelId] })
      setValidationResults(prev => {
        const next = new Map(prev)
        next.delete(variables.characterId)
        return next
      })
    },
    onError: (error: Error) => {
      toast.error(`更新失败: ${error.message}`)
    },
  })

  const handleValidate = async (characterId: string) => {
    setValidatingId(characterId)
    try {
      const result = await api.powerLevel.validate({ characterId, novelId })
      setValidationResults(prev => {
        const next = new Map(prev)
        next.set(characterId, result)
        return next
      })
    } catch (error) {
      toast.error(`校验失败: ${(error as Error).message}`)
    } finally {
      setValidatingId(null)
    }
  }

  const handleApplySuggestion = (characterId: string) => {
    const vr = validationResults.get(characterId)
    if (!vr?.assessedLevel) return
    applySuggestionMutation.mutate({
      characterId,
      suggestedCurrent: vr.assessedLevel.current,
      suggestedSystem: vr.assessedLevel.system,
    })
  }

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
        <Button size="sm" variant="outline" onClick={handleBatchDetect} disabled={batchDetecting} className="text-xs h-7 gap-1">
          {batchDetecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
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
                isValidating={validatingId === item.characterId}
                validationResult={validationResults.get(item.characterId)}
                onValidate={() => handleValidate(item.characterId)}
                onApply={() => handleApplySuggestion(item.characterId)}
                isApplying={applySuggestionMutation.isPending && applySuggestionMutation.variables?.characterId === item.characterId}
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
                {showTimeline && <TimelineView breakthroughs={allBreakthroughs} />}
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
  isValidating,
  validationResult,
  onValidate,
  onApply,
  isApplying,
}: {
  item: PowerLevelHistoryItem
  isExpanded: boolean
  onToggle: () => void
  isValidating: boolean
  validationResult?: PowerLevelValidationResult
  onValidate: () => void
  onApply: () => void
  isApplying: boolean
}) {
  return (
    <div className="rounded-lg border bg-card overflow-hidden transition-all">
      <button onClick={onToggle} className="w-full px-3 py-2.5 flex items-center gap-3 hover:bg-muted/40 transition-colors text-left">
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
                <TrendingUp className="h-2.5 w-2.5" />突破 {item.totalBreakthroughs} 次
              </span>
            )}
            {validationResult && (
              <span className={`text-[10px] flex items-center gap-0.5 ${
                validationResult.isConsistent
                  ? 'text-green-600'
                  : 'text-orange-500'
              }`}>
                {validationResult.isConsistent
                  ? <><CheckCircle2 className="h-2.5 w-2.5" />匹配</>
                  : <><TriangleAlert className="h-2.5 w-2.5" />不匹配</>
                }
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => { e.stopPropagation(); onValidate() }}
            disabled={isValidating}
            title="校验当前境界是否与章节内容一致"
          >
            {isValidating
              ? <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
              : validationResult
                ? <RefreshCw className="h-3 w-3 text-muted-foreground hover:text-blue-500" />
                : <ShieldCheck className="h-3 w-3 text-muted-foreground hover:text-blue-500" />
            }
          </Button>
          {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
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

          {validationResult && !validationResult.isConsistent && validationResult.assessedLevel && (
            <div className="rounded-md border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/30 p-2.5 space-y-2">
              <div className="flex items-start gap-1.5">
                <AlertCircle className="h-3.5 w-3.5 text-orange-500 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0 space-y-1">
                  <p className="text-[11px] font-medium text-orange-700 dark:text-orange-300">境界可能不一致</p>
                  <div className="text-[10px] space-y-0.5">
                    <p><span className="text-muted-foreground">数据库：</span><span className="line-through">{validationResult.dbLevel?.current}</span></p>
                    <p><span className="text-muted-foreground">实际（LLM判断）：</span><span className="font-medium text-orange-600 dark:text-orange-400">{validationResult.assessedLevel.current}</span></p>
                    {validationResult.reasoning && (
                      <p className="text-muted-foreground italic">{validationResult.reasoning}</p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-[10px] h-6 gap-1 border-orange-300 text-orange-600 hover:bg-orange-100"
                    onClick={onApply}
                    disabled={isApplying}
                  >
                    {isApplying ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                    一键更新为 {validationResult.assessedLevel.current}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {validationResult && validationResult.isConsistent && (
            <div className="rounded-md bg-green-50 dark:bg-green-950/20 p-2 flex items-center gap-1.5 text-[10px] text-green-600 dark:text-green-400">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              <span>校验通过：数据库记录与最近章节内容一致（置信度：{validationResult.confidence}）</span>
            </div>
          )}

          {item.breakthroughs.length > 0 ? (
            <div className="space-y-1.5 mt-2">
              <div className="text-[10px] font-medium text-muted-foreground flex items-center gap-1">
                <TrendingUp className="h-3 w-3" />突破历史（{item.breakthroughs.length} 次）
              </div>
              {item.breakthroughs.map((bt, idx) => (
                <div key={idx} className="bg-muted/30 rounded p-2 text-[10px] space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground">{bt.chapterTitle}</span>
                    {bt.timestamp && <span className="text-muted-foreground">{new Date(bt.timestamp).toLocaleDateString('zh-CN')}</span>}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground line-through">{bt.from}</span>
                    <Zap className="h-3 w-3 text-purple-400" />
                    <span className="font-medium text-purple-600 dark:text-purple-400">{bt.to}</span>
                  </div>
                  {bt.note && <p className="text-muted-foreground/70 italic">{bt.note}</p>}
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
            {idx < breakthroughs.length - 1 && <div className="w-px flex-1 bg-purple-200 dark:bg-purple-800 mt-1" />}
          </div>
          <div className="flex-1 min-w-0 pb-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium">{bt.characterName}</span>
              <span className="text-[10px] px-1.5 py-0 rounded bg-green-50 text-green-600">{bt.from} → {bt.to}</span>
              {bt.timestamp && <span className="text-[10px] text-muted-foreground">{new Date(bt.timestamp).toLocaleDateString('zh-CN')}</span>}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              《{bt.chapterTitle}》{bt.note && <span className="ml-1 italic">— {bt.note}</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
