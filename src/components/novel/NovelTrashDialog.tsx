/**
 * @file NovelTrashDialog.tsx
 * @description 全局小说回收站对话框，显示所有已删除小说并支持永久删除
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Trash2, AlertTriangle, RefreshCw, CheckCircle2, RotateCcw } from 'lucide-react'

interface NovelTrashDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function formatDeletedTime(ts: number): string {
  const d = new Date(ts * 1000)
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function NovelTrashDialog({ open, onOpenChange }: NovelTrashDialogProps) {
  const queryClient = useQueryClient()

  const { data: trashData, isLoading, refetch } = useQuery({
    queryKey: ['novels-trash'],
    queryFn: api.novels.trash.all,
    enabled: open,
  })

  const restoreMutation = useMutation({
    mutationFn: (novelId: string) => api.novels.restore(novelId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['novels-trash'] })
      queryClient.invalidateQueries({ queryKey: ['novels'] })
      toast.success('小说已恢复')
    },
    onError: () => toast.error('恢复失败'),
  })

  const destroyMutation = useMutation({
    mutationFn: (novelId: string) => api.novels.trash.destroy(novelId),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['novels-trash'] })
      queryClient.invalidateQueries({ queryKey: ['novels'] })
      toast.success(`已永久删除 ${data.deleted} 条记录`)
    },
    onError: (err) => toast.error(`删除失败: ${(err as Error).message}`),
  })

  const novels = trashData?.novels || []
  const total = trashData?.total || 0

  const handleRestore = (novelId: string) => {
    restoreMutation.mutate(novelId)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-destructive" />
            小说回收站
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${total > 0 ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}`}>
              {total} 部
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-muted-foreground">已删除的小说可以在此处永久删除或恢复</p>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />
              ))}
            </div>
          ) : total === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <CheckCircle2 className="h-10 w-10 mb-3 opacity-20" />
              <p className="text-sm">回收站为空</p>
              <p className="text-xs mt-1 opacity-60">已删除的小说会出现在这里</p>
            </div>
          ) : (
            novels.map((novel) => (
              <div
                key={novel.id}
                className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors group"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{novel.title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {novel.genre && (
                      <span className="text-[10px] text-muted-foreground">{novel.genre}</span>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      {novel.chapterCount} 章 · {novel.wordCount} 字
                    </span>
                    <span className="text-[10px] text-destructive/70">
                      删除于 {formatDeletedTime(novel.deletedAt)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground hover:text-primary"
                    title="恢复小说"
                    onClick={() => handleRestore(novel.id)}
                    disabled={restoreMutation.isPending}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    title="永久删除"
                    onClick={() => {
                      if (confirm(`确定要永久删除《${novel.title}》吗？此操作不可恢复，所有相关数据将被彻底删除。`)) {
                        destroyMutation.mutate(novel.id)
                      }
                    }}
                    disabled={destroyMutation.isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
