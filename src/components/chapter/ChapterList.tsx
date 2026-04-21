/**
 * @file ChapterList.tsx
 * @description 章节列表组件，提供章节的展示、创建、排序和删除功能，按卷分组显示
 * @version 2.0.0
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Chapter, ChapterInput, Volume } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Plus, BookOpen, Trash2, FileText, Sparkles, CheckCircle, RefreshCw, ChevronDown, ChevronRight, Library } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'

interface ChapterListProps {
  novelId: string
  onChapterSelect?: (chapterId: string) => void
}

const chapterStatusConfig: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  draft: { label: '草稿', color: 'text-gray-500 bg-gray-50', icon: <FileText className="h-3 w-3" /> },
  generated: { label: '已生成', color: 'text-blue-500 bg-blue-50', icon: <Sparkles className="h-3 w-3" /> },
  revised: { label: '已修订', color: 'text-orange-500 bg-orange-50', icon: <RefreshCw className="h-3 w-3" /> },
  published: { label: '已发布', color: 'text-green-500 bg-green-50', icon: <CheckCircle className="h-3 w-3" /> },
}

export function ChapterList({ novelId, onChapterSelect }: ChapterListProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [volumeId, setVolumeId] = useState('')
  const [expandedVolumes, setExpandedVolumes] = useState<Set<string>>(new Set(['uncategorized']))

  const { data: chapters, isLoading } = useQuery({
    queryKey: ['chapters', novelId],
    queryFn: () => api.chapters.list(novelId),
  })

  const { data: volumes } = useQuery({
    queryKey: ['volumes', novelId],
    queryFn: () => api.volumes.list(novelId),
  })

  const chaptersByVolume = (chapters || []).reduce((acc, ch) => {
    const key = ch.volumeId || 'uncategorized'
    if (!acc[key]) acc[key] = []
    acc[key].push(ch)
    return acc
  }, {} as Record<string, Chapter[]>)

  const createMutation = useMutation({
    mutationFn: (data: ChapterInput) => api.chapters.create(data),
    onSuccess: (newChapter) => {
      queryClient.invalidateQueries({ queryKey: ['chapters', novelId] })
      queryClient.invalidateQueries({ queryKey: ['volumes', novelId] })
      toast.success('章节已创建')
      setDialogOpen(false)
      setTitle('')
      setVolumeId('')
      onChapterSelect?.(newChapter.id)
    },
    onError: (error) => toast.error(error.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.chapters.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chapters', novelId] })
      queryClient.invalidateQueries({ queryKey: ['volumes', novelId] })
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
      volumeId: volumeId === 'none' ? null : volumeId || null,
    })
  }

  const toggleVolume = (volumeId: string) => {
    setExpandedVolumes(prev => {
      const next = new Set(prev)
      if (next.has(volumeId)) next.delete(volumeId)
      else next.add(volumeId)
      return next
    })
  }

  const renderChapter = (chapter: Chapter, idx: number) => {
    const statusInfo = chapterStatusConfig[chapter.status] || chapterStatusConfig.draft
    return (
      <div
        key={chapter.id}
        className="flex items-center gap-2 py-2 px-3 hover:bg-muted/70 rounded-md cursor-pointer group transition-colors"
        onClick={() => onChapterSelect?.(chapter.id)}
      >
        <span className="text-[10px] text-muted-foreground/50 w-5 text-right shrink-0 font-mono tabular-nums">
          {String(idx + 1).padStart(2, '0')}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm truncate leading-snug flex-1">{chapter.title}</p>
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${statusInfo.color}`}>
              {statusInfo.icon}
              {statusInfo.label}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            {chapter.wordCount > 0 && (
              <span className="text-[10px] text-muted-foreground/60 leading-tight">
                {chapter.wordCount.toLocaleString()} 字
              </span>
            )}
            {chapter.summary && (
              <span className="text-[10px] text-blue-600/70 leading-tight truncate flex-1" title={chapter.summary}>
                📝 {chapter.summary.slice(0, 50)}...
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0 opacity-0 group-hover:opacity-100 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
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
            className="h-6 w-6 text-destructive"
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
    )
  }

  const renderVolumeGroup = (volume: Volume | null, volumeId: string) => {
    const volumeChapters = chaptersByVolume[volumeId] || []
    if (volumeChapters.length === 0 && volumeId !== 'uncategorized') return null

    const isExpanded = expandedVolumes.has(volumeId)
    const totalWords = volumeChapters.reduce((sum, ch) => sum + ch.wordCount, 0)

    return (
      <div key={volumeId} className="mb-2">
        <div
          className="flex items-center gap-2 py-1.5 px-2 hover:bg-muted/50 rounded-md cursor-pointer transition-colors"
          onClick={() => toggleVolume(volumeId)}
        >
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          )}
          
          {volume ? (
            <>
              <Library className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="text-xs font-medium truncate flex-1">{volume.title}</span>
            </>
          ) : (
            <>
              <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground truncate flex-1">未分类</span>
            </>
          )}
          
          <Badge variant="secondary" className="text-[10px] h-4 px-1">
            {volumeChapters.length}
          </Badge>
          {totalWords > 0 && (
            <span className="text-[10px] text-muted-foreground">
              {totalWords.toLocaleString()} 字
            </span>
          )}
        </div>

        {isExpanded && (
          <div className="ml-4 mt-1 space-y-0.5">
            {volumeChapters.map((chapter, idx) => renderChapter(chapter, idx))}
          </div>
        )}
      </div>
    )
  }

  if (isLoading) {
    return <div className="animate-pulse space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-10 bg-muted rounded" />)}</div>
  }

  const sortedVolumes = [...(volumes || [])].sort((a, b) => a.sortOrder - b.sortOrder)

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
            <div className="space-y-2">
              <Label>所属卷（可选）</Label>
              <Select value={volumeId} onValueChange={setVolumeId}>
                <SelectTrigger><SelectValue placeholder="选择所属卷" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">无</SelectItem>
                  {volumes?.map(v => (
                    <SelectItem key={v.id} value={v.id}>{v.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
              <Button type="submit" disabled={!title.trim() || createMutation.isPending}>创建</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <div className="mt-3">
        {chapters && chapters.length > 0 ? (
          <>
            {sortedVolumes.map(volume => renderVolumeGroup(volume, volume.id))}
            {chaptersByVolume['uncategorized'] && chaptersByVolume['uncategorized'].length > 0 && (
              renderVolumeGroup(null, 'uncategorized')
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">暂无章节</p>
        )}
      </div>
    </div>
  )
}
