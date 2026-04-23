import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Square, PenLine, Brain, Shield, RefreshCw, Play, Loader2 } from 'lucide-react'
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
  const [isInserting, setIsInserting] = useState(false)
  const [mode, setMode] = useState<GenerationMode>('generate')
  const [selectedText] = useState<string>('')
  const [targetWords, setTargetWords] = useState(TARGET_WORDS_DEFAULT)

  const [rewriteDialogOpen, setRewriteDialogOpen] = useState(false)
  const [coherenceChecking, setCoherenceChecking] = useState(false)
  const [coherenceResult, setCoherenceResult] = useState<CoherenceCheckResult | null>(null)
  const [coherenceCheckFailed, setCoherenceCheckFailed] = useState(false)

  const hasContent = existingContent.trim().length > 0

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
    setCoherenceChecking(true)
    setCoherenceResult(null)
    setCoherenceCheckFailed(false)

    try {
      const res = await fetch('/api/generate/coherence-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chapterId, novelId }),
      })
      if (!res.ok) throw new Error('检查请求失败')
      const data = await res.json()
      setCoherenceResult({ score: data.score ?? 0, issues: data.issues ?? [] })
    } catch {
      setCoherenceCheckFailed(true)
    } finally {
      setCoherenceChecking(false)
      setRewriteDialogOpen(true)
    }
  }

  const handleRewriteConfirm = () => {
    setRewriteDialogOpen(false)
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

      {status === 'done' && output && (
        <div className="space-y-2">
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

          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2"
            onClick={() => setShowConsistencyCheck(!showConsistencyCheck)}
          >
            <Shield className="h-4 w-4" />
            角色一致性检查
          </Button>

          {showConsistencyCheck && (
            <CharacterConsistencyCheck chapterId={chapterId} novelId={novelId} />
          )}

          {contextInfo?.debug && (
            <div className="text-[10px] text-center text-muted-foreground p-2 bg-green-50 dark:bg-green-950 rounded border border-green-200 dark:border-green-800">
              ✓ 自动摘要已生成 · 使用了 {contextInfo.debug.ragHitsCount} 条 RAG 资料
              {contextInfo.debug.summaryChainLength !== undefined && (
                <> · 摘要链长度: {contextInfo.debug.summaryChainLength}</>
              )}
              ({contextInfo.debug.buildTimeMs}ms)
            </div>
          )}
        </div>
      )}

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
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>重写前一致性报告</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-left">
                {coherenceCheckFailed ? (
                  <div className="space-y-2">
                    <p className="text-sm text-amber-600 dark:text-amber-400">
                      一致性检查失败，是否仍然继续重写？
                    </p>
                  </div>
                ) : coherenceResult && coherenceResult.issues.length > 0 ? (
                  <>
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm">当前评分:</span>
                      <span className={`text-lg font-bold ${
                        coherenceResult.score >= 80 ? 'text-green-600' :
                        coherenceResult.score >= 60 ? 'text-amber-600' :
                        'text-red-600'
                      }`}>
                        {coherenceResult.score}/100
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {coherenceResult.issues.map((issue, idx) => (
                        <div
                          key={idx}
                          className={`text-xs p-2 rounded border ${
                            issue.severity === 'error'
                              ? 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800'
                              : 'bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800'
                          }`}
                        >
                          <span className="font-medium">
                            {issue.severity === 'error' ? '✗' : '△'}{' '}
                            {issue.severity === 'error' ? '错误' : '警告'}{idx + 1}:
                          </span>{' '}
                          {issue.message}
                          {issue.suggestion && (
                            <p className="mt-0.5 opacity-70">建议：{issue.suggestion}</p>
                          )}
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      重写建议优先修复以上问题。
                    </p>
                  </>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm">当前评分:</span>
                      <span className="text-lg font-bold text-green-600">
                        {coherenceResult?.score ?? 100}/100
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      一致性检查未发现问题，可以放心重写。
                    </p>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleRewriteConfirm}>
              确认，开始重写
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
