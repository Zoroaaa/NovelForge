import React from 'react'
import { ShieldAlert, BookOpen, Zap, Users, Target, Globe, Lightbulb } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { WritingRule } from './types'

interface PreviewWritingRulesProps {
  rules: WritingRule[]
}

const categoryMap: Record<string, { label: string; color: string; icon: React.ComponentType<{ className?: string }> }> = {
  style: { label: '文风', color: 'bg-blue-500/10 text-blue-600', icon: BookOpen },
  pacing: { label: '节奏', color: 'bg-green-500/10 text-green-600', icon: Zap },
  character: { label: '角色', color: 'bg-purple-500/10 text-purple-600', icon: Users },
  plot: { label: '情节', color: 'bg-orange-500/10 text-orange-600', icon: Target },
  world: { label: '世界观', color: 'bg-cyan-500/10 text-cyan-600', icon: Globe },
  taboo: { label: '禁忌', color: 'bg-red-500/10 text-red-600', icon: ShieldAlert },
  custom: { label: '自定义', color: 'bg-gray-500/10 text-gray-600', icon: Lightbulb },
}

export function PreviewWritingRules({ rules }: PreviewWritingRulesProps) {
  if (!rules || rules.length === 0) return null

  return (
    <div className="rounded-lg border bg-background p-4 space-y-3">
      <h4 className="text-sm font-semibold flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-primary" />
        创作规则
      </h4>
      <div className="grid gap-2">
        {rules.map((rule, i) => {
          const cat = categoryMap[rule.category] || categoryMap.custom
          const CatIcon = cat.icon
          const contentLen = rule.content?.length || 0
          const isQualityRule = contentLen >= 50

          return (
            <div
              key={i}
              className={`rounded-md border p-2.5 space-y-1 ${
                isQualityRule ? 'border-primary/30 bg-primary/[0.02]' : 'border-muted'
              }`}
            >
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <CatIcon className={`h-3.5 w-3.5 ${cat.color.split(' ')[1]}`} />
                <span className="font-medium text-sm">{rule.title}</span>
                <Badge variant="outline" className={`text-[10px] ${cat.color}`}>{cat.label}</Badge>
                {rule.priority != null && (
                  <Badge
                    variant={rule.priority <= 1 ? 'destructive' : rule.priority === 2 ? 'default' : 'secondary'}
                    className="text-[10px]"
                  >
                    P{rule.priority}
                  </Badge>
                )}
                {isQualityRule && (
                  <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-300">
                    ✓ 有效规则
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-4">{rule.content}</p>
              {!isQualityRule && (
                <p className="text-[10px] text-amber-500/70">⚠ 规则内容偏短，建议补充具体约束条件</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
