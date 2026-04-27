import React from 'react'
import { Layers, BookOpen, MapPin, Lightbulb, Zap } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { Volume } from './types'

interface PreviewVolumesProps {
  volumes: Volume[]
}

interface ParsedEvent {
  chapterNum: number
  sceneTag: string
  event: string
}

interface BlueprintTag {
  tag: string
  content: string
}

export function PreviewVolumes({ volumes }: PreviewVolumesProps) {
  if (!volumes || volumes.length === 0) return null

  const parseEventLine = (line: string): ParsedEvent | null => {
    const match = line.match(/第(\d+)章[：:]\s*(\[.*?\])?\s*(.+)/)
    if (match) {
      return {
        chapterNum: parseInt(match[1], 10),
        sceneTag: match[2]?.replace(/^\[|\]$/g, '') || '',
        event: match[3].trim()
      }
    }
    return null
  }

  const parseBlueprintTags = (bp: string): BlueprintTag[] => {
    const tags: BlueprintTag[] = []
    const regex = /【([^】]+)】([\s\S]*?)(?=【|$)/g
    let m
    while ((m = regex.exec(bp)) !== null) {
      tags.push({ tag: m[1], content: m[2].trim() })
    }
    return tags
  }

  return (
    <div className="rounded-lg border bg-background p-4 space-y-3">
      <h4 className="text-sm font-semibold flex items-center gap-2">
        <Layers className="h-4 w-4 text-primary" />
        卷纲规划
      </h4>
      {volumes.map((vol, i) => {
        const parsedEvents = (vol.eventLine || []).map(parseEventLine).filter(Boolean) as ParsedEvent[]
        const blueprintTags = vol.blueprint ? parseBlueprintTags(vol.blueprint) : []

        return (
          <div key={i} className="mb-4 last:mb-0 rounded-lg border border-border overflow-hidden">
            <div className="bg-muted/40 px-3 py-2 flex items-center gap-2 flex-wrap">
              <Badge variant="default" className="text-[10px]">第{i + 1}卷</Badge>
              <span className="font-bold text-sm">{vol.title}</span>
              {(vol.targetWordCount || vol.targetChapterCount) && (
                <span className="text-[10px] text-muted-foreground ml-auto">
                  {vol.targetWordCount ? `${Math.round(vol.targetWordCount / 10000)}万字` : ''}
                  {vol.targetWordCount && vol.targetChapterCount ? ' · ' : ''}
                  {vol.targetChapterCount ? `${vol.targetChapterCount}章` : ''}
                </span>
              )}
            </div>

            <div className="p-3 space-y-2.5">
              {vol.summary && (
                <div className="text-xs text-muted-foreground leading-relaxed">
                  <span className="font-medium text-foreground">概述：</span>{vol.summary}
                </div>
              )}

              {blueprintTags.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
                    <BookOpen className="h-3 w-3" />蓝图结构
                  </span>
                  <div className="grid grid-cols-1 gap-1">
                    {blueprintTags.map((tag, ti) => (
                      <div key={ti} className="text-[11px] border-l-2 border-primary/30 pl-2 py-0.5">
                        <span className="font-medium text-primary/80">【{tag.tag}】</span>
                        <span className="text-muted-foreground line-clamp-1 ml-1">{tag.content}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {parsedEvents.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
                      <MapPin className="h-3 w-3" />事件线（{parsedEvents.length}章）
                    </span>
                    {vol.targetChapterCount && parsedEvents.length !== vol.targetChapterCount && (
                      <span className="text-[9px] text-amber-500">
                        ⚠ 需{vol.targetChapterCount}章，当前{parsedEvents.length}条
                      </span>
                    )}
                  </div>
                  <div className="max-h-48 overflow-y-auto pr-1 space-y-0.5">
                    {parsedEvents.map((ev, ei) => (
                      <div key={ei} className="flex items-start gap-2 text-[11px] py-1 px-1.5 rounded hover:bg-muted/40 transition-colors">
                        <Badge variant="secondary" className="text-[9px] shrink-0 mt-0.5 min-w-[48px] justify-center">
                          第{ev.chapterNum}章
                        </Badge>
                        {ev.sceneTag && (
                          <Badge variant="outline" className="text-[9px] shrink-0 mt-0.5">
                            {ev.sceneTag}
                          </Badge>
                        )}
                        <span className="text-muted-foreground line-clamp-1">{ev.event}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(vol.foreshadowingSetup && vol.foreshadowingSetup.length > 0) && (
                <div className="space-y-1">
                  <span className="text-[11px] font-semibold text-emerald-600 flex items-center gap-1">
                    <Lightbulb className="h-3 w-3" />埋入伏笔（{vol.foreshadowingSetup.length}条）
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {vol.foreshadowingSetup.map((fs, fi) => {
                      const name = fs.match(/^(.+?)（/)?.[1] || fs
                      return (
                        <Badge key={fi} variant="outline" className="text-[10px] border-emerald-300/60 text-emerald-700 dark:text-emerald-400" title={fs}>
                          📥 {name.trim()}
                        </Badge>
                      )
                    })}
                  </div>
                </div>
              )}

              {(vol.foreshadowingResolve && vol.foreshadowingResolve.length > 0) && (
                <div className="space-y-1">
                  <span className="text-[11px] font-semibold text-orange-600 flex items-center gap-1">
                    <Zap className="h-3 w-3" />回收伏笔（{vol.foreshadowingResolve.length}条）
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {vol.foreshadowingResolve.map((fr, fri) => {
                      const name = fr.match(/^(.+?)（/)?.[1] || fr
                      return (
                        <Badge key={fri} variant="outline" className="text-[10px] border-orange-300/60 text-orange-700 dark:text-orange-400" title={fr}>
                          📤 {name.trim()}
                        </Badge>
                      )
                    })}
                  </div>
                </div>
              )}

              {vol.notes && vol.notes.length > 0 && (
                <div className="space-y-1">
                  <span className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
                    <BookOpen className="h-3 w-3" />创作备注（{vol.notes.length}条）
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {vol.notes.map((note, ni) => (
                      <Badge key={ni} variant="secondary" className="text-[10px]" title={note}>
                        📝 {note}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
