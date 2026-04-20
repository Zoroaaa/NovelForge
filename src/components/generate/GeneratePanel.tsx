import { Button } from '@/components/ui/button'
import { Square, PenLine } from 'lucide-react'
import { useGenerate } from '@/hooks/useGenerate'
import { StreamOutput } from './StreamOutput'

interface GeneratePanelProps {
  novelId: string
  chapterId: string
  chapterTitle: string
  onInsertContent: (content: string) => void
}

export function GeneratePanel({ novelId, chapterId, chapterTitle, onInsertContent }: GeneratePanelProps) {
  const { output, status, generate, stop } = useGenerate()

  const handleInsert = () => {
    if (output) {
      onInsertContent(output)
    }
  }

  return (
    <div className="p-4 space-y-4">
      <div className="space-y-2">
        <h3 className="font-semibold text-sm">AI 生成</h3>
        <p className="text-xs text-muted-foreground">当前章节：{chapterTitle}</p>
      </div>

      <div className="flex gap-2">
        {status === 'generating' ? (
          <Button variant="destructive" size="sm" className="gap-2 flex-1" onClick={stop}>
            <Square className="h-4 w-4" />
            停止生成
          </Button>
        ) : (
          <Button size="sm" className="gap-2 flex-1" onClick={() => generate(chapterId, novelId)}>
            <PenLine className="h-4 w-4" />
            生成内容
          </Button>
        )}
      </div>

      <StreamOutput content={output} status={status} />

      {status === 'done' && output && (
        <Button variant="outline" size="sm" className="w-full gap-2" onClick={handleInsert}>
          <PenLine className="h-4 w-4" />
          写入编辑器
        </Button>
      )}
    </div>
  )
}
