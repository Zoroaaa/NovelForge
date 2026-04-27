import React from 'react'
import { Users, Heart, MessageCircle, Eye, BookOpen, Target, ShieldAlert, Link2, Sword } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { Character } from './types'

interface PreviewCharactersProps {
  characters: Character[]
}

const roleConfig: Record<string, { label: string; badgeVariant: 'default' | 'destructive' | 'secondary'; emoji: string }> = {
  protagonist: { label: '主角', badgeVariant: 'default', emoji: '⭐' },
  supporting: { label: '配角', badgeVariant: 'secondary', emoji: '👤' },
  antagonist: { label: '反派', badgeVariant: 'destructive', emoji: '💀' },
  minor: { label: 'NPC', badgeVariant: 'secondary', emoji: '🌙' },
}

const standardAttrLabels: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; hint: string }> = {
  personality: { label: '性格', icon: Heart, hint: '关键词描述' },
  speechPattern: { label: '说话方式', icon: MessageCircle, hint: '章节对话关键约束' },
  appearance: { label: '外貌', icon: Eye, hint: '辨识特征' },
  background: { label: '背景', icon: BookOpen, hint: '影响剧情的关键经历' },
  goal: { label: '目标', icon: Target, hint: '当前阶段核心目标' },
  weakness: { label: '弱点', icon: ShieldAlert, hint: '决策影响因素' },
  relationships: { label: '关系', icon: Link2, hint: '角色间关系网络' },
}

export function PreviewCharacters({ characters }: PreviewCharactersProps) {
  if (!characters || characters.length === 0) return null

  return (
    <div className="rounded-lg border bg-background p-4 space-y-3">
      <h4 className="text-sm font-semibold flex items-center gap-2">
        <Users className="h-4 w-4 text-primary" />
        角色设计
      </h4>
      {characters.map((char, i) => {
        const rc = roleConfig[char.role] || roleConfig.supporting

        const standardAttrs = Object.entries(char.attributes || {}).filter(
          ([key]) => key in standardAttrLabels
        )
        const customAttrs = Object.entries(char.attributes || {}).filter(
          ([key]) => !(key in standardAttrLabels)
        )

        return (
          <div key={i} className="mb-3 last:mb-0 pb-4 border-b last:border-b-0 last:pb-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="font-bold text-base">{char.name}</span>
              {char.aliases && char.aliases.length > 0 && (
                <span className="text-xs text-muted-foreground">({char.aliases.join(' / ')})</span>
              )}
              <Badge variant={rc.badgeVariant} className="text-[10px]">
                {rc.emoji} {rc.label}
              </Badge>
              {char.powerLevel && (
                <Badge variant="outline" className="text-[10px]">
                  <Sword className="h-3 w-3 mr-0.5" />{char.powerLevel}
                </Badge>
              )}
            </div>

            {char.description && (
              <p className="text-xs text-muted-foreground line-clamp-2 mb-2 italic">{char.description}</p>
            )}

            {standardAttrs.length > 0 && (
              <div className="space-y-1.5 mt-2">
                {standardAttrs.map(([key, val]) => {
                  const attr = standardAttrLabels[key]
                  if (!attr) return null
                  const AttrIcon = attr.icon
                  const isSpeechPattern = key === 'speechPattern'
                  return (
                    <div
                      key={key}
                      className={`rounded-md p-2 border ${
                        isSpeechPattern ? 'border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20' : 'border-border/50 bg-muted/20'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <AttrIcon className={`h-3 w-3 ${isSpeechPattern ? 'text-amber-600' : 'text-muted-foreground'}`} />
                        <span className="text-[11px] font-medium text-muted-foreground">{attr.label}</span>
                        {isSpeechPattern && (
                          <Badge variant="outline" className="text-[9px] text-amber-600 border-amber-300 ml-auto">
                            关键字段
                          </Badge>
                        )}
                        <span className="text-[9px] text-muted-foreground ml-auto">{attr.hint}</span>
                      </div>
                      <p className={`text-xs whitespace-pre-wrap line-clamp-3 ${
                        isSpeechPattern ? 'text-amber-800/80 dark:text-amber-200/80 font-medium' : ''
                      }`}>
                        {String(val)}
                      </p>
                    </div>
                  )
                })}
              </div>
            )}

            {customAttrs.length > 0 && (
              <div className="mt-2">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">其他属性</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {customAttrs.slice(0, 6).map(([key, val]) => (
                    <Badge key={key} variant="outline" className="text-[10px]" title={`${key}: ${String(val)}`}>
                      {key}
                    </Badge>
                  ))}
                  {customAttrs.length > 6 && (
                    <Badge variant="outline" className="text-[10px]">+{customAttrs.length - 6}</Badge>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
