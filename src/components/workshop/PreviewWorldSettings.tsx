import React from 'react'
import { Globe, Sword, ShieldAlert, MapPin, Zap, Lightbulb } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { WorldSetting } from './types'

interface PreviewWorldSettingsProps {
  settings: WorldSetting[]
}

const typeConfig: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  power_system: { label: '境界体系', icon: Sword, color: 'text-red-500 bg-red-50 dark:bg-red-950/30' },
  worldview: { label: '世界观', icon: Globe, color: 'text-blue-500 bg-blue-50 dark:bg-blue-950/30' },
  faction: { label: '势力组织', icon: ShieldAlert, color: 'text-purple-500 bg-purple-50 dark:bg-purple-950/30' },
  geography: { label: '地理环境', icon: MapPin, color: 'text-green-500 bg-green-50 dark:bg-green-950/30' },
  item_skill: { label: '功法宝物', icon: Zap, color: 'text-orange-500 bg-orange-50 dark:bg-orange-950/30' },
  misc: { label: '其他设定', icon: Lightbulb, color: 'text-gray-500 bg-gray-50 dark:bg-gray-900/30' },
}

export function PreviewWorldSettings({ settings }: PreviewWorldSettingsProps) {
  if (!settings || settings.length === 0) return null

  const grouped = settings.reduce((acc, ws) => {
    const t = ws.type || 'misc'
    if (!acc[t]) acc[t] = []
    acc[t].push(ws)
    return acc
  }, {} as Record<string, WorldSetting[]>)

  return (
    <div className="rounded-lg border bg-background p-4 space-y-3">
      <h4 className="text-sm font-semibold flex items-center gap-2">
        <Globe className="h-4 w-4 text-primary" />
        世界观设定
      </h4>
      {Object.entries(grouped).map(([type, typeSettings]) => {
        const config = typeConfig[type] || typeConfig.misc
        const TypeIcon = config.icon

        return (
          <div key={type} className="mb-3 last:mb-0">
            <div className="flex items-center gap-1.5 mb-2 pb-1 border-b border-border/50">
              <TypeIcon className={`h-3.5 w-3.5 ${config.color.split(' ')[0]}`} />
              <span className="text-xs font-semibold uppercase tracking-wider">{config.label}</span>
              <Badge variant="secondary" className="text-[10px] ml-auto">{typeSettings.length}条</Badge>
            </div>
            <div className="space-y-2 pl-1">
              {typeSettings.map((ws, j) => (
                <div key={j} className="rounded-md border border-border/60 p-2.5 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{ws.title}</span>
                    {ws.importance && (
                      <Badge
                        variant={ws.importance === 'high' ? 'destructive' : ws.importance === 'low' ? 'secondary' : 'outline'}
                        className="text-[10px]"
                      >
                        {ws.importance === 'high' ? '🔥 高频召回' : ws.importance === 'low' ? '💤 背景' : '📖 按需'}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-4 leading-relaxed">{ws.content}</p>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
