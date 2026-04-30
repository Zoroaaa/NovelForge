/**
 * @file GeneratePanel.tsx
 * @description AI 生成面板组件，提供章节生成、续写、重写功能
 */
import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Square,
  PenLine,
  Brain,
  Play,
  Loader2,
  RefreshCw,
  MessageSquare,
  CloudUpload,
} from 'lucide-react'
import { useGenerate } from '@/hooks/useGenerate'
import { StreamOutput } from './StreamOutput'
import {
  ContextPreview,
  type ContextBundle,
} from './ContextPreview'
import { api } from '@/lib/api'

interface GeneratePanelProps {
  novelId: string
  chapterId: string
  chapterTitle: string
  onInsertContent: (content: string, insertMode?: 'replace' | 'append') => void
  onContextUpdate?: (context: ContextBundle | null) => void
  existingContent?: string
}

type GenerationMode = 'generate' | 'continue' | 'rewrite'

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
  const { output, status, generate, stop, contextInfo, toolCalls, usage, queueStatus, generateQueue } = useGenerate()
  const [isInserting, setIsInserting] = useState(false)
  const [mode, setMode] = useState<GenerationMode>('generate')
  const [selectedText] = useState<string>('')
  const [targetWords, setTargetWords] = useState(TARGET_WORDS_DEFAULT)
  const [rewriteInstruction, setRewriteInstruction] = useState('')
  const [systemPrompt, setSystemPrompt] = useState<string>('')
  const [draftMode, setDraftMode] = useState(false)

  useEffect(() => {
    if (novelId) {
      api.novels.get(novelId).then(novel => {
        if (novel?.systemPrompt) {
          setSystemPrompt(novel.systemPrompt)
        }
      }).catch(() => {})
    }
  }, [novelId])

  const hasContent = existingContent.trim().length > 0

  const handleInsert = () => {
    if (output && !isInserting) {
      setIsInserting(true)
      const insertMode: 'replace' | 'append' = mode === 'continue' ? 'append' : 'replace'
      onInsertContent(output, insertMode)
      setTimeout(() => {
        setIsInserting(false)
      }, 2000)
    }
  }

  if (onContextUpdate && contextInfo) {
    onContextUpdate(contextInfo)
  }

  const handleGenerate = () => {
    const options: any = { mode, draftMode }

    if (mode === 'continue' && hasContent) {
      options.existingContent = existingContent
      options.targetWords = targetWords
    }

    if (mode === 'rewrite') {
      if (selectedText) {
        options.existingContent = selectedText
      } else if (hasContent) {
        options.existingContent = existingContent
      }

      // 如果用户填写了重写要求，将其作为 issuesContext 传递给 AI
      if (rewriteInstruction.trim()) {
        options.issuesContext = [`用户重写要求：${rewriteInstruction.trim()}`]
      }
    }

    generate(chapterId, novelId, options)
  }

  const handleGenerateQueue = () => {
    const options: any = { mode }

    if (mode === 'continue' && hasContent) {
      options.existingContent = existingContent
      options.targetWords = targetWords
    }

    if (mode === 'rewrite') {
      if (selectedText) {
        options.existingContent = selectedText
      } else if (hasContent) {
        options.existingContent = existingContent
      }

      // 如果用户填写了重写要求，将其作为 issuesContext 传递给 AI
      if (rewriteInstruction.trim()) {
        options.issuesContext = [`用户重写要求：${rewriteInstruction.trim()}`]
      }
    }

    generateQueue(chapterId, novelId, options)
  }

  const getModeDescription = (): string => {
    switch (mode) {
      case 'continue':
        return '基于当前章节末尾内容继续创作，保持文风和情节连贯'
      case 'rewrite':
        return rewriteInstruction.trim()
          ? `根据您的自定义要求进行重写：${rewriteInstruction.trim().slice(0, 50)}...`
          : selectedText
          ? '对选中文本进行改写优化'
          : '对当前内容进行改写，可在下方填写您的具体要求'
      default:
        return '基于大纲和上下文从零开始创作本章内容'
    }
  }

  const getButtonText = (): string => {
    switch (mode) {
      case 'continue':
        return '续写内容'
      case 'rewrite':
        return rewriteInstruction.trim() ? '按要求重写' : '重写内容'
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
    <div className="p-1 space-y-5">
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

      <div className="flex items-center gap-2 px-1">
        <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
          <input
            type="checkbox"
            checked={draftMode}
            onChange={(e) => setDraftMode(e.target.checked)}
            className="rounded border-gray-300"
          />
          <span className="text-muted-foreground">草稿模式</span>
        </label>
        {draftMode && (
          <span className="text-[10px] text-amber-600 dark:text-amber-400">
            跳过摘要/伏笔提取等后处理
          </span>
        )}
      </div>

      {!hasContent && mode !== 'generate' && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          请先在编辑器中写入或生成内容
        </p>
      )}

      {/* 重写模式：显示需求输入框 */}
      {mode === 'rewrite' && hasContent && (
        <div className="space-y-2 p-3 bg-blue-50/50 dark:bg-blue-950/20 rounded-lg border border-blue-200/60 dark:border-blue-800/30">
          <label className="text-xs font-medium text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
            <MessageSquare className="h-3.5 w-3.5" />
            重写要求（可选）
          </label>
          <Textarea
            value={rewriteInstruction}
            onChange={(e) => setRewriteInstruction(e.target.value)}
            placeholder={
              '请描述您希望如何重写这段内容，例如：\n' +
              '- 让对话更加生动自然\n' +
              '- 增加环境描写和氛围渲染\n' +
              '- 调整语气，使其更符合角色性格\n' +
              '- 优化段落结构，提升可读性\n\n' +
              '留空则使用 AI 默认的重写策略'
            }
            className="min-h-[100px] max-h-[200px] text-xs resize-y"
          />
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-muted-foreground">
              {rewriteInstruction.length > 0
                ? `已输入 ${rewriteInstruction.length} 字`
                : '可直接点击"按要求重写"按钮，AI 将自动优化内容'}
            </p>
            {rewriteInstruction.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] px-2 text-muted-foreground hover:text-destructive"
                onClick={() => setRewriteInstruction('')}
              >
                清空
              </Button>
            )}
          </div>
        </div>
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
        systemPrompt={systemPrompt}
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
          <>
            <Button
              size="sm"
              className="gap-2 flex-1"
              onClick={handleGenerate}
              disabled={isGenerateButtonDisabled()}
            >
              <PenLine className="h-4 w-4" />
              {getButtonText()}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={handleGenerateQueue}
              disabled={isGenerateButtonDisabled() || queueStatus === 'submitting' || queueStatus === 'submitted'}
              title="提交到后台队列生成，可关闭页面"
            >
              {queueStatus === 'submitting' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : queueStatus === 'submitted' ? (
                <Play className="h-4 w-4 text-green-600" />
              ) : (
                <CloudUpload className="h-4 w-4" />
              )}
              {queueStatus === 'submitting' ? '提交中...' : queueStatus === 'submitted' ? '已提交' : '后台生成'}
            </Button>
          </>
        )}
      </div>

      <StreamOutput content={output} status={status} usage={usage} />

      {/* 生成完成：显示写入按钮 */}
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
    </div>
  )
}
