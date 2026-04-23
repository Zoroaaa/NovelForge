/**
 * @file GeneratePanel.tsx
 * @description AI生成面板组件，提供章节生成、续写、重写等功能，支持上下文预览和角色一致性检查
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Square, PenLine, Brain, Shield, RefreshCw, Play } from 'lucide-react'
import { useGenerate } from '@/hooks/useGenerate'
import { RepairDiffPanel } from './RepairDiffPanel'
import { StreamOutput } from './StreamOutput'
import {
  ContextPreview,
  type ContextBundle,
} from './ContextPreview'
import { CharacterConsistencyCheck } from './CharacterConsistencyCheck'

/**
 * AI生成面板组件属性
 */
interface GeneratePanelProps {
  /** 小说ID */
  novelId: string
  /** 章节ID */
  chapterId: string
  /** 章节标题 */
  chapterTitle: string
  /** 内容插入回调 */
  onInsertContent: (content: string) => void
  /** 上下文更新回调 */
  onContextUpdate?: (context: ContextBundle | null) => void
  /** 当前编辑器中的已有内容（用于续写/重写模式） */
  existingContent?: string
}

type GenerationMode = 'generate' | 'continue' | 'rewrite'

/**
 * AI生成面板组件
 * @description 提供章节生成、续写、重写功能，支持上下文预览和角色一致性检查
 * @param {GeneratePanelProps} props - 组件属性
 * @returns {JSX.Element} 生成面板组件
 */
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

  const handleAcceptRepair = (content: string) => {
    onInsertContent(content)
    clearRepair()
  }

  // Phase 1.6: 生成模式状态
  const [mode, setMode] = useState<GenerationMode>('generate')
  const [selectedText] = useState<string>('')  // 重写模式的选中文本

  const handleInsert = () => {
    if (output && !isInserting) {
      setIsInserting(true)
      onInsertContent(output)
      setTimeout(() => {
        setIsInserting(false)
      }, 2000)
    }
  }

  // 当上下文信息更新时通知父组件
  if (onContextUpdate && contextInfo) {
    onContextUpdate(contextInfo)
  }

  // Phase 1.6: 处理生成请求
  const handleGenerate = () => {
    const options: any = { mode }
    
    if (mode === 'continue' && existingContent) {
      options.existingContent = existingContent
    }
    
    if (mode === 'rewrite' && selectedText) {
      options.existingContent = selectedText
    } else if (mode === 'rewrite' && existingContent) {
      options.existingContent = existingContent
    }

    generate(chapterId, novelId, options)
  }

  // Phase 1.6: 获取当前模式的描述文本
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

  // Phase 1.6: 获取当前模式的按钮文本
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

      {/* Phase 1.6: 模式切换 Tab */}
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
          disabled={!existingContent}
          className={`flex-1 px-3 py-1.5 text-xs rounded-md transition-colors ${
            mode === 'continue'
              ? 'bg-background shadow-sm font-medium'
              : !existingContent
              ? 'opacity-50 cursor-not-allowed'
              : 'hover:bg-background/50'
          }`}
        >
          <Play className="h-3 w-3 inline mr-1" />
          续写
        </button>
        <button
          onClick={() => setMode('rewrite')}
          disabled={!existingContent && !selectedText}
          className={`flex-1 px-3 py-1.5 text-xs rounded-md transition-colors ${
            mode === 'rewrite'
              ? 'bg-background shadow-sm font-medium'
              : !existingContent && !selectedText
              ? 'opacity-50 cursor-not-allowed'
              : 'hover:bg-background/50'
          }`}
        >
          <RefreshCw className="h-3 w-3 inline mr-1" />
          重写
        </button>
      </div>

      {/* Phase 1.6: 模式描述 */}
      <p className="text-[11px] text-muted-foreground italic">
        {getModeDescription()}
      </p>

      {/* Phase 2 Context Preview */}
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
            onClick={handleGenerate}
            disabled={
              (mode === 'continue' || mode === 'rewrite') && 
              !existingContent && 
              !selectedText
            }
          >
            <PenLine className="h-4 w-4" />
            {getButtonText()}
          </Button>
        )}
      </div>

      <StreamOutput content={output} status={status} usage={usage} />

      {/* 自动修复 Diff 面板 */}
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

          {/* 一致性检查按钮 */}
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

          {/* 生成完成提示 */}
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

      {/* Phase 1.6: 工具调用过程展示 */}
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
