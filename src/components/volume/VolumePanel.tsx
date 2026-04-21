/**
 * @file VolumePanel.tsx
 * @description 卷管理面板组件，提供卷的创建、编辑、删除和章节管理功能
 * @version 1.0.0
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Volume, Chapter } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Plus, Trash2, Edit2, BookOpen, ChevronDown, ChevronRight, FileText, Hash } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'

interface VolumePanelProps {
  novelId: string
  onChapterSelect?: (chapterId: string) => void
}

const VOLUME_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft: { label: '草稿', color: 'bg-gray-100 text-gray-700' },
  writing: { label: '连载中', color: 'bg-blue-100 text-blue-700' },
  completed: { label: '已完结', color: 'bg-green-100 text-green-700' },
}

export function VolumePanel({ novelId, onChapterSelect }: VolumePanelProps) {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [expandedVolumes, setExpandedVolumes] = useState<Set<string>>(new Set())
  
  const [formData, setFormData] = useState({
    title: '',
    summary: '',
    outline: '',
    targetWordCount: '',
  })

  const { data: volumes, isLoading: volumesLoading } = useQuery({
    queryKey: ['volumes', novelId],
    queryFn: () => api.volumes.list(novelId),
  })

  const { data: chapters } = useQuery({
    queryKey: ['chapters', novelId],
    queryFn: () => api.chapters.list(novelId),
  })

  const chaptersByVolume = (chapters || []).reduce((acc, ch) => {
    const key = ch.volumeId || 'uncategorized'
    if (!acc[key]) acc[key] = []
    acc[key].push(ch)
    return acc
  }, {} as Record<string, Chapter[]>)

  const createMutation = useMutation({
    mutationFn: (data: { title: string; summary?: string; outline?: string; targetWordCount?: number }) =>
      api.volumes.create({
        novelId,
        title: data.title,
        sortOrder: (volumes?.length || 0),
        outline: data.outline || null,
        blueprint: null,
        targetWordCount: data.targetWordCount || null,
        notes: null,
        chapterCount: 0,
      }).then((volume) => {
        if (data.summary) {
          return api.volumes.update(volume.id, {
            summary: data.summary,
          } as any)
        }
        return volume
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['volumes', novelId] })
      toast.success('卷创建成功')
      setDialogOpen(false)
      resetForm()
    },
    onError: (err) => toast.error(`创建失败: ${(err as Error).message}`),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Volume> }) =>
      api.volumes.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['volumes', novelId] })
      toast.success('卷更新成功')
      setDialogOpen(false)
      resetForm()
    },
    onError: (err) => toast.error(`更新失败: ${(err as Error).message}`),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.volumes.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['volumes', novelId] })
      queryClient.invalidateQueries({ queryKey: ['chapters', novelId] })
      toast.success('卷已删除')
    },
    onError: (err) => toast.error(`删除失败: ${(err as Error).message}`),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.title.trim()) {
      toast.warning('请填写卷标题')
      return
    }

    const data = {
      title: formData.title.trim(),
      summary: formData.summary.trim() || undefined,
      outline: formData.outline.trim() || undefined,
      targetWordCount: formData.targetWordCount ? Number(formData.targetWordCount) : undefined,
    }

    if (editingId) {
      updateMutation.mutate({ id: editingId, data })
    } else {
      createMutation.mutate(data)
    }
  }

  const handleEdit = (volume: Volume) => {
    setEditingId(volume.id)
    setFormData({
      title: volume.title,
      summary: volume.summary || '',
      outline: volume.outline || '',
      targetWordCount: volume.targetWordCount?.toString() || '',
    })
    setDialogOpen(true)
  }

  const handleDelete = (id: string) => {
    const volumeChapters = chaptersByVolume[id] || []
    if (volumeChapters.length > 0) {
      toast.error('该卷下还有章节，请先移动或删除章节')
      return
    }
    if (confirm('确定要删除这个卷吗？')) {
      deleteMutation.mutate(id)
    }
  }

  const toggleVolume = (volumeId: string) => {
    setExpandedVolumes(prev => {
      const next = new Set(prev)
      if (next.has(volumeId)) next.delete(volumeId)
      else next.add(volumeId)
      return next
    })
  }

  const resetForm = () => {
    setEditingId(null)
    setFormData({ title: '', summary: '', outline: '', targetWordCount: '' })
  }

  if (volumesLoading) {
    return (
      <div className="p-4 space-y-2">
        {[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-muted rounded-lg animate-pulse" />)}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* 操作栏 */}
      <div className="px-4 py-3 border-b flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground tabular-nums">{volumes?.length || 0} 卷</span>
        
        <Dialog open={dialogOpen} onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) resetForm()
        }}>
          <DialogTrigger asChild>
            <Button size="sm" className="h-8 gap-1.5 text-xs shrink-0">
              <Plus className="h-3.5 w-3.5" />
              新增卷
            </Button>
          </DialogTrigger>
          
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingId ? '编辑卷' : '新增卷'}</DialogTitle>
            </DialogHeader>
            
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>卷标题 *</Label>
                <Input
                  placeholder="如：第一卷 初入修仙界"
                  value={formData.title}
                  onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label>目标字数（可选）</Label>
                <Input
                  type="number"
                  placeholder="如：200000"
                  value={formData.targetWordCount}
                  onChange={(e) => setFormData(prev => ({ ...prev, targetWordCount: e.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <Label>卷简介（可选）</Label>
                <Textarea
                  placeholder="描述这一卷的主要内容..."
                  rows={3}
                  value={formData.summary}
                  onChange={(e) => setFormData(prev => ({ ...prev, summary: e.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <Label>卷大纲（可选，支持 Markdown）</Label>
                <Textarea
                  placeholder="详细规划这一卷的情节发展..."
                  rows={8}
                  value={formData.outline}
                  onChange={(e) => setFormData(prev => ({ ...prev, outline: e.target.value }))}
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  取消
                </Button>
                <Button 
                  type="submit" 
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  {createMutation.isPending || updateMutation.isPending ? '保存中...' : (editingId ? '更新' : '创建')}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* 卷列表 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {volumes && volumes.length > 0 ? (
          volumes.map((volume) => {
            const volumeChapters = chaptersByVolume[volume.id] || []
            const isExpanded = expandedVolumes.has(volume.id)
            const statusInfo = VOLUME_STATUS_CONFIG[volume.status] || VOLUME_STATUS_CONFIG.draft
            
            return (
              <div key={volume.id} className="rounded-lg border overflow-hidden">
                <div 
                  className="flex items-center gap-2.5 px-3 py-3 hover:bg-muted/50 cursor-pointer transition-colors group"
                  onClick={() => toggleVolume(volume.id)}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  )}
                  
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{volume.title}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-sm font-medium shrink-0 ${statusInfo.color}`}>
                        {statusInfo.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground/70">
                      <span>{volumeChapters.length} 章</span>
                      {volume.wordCount > 0 && (
                        <span>{(volume.wordCount / 1000).toFixed(1)}k字</span>
                      )}
                      {volume.targetWordCount && (
                        <span className="text-blue-500/70">
                          目标 {(volume.targetWordCount / 1000).toFixed(0)}k
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" onClick={(e) => e.stopPropagation()}>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleEdit(volume)}>
                      <Edit2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => handleDelete(volume.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {isExpanded && volumeChapters.length > 0 && (
                  <div className="border-t bg-muted/20">
                    {volumeChapters.map((chapter, idx) => (
                      <div
                        key={chapter.id}
                        className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-muted/50 cursor-pointer transition-colors border-b last:border-b-0"
                        onClick={() => onChapterSelect?.(chapter.id)}
                      >
                        <span className="text-[11px] text-muted-foreground/40 w-5 text-right shrink-0 font-mono tabular-nums">
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                        <FileText className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                        <span className="text-sm truncate flex-1">{chapter.title}</span>
                        {chapter.wordCount > 0 && (
                          <span className="text-[11px] text-muted-foreground/50 tabular-nums shrink-0">
                            {chapter.wordCount.toLocaleString()}字
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {isExpanded && volume.summary && (
                  <div className="border-t px-3 py-2.5 bg-muted/10">
                    <p className="text-xs text-muted-foreground/70 line-clamp-2 leading-relaxed">
                      {volume.summary}
                    </p>
                  </div>
                )}
              </div>
            )
          })
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <BookOpen className="h-10 w-10 mb-3 opacity-20" />
            <p className="text-sm">还没有创建卷</p>
            <p className="text-xs opacity-60 mt-1">点击上方按钮添加卷</p>
          </div>
        )}
      </div>
    </div>
  )
}