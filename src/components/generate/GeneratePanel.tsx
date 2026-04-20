import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Square, PenLine, Brain, Shield } from 'lucide-react'
import { useGenerate } from '@/hooks/useGenerate'
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
}

export function GeneratePanel({
  novelId,
  chapterId,
  chapterTitle,
  onInsertContent,
  onContextUpdate,
}: GeneratePanelProps) {
  const { output, status, generate, stop, contextInfo, toolCalls } = useGenerate()
  const [showConsistencyCheck, setShowConsistencyCheck] = useState(false)

  const handleInsert = () => {
    if (output) {
      onInsertContent(output)
    }
  }

  // 当上下文信息更新时通知父组件
  if (onContextUpdate && contextInfo) {
    onContextUpdate(contextInfo)
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
            onClick={() => generate(chapterId, novelId)}
          >
            <PenLine className="h-4 w-4" />
            智能生成内容
          </Button>
        )}
      </div>

      <StreamOutput content={output} status={status} />

      {status === 'done' && output && (
        <div className="space-y-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2"
            onClick={handleInsert}
          >
            <PenLine className="h-4 w-4" />
            写入编辑器
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
              ({contextInfo.debug.buildTimeMs}ms)
            </div>
          )}
        </div>
      )}
    </div>
  )
}
