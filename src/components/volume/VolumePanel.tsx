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
import { Plus, Trash2, Edit2, BookOpen, ChevronDown, ChevronRight, FileText, FileCode, StickyNote, Wand2, Loader2 } from 'lucide-react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

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
    blueprint: '',
    notes: '',
    status: 'draft',
    targetWordCount: '',
  })

  const [batchDialogOpen, setBatchDialogOpen] = useState(false)
  const [selectedVolumeForBatch, setSelectedVolumeForBatch] = useState<Volume | null>(null)
  const [batchChapterCount, setBatchChapterCount] = useState('10')
  const [batchContext, setBatchContext] = useState('')
  const [isBatchGenerating, setIsBatchGenerating] = useState(false)
  const [batchResult, setBatchResult] = useState<any>(null)

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
    mutationFn: (data: { title: string; summary?: string; outline?: string; blueprint?: string; notes?: string; status?: string; targetWordCount?: number }) =>
      api.volumes.create({
        novelId,
        title: data.title,
        sortOrder: (volumes?.length || 0),
        outline: data.outline || null,
        blueprint: data.blueprint || null,
        targetWordCount: data.targetWordCount || null,
        notes: data.notes || null,
        status: data.status || 'draft',
        summary: data.summary || null,
        chapterCount: 0,
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
      blueprint: formData.blueprint.trim() || undefined,
      notes: formData.notes.trim() || undefined,
      status: formData.status || 'draft',
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
      blueprint: volume.blueprint || '',
      notes: volume.notes || '',
      status: volume.status || 'draft',
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
    setFormData({ title: '', summary: '', outline: '', blueprint: '', notes: '', status: 'draft', targetWordCount: '' })
  }

  const handleBatchGenerate = async () => {
    if (!selectedVolumeForBatch) return

    setIsBatchGenerating(true)
    setBatchResult(null)

    try {
      const result = await api.generate.outlineBatch({
        volumeId: selectedVolumeForBatch.id,
        novelId,
        chapterCount: parseInt(batchChapterCount) || 10,
        context: batchContext.trim() || undefined,
      })

      setBatchResult(result)

      if (result.ok) {
        toast.success(`成功生成 ${result.successCount} 个章节大纲`)
        queryClient.invalidateQueries({ queryKey: ['chapters', novelId] })
      } else {
        toast.error(result.error || '批量生成失败')
      }
    } catch (err) {
      toast.error(`批量生成失败: ${(err as Error).message}`)
    } finally {
      setIsBatchGenerating(false)
    }
  }

  const openBatchDialog = (volume: Volume) => {
    setSelectedVolumeForBatch(volume)
    setBatchChapterCount('10')
    setBatchContext('')
    setBatchResult(null)
    setBatchDialogOpen(true)
  }

  const closeBatchDialog = () => {
    setBatchDialogOpen(false)
    setSelectedVolumeForBatch(null)
    setBatchResult(null)
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
                <Label>卷状态</Label>
                <Select value={formData.status} onValueChange={(v) => setFormData(prev => ({ ...prev, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">草稿</SelectItem>
                    <SelectItem value="writing">连载中</SelectItem>
                    <SelectItem value="completed">已完结</SelectItem>
                  </SelectContent>
                </Select>
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

              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  <FileCode className="h-4 w-4" />
                  卷蓝图（可选，JSON格式）
                </Label>
                <Textarea
                  placeholder='如：{"arc": "成长篇", "keyEvents": ["拜师", "历练"]}'
                  rows={3}
                  value={formData.blueprint}
                  onChange={(e) => setFormData(prev => ({ ...prev, blueprint: e.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  <StickyNote className="h-4 w-4" />
                  作者笔记（可选）
                </Label>
                <Textarea
                  placeholder="记录创作灵感、待办事项等..."
                  rows={2}
                  value={formData.notes}
                  onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
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
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openBatchDialog(volume)}>
                      <Wand2 className="h-3.5 w-3.5" />
                    </Button>
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

                {isExpanded && (
                  <div className="border-t bg-muted/10 space-y-2 p-3">
                    {volume.summary && (
                      <div className="flex items-start gap-2">
                        <FileText className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0 mt-0.5" />
                        <p className="text-xs text-muted-foreground/70 line-clamp-2 leading-relaxed">
                          {volume.summary}
                        </p>
                      </div>
                    )}
                    {volume.notes && (
                      <div className="flex items-start gap-2">
                        <StickyNote className="h-3.5 w-3.5 text-amber-500/50 shrink-0 mt-0.5" />
                        <p className="text-xs text-muted-foreground/70 line-clamp-2 leading-relaxed">
                          笔记：{volume.notes}
                        </p>
                      </div>
                    )}
                    {volume.blueprint && (
                      <div className="flex items-start gap-2">
                        <FileCode className="h-3.5 w-3.5 text-blue-500/50 shrink-0 mt-0.5" />
                        <p className="text-xs text-muted-foreground/70 line-clamp-2 leading-relaxed">
                          蓝图：{volume.blueprint.slice(0, 100)}{volume.blueprint.length > 100 ? '...' : ''}
                        </p>
                      </div>
                    )}
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

      <Dialog open={batchDialogOpen} onOpenChange={(open) => { if (!open) closeBatchDialog() }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-primary" />
              AI 批量生成章节大纲
            </DialogTitle>
          </DialogHeader>

          {selectedVolumeForBatch && (
            <div className="space-y-4">
              <div className="bg-muted/50 p-3 rounded-lg">
                <p className="text-sm font-medium">目标卷：《{selectedVolumeForBatch.title}》</p>
                <p className="text-xs text-muted-foreground mt-1">
                  将为该卷批量生成章节大纲，每个大纲包含标题、核心情节、关键冲突、伏笔安排等
                </p>
              </div>

              <div className="space-y-2">
                <Label>章节数量</Label>
                <Input
                  type="number"
                  min={1}
                  max={30}
                  value={batchChapterCount}
                  onChange={(e) => setBatchChapterCount(e.target.value)}
                  placeholder="请输入要生成的章节数量（1-30）"
                />
              </div>

              <div className="space-y-2">
                <Label>补充上下文（可选）</Label>
                <Textarea
                  placeholder="如：这一卷主要讲述主角进入秘境历练，需要安排3个小高潮..."
                  rows={4}
                  value={batchContext}
                  onChange={(e) => setBatchContext(e.target.value)}
                />
              </div>

              {!batchResult && (
                <Button
                  onClick={handleBatchGenerate}
                  disabled={isBatchGenerating || !batchChapterCount}
                  className="w-full gap-2"
                >
                  {isBatchGenerating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      正在生成中...
                    </>
                  ) : (
                    <>
                      <Wand2 className="h-4 w-4" />
                      开始批量生成
                    </>
                  )}
                </Button>
              )}

              {batchResult && (
                <div className="space-y-3">
                  <div className={`p-3 rounded-lg ${batchResult.ok ? 'bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800'}`}>
                    <p className={`text-sm font-medium ${batchResult.ok ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>
                      {batchResult.ok ? `✓ 成功生成 ${batchResult.successCount} 个章节大纲` : `✗ 生成失败`}
                    </p>
                    {batchResult.message && (
                      <p className="text-xs text-muted-foreground mt-1">{batchResult.message}</p>
                    )}
                  </div>

                  {batchResult.volumeOutlinePreview && (
                    <div className="space-y-2">
                      <Label>卷大纲预览</Label>
                      <div className="bg-muted/30 p-4 rounded-lg max-h-[400px] overflow-y-auto">
                        <pre className="text-xs whitespace-pre-wrap leading-relaxed font-mono">
                          {batchResult.volumeOutlinePreview}
                        </pre>
                      </div>
                    </div>
                  )}

                  {batchResult.outlines && batchResult.outlines.length > 0 && (
                    <div className="space-y-2">
                      <Label>生成的章节列表（{batchResult.outlines.length} 章）</Label>
                      <div className="max-h-[300px] overflow-y-auto space-y-2">
                        {batchResult.outlines.map((outline: any, idx: number) => (
                          <div key={idx} className="border rounded-lg p-3 space-y-1">
                            <p className="font-medium text-sm">{idx + 1}. {outline.chapterTitle || `第${idx + 1}章`}</p>
                            {outline.outline && (
                              <p className="text-xs text-muted-foreground line-clamp-2">{outline.outline}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setBatchResult(null)} className="flex-1">
                      重新生成
                    </Button>
                    <Button onClick={closeBatchDialog} className="flex-1">
                      完成
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}