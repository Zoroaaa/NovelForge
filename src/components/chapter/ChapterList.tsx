import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Chapter, ChapterInput } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Plus, FileText, BookOpen, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface ChapterListProps {
  novelId: string
  onChapterSelect?: (chapterId: string) => void
}

export function ChapterList({ novelId, onChapterSelect }: ChapterListProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [title, setTitle] = useState('')

  const { data: chapters, isLoading } = useQuery({
    queryKey: ['chapters', novelId],
    queryFn: () => api.chapters.list(novelId),
  })

  const createMutation = useMutation({
    mutationFn: (data: ChapterInput) => api.chapters.create(data),
    onSuccess: (newChapter) => {
      queryClient.invalidateQueries({ queryKey: ['chapters', novelId] })
      toast.success('章节已创建')
      setDialogOpen(false)
      setTitle('')
      onChapterSelect?.(newChapter.id)
    },
    onError: (error) => toast.error(error.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.chapters.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chapters', novelId] })
      toast.success('章节已删除')
    },
    onError: (error) => toast.error(error.message),
  })

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return

    const maxOrder = chapters && chapters.length > 0
      ? Math.max(...chapters.map(c => c.sortOrder))
      : -1

    createMutation.mutate({
      novelId,
      title: title.trim(),
      sortOrder: maxOrder + 1,
      content: null,
      volumeId: null,
      outlineId: null,
    })
  }

  if (isLoading) {
    return <div className="animate-pulse space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-10 bg-muted rounded" />)}</div>
  }

  return (
    <div className="space-y-2">
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="w-full gap-2">
            <Plus className="h-4 w-4" />
            添加章节
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加新章节</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="chapter-title">章节标题</Label>
              <Input
                id="chapter-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="输入章节标题"
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
              <Button type="submit" disabled={!title.trim() || createMutation.isPending}>创建</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <div className="mt-4 space-y-1">
        {chapters && chapters.length > 0 ? (
          chapters.map((chapter) => (
            <div
              key={chapter.id}
              className="flex items-center gap-2 py-2 px-3 hover:bg-muted rounded cursor-pointer group"
              onClick={() => onChapterSelect?.(chapter.id)}
            >
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="flex-1 text-sm truncate">{chapter.title}</span>
              <div className="flex items-center gap-0 opacity-0 group-hover:opacity-100">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={(e) => {
                    e.stopPropagation()
                    navigate(`/novels/${novelId}/read/${chapter.id}`)
                  }}
                >
                  <BookOpen className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-destructive shrink-0"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (confirm('确定要删除这个章节吗？')) {
                      deleteMutation.mutate(chapter.id)
                    }
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">暂无章节</p>
        )}
      </div>
    </div>
  )
}
