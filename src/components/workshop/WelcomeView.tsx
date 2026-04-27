import { MessageSquare, Plus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { STAGES, type Stage } from './types'

interface WelcomeViewProps {
  onStartChat: () => void
  isPending: boolean
}

export function WelcomeView({ onStartChat, isPending }: WelcomeViewProps) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="text-center space-y-6 max-w-md">
        <div className="mx-auto w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/20 via-purple-500/10 to-pink-500/20 flex items-center justify-center shadow-lg">
          <MessageSquare className="h-10 w-10 text-primary" />
        </div>

        <div className="space-y-2">
          <h2 className="text-2xl font-bold">AI 创作助手</h2>
          <p className="text-muted-foreground leading-relaxed">
            通过多轮对话，帮我整理你的创意，<br />生成完整的小说框架。
          </p>
        </div>

        <div className="pt-4">
          <p className="text-sm font-medium text-left text-muted-foreground mb-3">创作流程：</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {STAGES.map((s: Stage, idx: number) => (
              <div
                key={s.id}
                className={`flex items-start gap-3 p-3 rounded-xl border transition-all ${
                  idx === 0
                    ? 'bg-primary/5 border-primary/30 shadow-sm'
                    : 'bg-muted/30 border-transparent hover:border-border'
                }`}
              >
                <s.icon
                  className={`h-5 w-5 mt-0.5 shrink-0 ${
                    idx === 0 ? 'text-primary' : 'text-muted-foreground'
                  }`}
                />
                <div className="text-left min-w-0">
                  <p className="font-medium text-sm">{s.label}</p>
                  <p className="text-xs text-muted-foreground">{s.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <Button
          size="lg"
          onClick={onStartChat}
          disabled={isPending}
          className="w-full mt-4"
        >
          {isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              正在创建会话...
            </>
          ) : (
            <>
              <Plus className="h-4 w-4 mr-2" />
              开始新的创作对话
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
