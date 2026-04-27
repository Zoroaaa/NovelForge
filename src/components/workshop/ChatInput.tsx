import { useRef } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Send, Loader2 } from 'lucide-react'
import { STAGES } from './types'

interface ChatInputProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  isGenerating: boolean
  stage: string
}

export function ChatInput({ value, onChange, onSend, isGenerating, stage }: ChatInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const stageInfo = STAGES.find((s) => s.id === stage)

  return (
    <div className="border-t p-4 bg-background/50 backdrop-blur-sm">
      <div className="max-w-3xl mx-auto flex gap-3">
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && onSend()}
          placeholder={
            isGenerating
              ? 'AI 正在回复中...'
              : stageInfo?.description || '输入你的想法...'
          }
          disabled={isGenerating}
          className="flex-1 h-10"
        />
        <Button
          onClick={onSend}
          disabled={!value.trim() || isGenerating}
          size="icon"
          className="h-10 w-10"
        >
          {isGenerating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  )
}
