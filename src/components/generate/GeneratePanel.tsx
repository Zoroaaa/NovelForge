import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Square,
  PenLine,
  Brain,
  Shield,
  ShieldAlert,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Play,
  Loader2,
  Link,
} from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useGenerate } from '@/hooks/useGenerate'
import { RepairDiffPanel } from './RepairDiffPanel'
import { StreamOutput } from './StreamOutput'
import {
  ContextPreview,
  type ContextBundle,
} from './ContextPreview'
import { CharacterConsistencyCheck } from './CharacterConsistencyCheck'
import { ChapterCoherenceCheck } from './ChapterCoherenceCheck'
import { CombinedCheck } from './CombinedCheck'
import { getToken } from '@/lib/api'

interface GeneratePanelProps {
  novelId: string
  chapterId: string
  chapterTitle: string
  onInsertContent: (content: string) => void
  onContextUpdate?: (context: ContextBundle | null) => void
  existingContent?: string
}

type GenerationMode = 'generate' | 'continue' | 'rewrite'

interface CoherenceIssue {
  severity: 'error' | 'warning'
  category?: string
  message: string
  suggestion?: string
}

interface CoherenceCheckResult {
  score: number
  issues: CoherenceIssue[]
}

const TARGET_WORDS_MIN = 500
const TARGET_WORDS_MAX = 8000
const TARGET_WORDS_DEFAULT = 2000

export function GeneratePanel({
  novelId,
  chapterId,
  chapterTitle,
  onInsertContent,
  onContextUpdate,
  existingContent = '',
}: GeneratePanelProps) {
  const { output, status, generate, stop, contextInfo, toolCalls, usage, repairedContent, repairInfo, clearRepair } = useGenerate()
  const [showConsistencyCheck, setShowConsistencyCheck] = useState(false)
  const [showCoherenceCheck, setShowCoherenceCheck] = useState(false)
  const [showCombinedCheck, setShowCombinedCheck] = useState(false)
  const [isInserting, setIsInserting] = useState(false)
  const [mode, setMode] = useState<GenerationMode>('generate')
  const [selectedText] = useState<string>('')
  const [targetWords, setTargetWords] = useState(TARGET_WORDS_DEFAULT)

  const [rewriteDialogOpen, setRewriteDialogOpen] = useState(false)
  const [coherenceChecking, setCoherenceChecking] = useState(false)
  const [coherenceResult, setCoherenceResult] = useState<CoherenceCheckResult | null>(null)
  const [coherenceCheckFailed, setCoherenceCheckFailed] = useState(false)

  const [latestCheckLog, setLatestCheckLog] = useState<any>(null)
  const [showCheckHistory, setShowCheckHistory] = useState(false)
  const [checkHistory, setCheckHistory] = useState<any[]>([])

  const [combinedReport, setCombinedReport] = useState<{
    characterResult: any
    coherenceResult: any
    score: number
  } | null>(null)
  const [isChecking, setIsChecking] = useState(false)

  const hasContent = existingContent.trim().length > 0

  const loadLatestCheckLog = useCallback(async () => {
    try {
      const token = getToken()
      const headers: Record<string, string> = {}
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res = await fetch(`/api/generate/check-logs/latest?chapterId=${chapterId}`, { headers })
      if (res.ok) {
        const data = await res.json()
        if (data.log) {
          setLatestCheckLog(data.log)
        }
      }
    } catch (error) {
      console.error('加载最新检查日志失败:', error)
    }
  }, [chapterId])

  useEffect(() => {
    if (chapterId) {
      loadLatestCheckLog()
    }
  }, [chapterId, loadLatestCheckLog])

  const loadCheckHistory = useCallback(async () => {
    try {
      const token = getToken()
      const headers: Record<string, string> = {}
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res = await fetch(`/api/generate/check-logs/history?chapterId=${chapterId}&limit=20`, { headers })
      if (res.ok) {
        const data = await res.json()
        setCheckHistory(data.logs || [])
        setShowCheckHistory(true)
      }
    } catch (error) {
      console.error('加载检查历史失败:', error)
    }
  }, [chapterId])

  const handleAcceptRepair = (content: string) => {
    onInsertContent(content)
    clearRepair()
  }

  const handleInsert = () => {
    if (output && !isInserting) {
      setIsInserting(true)
      onInsertContent(output)
      setTimeout(() => {
        setIsInserting(false)
      }, 2000)
    }
  }

  if (onContextUpdate && contextInfo) {
    onContextUpdate(contextInfo)
  }

  const handleGenerate = () => {
    const options: any = { mode }

    if (mode === 'continue' && hasContent) {
      options.existingContent = existingContent
      options.targetWords = targetWords
    }

    if (mode === 'rewrite' && selectedText) {
      options.existingContent = selectedText
    } else if (mode === 'rewrite' && hasContent) {
      options.existingContent = existingContent
    }

    if (mode === 'rewrite' && coherenceResult?.issues && coherenceResult.issues.length > 0) {
      options.issuesContext = coherenceResult.issues.map(
        (i: CoherenceIssue) => `[${i.severity === 'error' ? '错误' : '警告'}] ${i.message}${i.suggestion ? `。建议：${i.suggestion}` : ''}`
      )
    }

    generate(chapterId, novelId, options)
  }

  const handleRewriteClick = async () => {
    setRewriteDialogOpen(true)
    setIsChecking(true)
    setCombinedReport(null)

    try {
      const token = getToken()
      const headers: Record<string, string> = {}
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res = await fetch(`/api/generate/check-logs/latest?chapterId=${chapterId}&checkType=combined`, { headers })

      if (res.ok) {
        const data = await res.json()
        if (data.log && data.log.characterResult && data.log.coherenceResult) {
          setCombinedReport({
            characterResult: data.log.characterResult,
            coherenceResult: data.log.coherenceResult,
            score: data.log.score,
          })
          setIsChecking(false)
          return
        }
      }

      const checkRes = await fetch('/api/generate/combined-check', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ chapterId, novelId }),
      })
      if (!checkRes.ok) throw new Error('综合检查请求失败')
      const checkData = await checkRes.json()

      setCombinedReport({
        characterResult: checkData.characterCheck,
        coherenceResult: checkData.coherenceCheck,
        score: checkData.score,
      })

      loadLatestCheckLog()
    } catch (error) {
      console.error('综合检查失败:', error)
      setCoherenceCheckFailed(true)
    } finally {
      setIsChecking(false)
    }
  }

  const handleRecheck = async () => {
    setIsChecking(true)
    setCombinedReport(null)

    try {
      const token = getToken()
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res = await fetch('/api/generate/combined-check', {
        method: 'POST',
        headers,
        body: JSON.stringify({ chapterId, novelId }),
      })
      if (!res.ok) throw new Error('重新检查请求失败')
      const data = await res.json()

      setCombinedReport({
        characterResult: data.characterCheck,
        coherenceResult: data.coherenceCheck,
        score: data.score,
      })

      loadLatestCheckLog()
    } catch (error) {
      console.error('重新检查失败:', error)
    } finally {
      setIsChecking(false)
    }
  }

  const handleRewriteConfirm = () => {
    setRewriteDialogOpen(false)

    if (combinedReport) {
      const characterIssues = (combinedReport.characterResult?.conflicts || []).map(
        (c: any, i: number) => `[角色冲突${i + 1}] ${c.characterName}: ${c.conflict}`
      )
      const characterWarnings = (combinedReport.characterResult?.warnings || []).map(
        (w: any) => `[角色警告] ${w}`
      )
      const coherenceIssues = (combinedReport.coherenceResult?.issues || []).map(
        (issue: any) => `[${issue.severity === 'error' ? '连贯性错误' : '连贯性警告'}] ${issue.message}${issue.suggestion ? `。建议：${issue.suggestion}` : ''}`
      )

      const allIssues = [...characterIssues, ...characterWarnings, ...coherenceIssues]
      if (allIssues.length > 0) {
        const options: any = { mode: 'rewrite', issuesContext: allIssues }
        if (hasContent) options.existingContent = existingContent
        generate(chapterId, novelId, options)
        return
      }
    }

    handleGenerate()
  }

  const getModeDescription = (): string => {
    switch (mode) {
      case 'continue':
        return '基于当前章节末尾内容继续创作，保持文风和情节连贯'
      case 'rewrite':
        return selectedText ? '对选中文本进行改写优化' : '对当前内容进行改写，提升文笔质量'
      default:
        return '基于大纲和上下文从零开始创作本章内容'
    }
  }

  const getButtonText = (): string => {
    switch (mode) {
      case 'continue':
        return '续写内容'
      case 'rewrite':
        return '重写内容'
      default:
        return '智能生成内容'
    }
  }

  const isGenerateButtonDisabled = () => {
    if (mode === 'continue' || mode === 'rewrite') {
      return !hasContent && !selectedText
    }
    return false
  }

  return (
    <div className="p-4 space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Brain className="h-4 w-4 text-primary" />
            AI 智能生成
          </h3>
          {status === 'generating' && (
            <span className="text-[10px] px-2 py-0.5 bg-primary/10 text-primary rounded-full animate-pulse">
              Phase 2 Agent
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">当前章节：{chapterTitle}</p>
      </div>

      <div className="flex gap-1 bg-muted rounded-lg p-1">
        <button
          onClick={() => setMode('generate')}
          className={`flex-1 px-3 py-1.5 text-xs rounded-md transition-colors ${
            mode === 'generate'
              ? 'bg-background shadow-sm font-medium'
              : 'hover:bg-background/50'
          }`}
        >
          <PenLine className="h-3 w-3 inline mr-1" />
          全新生成
        </button>
        <button
          onClick={() => setMode('continue')}
          disabled={!hasContent}
          className={`flex-1 px-3 py-1.5 text-xs rounded-md transition-colors ${
            mode === 'continue'
              ? 'bg-background shadow-sm font-medium'
              : !hasContent
              ? 'opacity-50 cursor-not-allowed'
              : 'hover:bg-background/50'
          }`}
          title={!hasContent ? '请先在编辑器中写入或生成内容' : ''}
        >
          <Play className="h-3 w-3 inline mr-1" />
          续写
        </button>
        <button
          onClick={() => setMode('rewrite')}
          disabled={!hasContent && !selectedText}
          className={`flex-1 px-3 py-1.5 text-xs rounded-md transition-colors ${
            mode === 'rewrite'
              ? 'bg-background shadow-sm font-medium'
              : !hasContent && !selectedText
              ? 'opacity-50 cursor-not-allowed'
              : 'hover:bg-background/50'
          }`}
          title={!hasContent && !selectedText ? '请先在编辑器中写入或生成内容' : ''}
        >
          <RefreshCw className="h-3 w-3 inline mr-1" />
          重写
        </button>
      </div>

      {!hasContent && mode !== 'generate' && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          请先在编辑器中写入或生成内容
        </p>
      )}

      <p className="text-[11px] text-muted-foreground italic">
        {getModeDescription()}
      </p>

      {mode === 'continue' && hasContent && (
        <div className="space-y-1.5 p-3 bg-muted/50 rounded-lg border">
          <label className="text-xs font-medium text-muted-foreground">
            本次续写目标字数
          </label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={TARGET_WORDS_MIN}
              max={TARGET_WORDS_MAX}
              value={targetWords}
              onChange={(e) => {
                const v = parseInt(e.target.value)
                if (!isNaN(v)) {
                  setTargetWords(Math.min(TARGET_WORDS_MAX, Math.max(TARGET_WORDS_MIN, v)))
                }
              }}
              className="h-7 w-24 text-xs"
            />
            <span className="text-xs text-muted-foreground">字</span>
          </div>
          <p className="text-[10px] text-muted-foreground">
            范围 {TARGET_WORDS_MIN} ~ {TARGET_WORDS_MAX}
          </p>
        </div>
      )}

      <ContextPreview
        contextBundle={contextInfo}
        isGenerating={status === 'generating'}
        toolCalls={toolCalls}
      />

      <div className="flex gap-2">
        {status === 'generating' ? (
          <Button
            variant="destructive"
            size="sm"
            className="gap-2 flex-1"
            onClick={stop}
          >
            <Square className="h-4 w-4" />
            停止生成
          </Button>
        ) : (
          <Button
            size="sm"
            className="gap-2 flex-1"
            onClick={mode === 'rewrite' ? handleRewriteClick : handleGenerate}
            disabled={isGenerateButtonDisabled() || coherenceChecking}
          >
            {coherenceChecking ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                正在检查一致性...
              </>
            ) : (
              <>
                <PenLine className="h-4 w-4" />
                {getButtonText()}
              </>
            )}
          </Button>
        )}
      </div>

      <StreamOutput content={output} status={status} usage={usage} />

      {repairedContent && status === 'done' && (
        <RepairDiffPanel
          originalContent={output}
          repairedContent={repairedContent}
          originalScore={repairInfo?.originalScore ?? 0}
          issues={repairInfo?.issues ?? []}
          onAccept={handleAcceptRepair}
          onDismiss={clearRepair}
        />
      )}

      {/* 生成完成 或 重写模式：显示结果和检查区域 */}
      {(status === 'done' && output) || (mode === 'rewrite' && hasContent) ? (
        <div className="space-y-2">
          {status === 'done' && output && (
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-2"
              onClick={handleInsert}
              disabled={isInserting}
            >
              {isInserting ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  写入中...
                </>
              ) : (
                <>
                  <PenLine className="h-4 w-4" />
                  写入编辑器
                </>
              )}
            </Button>
          )}

          {/* 质量检查区域 */}
          {hasContent && (
            <div className="space-y-2 pt-2 border-t">
              {/* 最新检查结果摘要 */}
              {latestCheckLog && (
                <div className="flex items-center justify-between p-2.5 bg-muted/40 rounded-lg text-xs group hover:bg-muted/60 transition-colors">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {latestCheckLog.checkType === 'character_consistency' && '角色'}
                      {latestCheckLog.checkType === 'chapter_coherence' && '连贯性'}
                      {latestCheckLog.checkType === 'combined' && '综合'}
                    </Badge>
                    <span className={`font-semibold ${
                      latestCheckLog.score >= 80 ? 'text-green-600' :
                      latestCheckLog.score >= 60 ? 'text-amber-600' :
                      'text-red-600'
                    }`}>
                      {latestCheckLog.score}分
                    </span>
                    <span className="text-muted-foreground truncate ml-1">
                      {latestCheckLog.issuesCount > 0 ? `${latestCheckLog.issuesCount}个问题` : '✓ 通过'}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[10px] px-1.5"
                      onClick={() => loadCheckHistory()}
                    >
                      历史
                    </Button>
                    {(latestCheckLog.checkType === 'chapter_coherence' || latestCheckLog.checkType === 'combined') &&
                     latestCheckLog.coherenceResult?.issues?.length > 0 && (
                      <Button
                        variant="default"
                        size="sm"
                        className="h-6 text-[10px] px-2 bg-blue-600 hover:bg-blue-700"
                        onClick={() => {
                          if (latestCheckLog.coherenceResult) {
                            setCoherenceResult({
                              score: latestCheckLog.coherenceResult.score,
                              issues: latestCheckLog.coherenceResult.issues,
                            })
                            setRewriteDialogOpen(true)
                          }
                        }}
                      >
                        重写
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/* 三个检查按钮 - 紧凑横向布局 */}
              <div className="grid grid-cols-3 gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className={`gap-1 h-7 text-[11px] transition-all ${
                    showConsistencyCheck ? 'bg-primary/10 border-primary' : ''
                  }`}
                  onClick={() => {
                    setShowConsistencyCheck(!showConsistencyCheck)
                    setShowCoherenceCheck(false)
                    setShowCombinedCheck(false)
                  }}
                >
                  <Shield className="h-3 w-3" />
                  角色一致性
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  className={`gap-1 h-7 text-[11px] transition-all ${
                    showCoherenceCheck ? 'bg-primary/10 border-primary' : ''
                  }`}
                  onClick={() => {
                    setShowCoherenceCheck(!showCoherenceCheck)
                    setShowConsistencyCheck(false)
                    setShowCombinedCheck(false)
                  }}
                >
                  <Link className="h-3 w-3" />
                  章节连贯性
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  className={`gap-1 h-7 text-[11px] transition-all ${
                    showCombinedCheck ? 'bg-primary/10 border-primary' : ''
                  }`}
                  onClick={() => {
                    setShowCombinedCheck(!showCombinedCheck)
                    setShowConsistencyCheck(false)
                    setShowCoherenceCheck(false)
                  }}
                >
                  <Shield className="h-3 w-3" />
                  <Link className="h-3 w-3 -ml-0.5" />
                  综合检查
                </Button>
              </div>

              {/* 检查历史列表 */}
              {showCheckHistory && (
                <ScrollArea className="max-h-40 rounded-lg border bg-muted/20">
                  <div className="p-2 space-y-1">
                    {checkHistory.map((log) => (
                      <button
                        key={log.id}
                        className={`w-full flex items-center justify-between p-2 rounded text-xs text-left transition-colors hover:bg-background ${
                          log.id === latestCheckLog?.id ? 'bg-primary/5 ring-1 ring-primary/20' : ''
                        }`}
                        onClick={() => {
                          setLatestCheckLog(log)
                          setShowCheckHistory(false)
                        }}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Badge variant="outline" className="text-[9px] shrink-0">
                            {log.checkType === 'character_consistency' && '角色'}
                            {log.checkType === 'chapter_coherence' && '连贯'}
                            {log.checkType === 'combined' && '综合'}
                          </Badge>
                          <span className={`font-medium ${
                            log.score >= 80 ? 'text-green-600' :
                            log.score >= 60 ? 'text-amber-600' : 'text-red-600'
                          }`}>
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
              )}

              {/* 展开的检查面板 */}
              {(showConsistencyCheck || showCoherenceCheck || showCombinedCheck) && (
                <div className="border rounded-lg overflow-hidden bg-muted/20">
                  {showConsistencyCheck && (
                    <CharacterConsistencyCheck chapterId={chapterId} novelId={novelId} />
                  )}
                  {showCoherenceCheck && (
                    <ChapterCoherenceCheck
                      chapterId={chapterId}
                      novelId={novelId}
                      onCheckComplete={(result) => {
                        setCoherenceResult(result)
                        loadLatestCheckLog()
                      }}
                    />
                  )}
                  {showCombinedCheck && (
                    <CombinedCheck
                      chapterId={chapterId}
                      novelId={novelId}
                      onCheckComplete={(result) => {
                        if (result.coherenceCheck.issues.length > 0) {
                          setCoherenceResult({
                            score: result.coherenceCheck.score,
                            issues: result.coherenceCheck.issues,
                          })
                        }
                        loadLatestCheckLog()
                      }}
                    />
                  )}
                </div>
              )}

              {contextInfo?.debug && (
                <div className="text-[10px] text-center text-muted-foreground py-1.5 px-2 bg-green-50 dark:bg-green-950 rounded border border-green-200 dark:border-green-800">
                  ✓ 自动摘要已生成 · RAG: {contextInfo.debug.ragHitsCount}条 · ({contextInfo.debug.buildTimeMs}ms)
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}

      {toolCalls && toolCalls.length > 0 && status === 'generating' && (
        <div className="space-y-1 mt-2">
          <p className="text-[11px] font-medium text-muted-foreground mb-1">工具执行过程：</p>
          {toolCalls.map((toolCall, index) => (
            <div
              key={index}
              className={`text-[10px] p-1.5 rounded border ${
                toolCall.status === 'running'
                  ? 'bg-yellow-50 dark:bg-yellow-950 border-yellow-200 dark:border-yellow-800 animate-pulse'
                  : 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800'
              }`}
            >
              <span className="font-medium">{toolCall.name}</span>
              <span className="ml-1 opacity-70">
                {toolCall.status === 'running' ? '⏳ 执行中...' : '✓ 完成'}
              </span>
              {toolCall.result && (
                <div className="mt-0.5 opacity-60 truncate">
                  {toolCall.result}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <AlertDialog open={rewriteDialogOpen} onOpenChange={setRewriteDialogOpen}>
        <AlertDialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <AlertDialogHeader className="flex-shrink-0">
            <AlertDialogTitle>重写前质量检查报告</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="text-left">
                {isChecking ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin mr-2 text-primary" />
                    <span className="text-sm text-muted-foreground">正在执行综合质量检查...</span>
                  </div>
                ) : coherenceCheckFailed ? (
                  <div className="py-4 text-center">
                    <p className="text-sm text-amber-600 dark:text-amber-400 mb-3">
                      质量检查失败
                    </p>
                    <Button variant="outline" size="sm" onClick={handleRecheck}>
                      重新检查
                    </Button>
                  </div>
                ) : combinedReport ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                      <div className="flex items-baseline gap-3">
                        <span className="text-sm font-medium">综合评分:</span>
                        <span className={`text-2xl font-bold ${
                          combinedReport.score >= 80 ? 'text-green-600' :
                          combinedReport.score >= 60 ? 'text-amber-600' :
                          'text-red-600'
                        }`}>
                          {combinedReport.score}/100
                        </span>
                      </div>
                      <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" onClick={handleRecheck}>
                        <RefreshCw className="h-3 w-3" />
                        重新检查
                      </Button>
                    </div>

                    <ScrollArea className="max-h-[50vh] pr-3">
                      <div className="space-y-4">
                        {/* 角色一致性部分 */}
                        {(combinedReport.characterResult?.conflicts?.length > 0 || combinedReport.characterResult?.warnings?.length > 0) && (
                          <div className="space-y-2">
                            <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                              <Shield className="h-3.5 w-3.5" />
                              角色一致性检查
                              <Badge variant={combinedReport.characterResult.conflicts.length > 0 ? 'destructive' : 'default'} className="text-[10px]">
                                {combinedReport.characterResult.conflicts.length > 0 ? `${combinedReport.characterResult.conflicts.length}个冲突` : '通过'}
                              </Badge>
                            </h5>

                            {combinedReport.characterResult.conflicts.map((conflict: any, i: number) => (
                              <div key={`char-c-${i}`} className="p-2.5 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg text-xs space-y-1">
                                <div className="font-medium text-red-700 dark:text-red-300 flex items-center gap-1.5">
                                  <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                                  {conflict.characterName}
                                </div>
                                <p className="text-red-600 dark:text-red-400 pl-5">{conflict.conflict}</p>
                                {conflict.excerpt && (
                                  <p className="pl-5 italic text-muted-foreground border-l-2 border-red-300 ml-2">"{conflict.excerpt}"</p>
                                )}
                              </div>
                            ))}

                            {combinedReport.characterResult.warnings?.filter((w: string) => !w.includes('失败')).map((warning: string, i: number) => (
                              <div key={`char-w-${i}`} className="p-2 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded text-xs flex items-start gap-2 text-amber-700 dark:text-amber-300">
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                                {warning}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* 章节连贯性部分 */}
                        {combinedReport.coherenceResult?.issues?.length > 0 && (
                          <div className="space-y-2">
                            <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                              <Link className="h-3.5 w-3.5" />
                              章节连贯性检查
                              <Badge variant="outline" className="text-[10px]">
                                {combinedReport.coherenceResult.score}分 · {combinedReport.coherenceResult.issues.length}个问题
                              </Badge>
                            </h5>

                            {combinedReport.coherenceResult.issues.map((issue: any, i: number) => (
                              <div key={`coh-${i}`} className={`p-2.5 rounded-lg border text-xs space-y-1 ${
                                issue.severity === 'error'
                                  ? 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800'
                                  : 'bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800'
                              }`}>
                                <div className="font-medium flex items-center gap-1.5">
                                  {issue.severity === 'error' ? (
                                    <>
                                      <ShieldAlert className="h-3.5 w-3.5 text-red-500" />
                                      <span className="text-red-700 dark:text-red-300">错误{i + 1}</span>
                                    </>
                                  ) : (
                                    <>
                                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                                      <span className="text-amber-700 dark:text-amber-300">警告{i + 1}</span>
                                    </>
                                  )}
                                  <Badge variant="outline" className="text-[9px] ml-auto">{issue.category || '其他'}</Badge>
                                </div>
                                <p className={
                                  issue.severity === 'error'
                                    ? 'text-red-600 dark:text-red-400'
                                    : 'text-amber-600 dark:text-amber-400'
                                }>{issue.message}</p>
                                {issue.suggestion && (
                                  <p className="text-muted-foreground pl-4">→ 建议：{issue.suggestion}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {!combinedReport.characterResult?.conflicts?.length &&
                         !combinedReport.characterResult?.warnings?.filter((w: string) => !w.includes('失败'))?.length &&
                         !combinedReport.coherenceResult?.issues?.length && (
                          <div className="flex items-center gap-2 p-4 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-700 dark:text-green-300">
                            <CheckCircle className="h-5 w-5 shrink-0" />
                            恭喜！角色一致性和章节连贯性均未发现问题，可以放心重写。
                          </div>
                        )}
                      </div>
                    </ScrollArea>

                    {(combinedReport.characterResult?.conflicts?.length > 0 ||
                     combinedReport.coherenceResult?.issues?.some((i: any) => i.severity === 'error')) && (
                      <p className="text-[11px] text-muted-foreground text-center pt-2 border-t">
                        重写时将自动带入以上问题进行针对性优化
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    暂无报告数据
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-shrink-0">
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRewriteConfirm}
              disabled={isChecking}
              className="gap-2"
            >
              {isChecking ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  检查中...
                </>
              ) : (
                <>
                  确认，开始重写
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
