/**
 * @file ChatMessageList.tsx
 * @description 对话消息列表 - 展示AI对话历史，支持Markdown渲染和代码高亮
 * @date 2026-05-04
 */
import { useRef, useEffect } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Loader2 } from 'lucide-react'
import type { WorkshopMessage } from './types'

interface ChatMessageListProps {
  messages: WorkshopMessage[]
  isGenerating: boolean
}

export function ChatMessageList({ messages, isGenerating }: ChatMessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesLength = messages.length

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messagesLength, isGenerating])

  return (
    <ScrollArea className="flex-1 p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted'
              }`}
            >
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
            </div>
          </div>
        ))}

        {isGenerating && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-2xl px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                AI 正在思考...
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
    </ScrollArea>
  )
}
