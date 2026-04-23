/**
 * @file TrashPanel.tsx
 * @description 回收站面板组件，查看和清理软删除数据
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Trash2, AlertTriangle, RefreshCw, BookOpen, Users, Layers, AlignLeft, Library, Bookmark, ScrollText, CheckCircle2 } from 'lucide-react'

interface TrashPanelProps {
  novelId: string
}

const TABLE_ICONS: Record<string, React.ElementType> = {
  chapters: BookOpen,
  characters: Users,
  settings: Layers,
  outlines: AlignLeft,
  volumes: Library,
  foreshadowing: Bookmark,
  rules: ScrollText,
}

const TABLE_LABELS: Record<string, string> = {
  chapters: '章节',
  characters: '角色',
  settings: '设定',
  outlines: '总纲',
  volumes: '卷',
  foreshadowing: '伏笔',
  rules: '规则',
}

function formatDeletedTime(ts: number): string {
  const d = new Date(ts * 1000)
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function TrashPanel({ novelId }: TrashPanelProps) {
  const queryClient = useQueryClient()
  const [activeTable, setActiveTable] = useState<string | null>(null)
  const [confirmClearAll, setConfirmClearAll] = useState(false)

  const { data: trashData, isLoading, refetch } = useQuery({
    queryKey: ['trash', novelId],
    queryFn: () => api.novels.trash.get(novelId),
    refetchInterval: false,
  })

  const cleanMutation = useMutation({
    mutationFn: (table?: string | undefined) => api.novels.trash.clean(novelId, table),
    onSuccess: (data) => {
      toast.success(`已永久删除 ${data.deleted} 条记录`)
      setConfirmClearAll(false)
      setActiveTable(null)
      queryClient.invalidateQueries({ queryKey: ['trash'] })
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      queryClient.invalidateQueries({ queryKey: ['chapters'] })
      queryClient.invalidateQueries({ queryKey: ['characters'] })
      queryClient.invalidateQueries({ queryKey: ['foreshadowing'] })
    },
    onError: (err) => toast.error(`清除失败: ${(err as Error).message}`),
  })

  if (isLoading) {
    return (
      <div className="p-4 space-y-2">
        {[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-muted rounded-lg animate-pulse" />)}
      </div>
    )
  }

  const tables = trashData?.tables || []
  const total = trashData?.total || 0

  if (!trashData?.ok) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <AlertTriangle className="h-8 w-8 mb-2 opacity-30" />
        <p className="text-sm">查询回收站失败</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2.5 border-b flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2">
          <Trash2 className="h-4 w-4 text-destructive" />
          <span className="text-sm font-medium">回收站</span>
          <span className={`text-xs px-1.5 py-0.5 rounded-full ${total > 0 ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}`}>
            {total} 条
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => refetch()} title="刷新">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>

          {total > 0 && !confirmClearAll && (
            <Button
              size="sm"
              variant="destructive"
              className="h-7 text-xs gap-1"
              onClick={() => setConfirmClearAll(true)}
            >
              <Trash2 className="h-3 w-3" />
              清空全部
            </Button>
          )}

          {confirmClearAll && (
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setConfirmClearAll(false)}>
                取消
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="h-7 text-xs"
                disabled={cleanMutation.isPending}
                onClick={() => cleanMutation.mutate(undefined)}
              >
                {cleanMutation.isPending ? '删除中...' : `确认永久删除 ${total} 条`}
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-0">
        {total === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <CheckCircle2 className="h-10 w-10 mb-3 opacity-20" />
            <p className="text-sm">回收站为空</p>
            <p className="text-xs mt-1 opacity-60">已删除的数据会出现在这里</p>
          </div>
        ) : (
          <>
            {tables.map((tbl) => {
              const Icon = TABLE_ICONS[tbl.key] || Trash2
              const isOpen = activeTable === tbl.key

              return (
                <div key={tbl.key} className="rounded-lg border overflow-hidden">
                  <button
                    onClick={() => setActiveTable(isOpen ? null : tbl.key)}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-muted/50 transition-colors"
                  >
                    <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium flex-1 text-left">{TABLE_LABELS[tbl.key] || tbl.key}</span>
                    <span className="text-xs tabular-nums bg-destructive/10 text-destructive px-1.5 py-0.5 rounded-full">
                      {tbl.count}
                    </span>
                    {isOpen ? (
                      <svg className="h-3.5 w-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/></svg>
                    ) : (
                      <svg className="h-3.5 w-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
                    )}
                  </button>

                  {isOpen && (
                    <div className="border-t divide-y p-2 space-y-1">
                      {(tbl.items as Array<Record<string, unknown>>).map((item) => (
                        <div key={String(item.id)} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-muted/30 group">
                          <div className="flex-1 min-w-0">
                            <span className="text-xs font-medium truncate block">{(item.title as string) || (item.name as string) || '未命名'}</span>
                            {(String(item.role) || null) && (
                              <span className="text-[10px] text-muted-foreground">({String(item.role)})</span>
                            )}
                            {(String(item.type) || null) && (
                              <span className="text-[10px] text-muted-foreground ml-1">[{String(item.type)}]</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                              {formatDeletedTime(item.deletedAt as number)}
                            </span>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={(e) => {
                                e.stopPropagation()
                                cleanMutation.mutate(tbl.key)
                              }}
                              disabled={cleanMutation.isPending}
                              title="永久删除此条"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))}

                      <div className="pt-1 border-t mt-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="w-full h-7 text-[11px] text-destructive/70 hover:text-destructive hover:bg-destructive/5 gap-1"
                          onClick={() => cleanMutation.mutate(tbl.key)}
                          disabled={cleanMutation.isPending}
                        >
                          <Trash2 className="h-3 w-3" />
                          清空此表 ({tbl.count} 条)
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}
