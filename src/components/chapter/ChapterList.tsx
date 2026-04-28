/**
 * @file ChapterList.tsx
 * @description 章节列表组件，提供章节的展示、创建、排序和删除功能，按卷分组显示
 * @version 2.0.0
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useMemo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { api, streamGenerate } from '@/lib/api'
import type { Chapter, ChapterInput, Volume } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Square, BookOpen, Trash2, FileText, Sparkles, CheckCircle, RefreshCw, ChevronDown, ChevronRight, Library, Wand2, Loader2, Zap, Plus, CloudUpload } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

type ChapterStatus = 'draft' | 'generated' | 'revised' | 'published'

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
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set())
  
  const [nextChapterDialogOpen, setNextChapterDialogOpen] = useState(false)
  const [selectedVolumeForNext, setSelectedVolumeForNext] = useState<Volume | null>(null)
  const [isGeneratingNext, setIsGeneratingNext] = useState(false)
  const [isQueueSubmitting, setIsQueueSubmitting] = useState(false)
  const [isQueueSubmitted, setIsQueueSubmitted] = useState(false)

  const [generatingChapterId, setGeneratingChapterId] = useState<string | null>(null)
  const [generatingOutput, setGeneratingOutput] = useState('')
  const [isGeneratingContent, setIsGeneratingContent] = useState(false)
  const stopGenerateRef = useRef<(() => void) | null>(null)
  const generatedContentRef = useRef<string>('')

  const extractTitleFromContent = (content: string): string | null => {
    const match = content.match(/^#\s+(.+)$/m)
    return match?.[1]?.trim() || null
  }

  const handleStartGenerateNext = async () => {
    if (!selectedVolumeForNext || !chapters) return
    setIsGeneratingNext(true)
    setGeneratingOutput('')
    generatedContentRef.current = ''

    const maxOrder = chapters.length > 0 ? Math.max(...chapters.map(c => c.sortOrder)) : -1
    const chapterNumber = chapters.length + 1
    const tempTitle = `第${chapterNumber}章`

    try {
      const newChapter = await api.chapters.create({
        novelId,
        title: tempTitle,
        sortOrder: maxOrder + 1,
        content: null,
        volumeId: selectedVolumeForNext.id,
        summary: '',
      })

      setGeneratingChapterId(newChapter.id)
      setIsGeneratingNext(false)
      setIsGeneratingContent(true)

      const stop = streamGenerate(
        { chapterId: newChapter.id, novelId, mode: 'generate' },
        (data: unknown) => {
          if (typeof data === 'object' && data !== null && 'content' in data) {
            const content = (data as { content: string }).content
            generatedContentRef.current += content
            setGeneratingOutput(prev => prev + content)
          }
        },
        async () => {
          const fullContent = generatedContentRef.current
          const extractedTitle = extractTitleFromContent(fullContent)

          if (extractedTitle) {
            await api.chapters.update(newChapter.id, { title: extractedTitle })
            toast.success(`章节已生成：${extractedTitle}`)
          } else {
            toast.success('章节已生成')
          }

          queryClient.invalidateQueries({ queryKey: ['chapters', novelId] })
          setIsGeneratingContent(false)
          setGeneratingChapterId(null)
          setNextChapterDialogOpen(false)
          setSelectedVolumeForNext(null)
          setGeneratingOutput('')

          if (onChapterSelect) {
            onChapterSelect(newChapter.id)
          }
        },
        (e: Error) => {
          toast.error(`生成失败: ${e.message}`)
          api.chapters.delete(newChapter.id).catch(() => {})
          queryClient.invalidateQueries({ queryKey: ['chapters', novelId] })
          setIsGeneratingContent(false)
          setGeneratingChapterId(null)
        }
      )

      stopGenerateRef.current = stop
    } catch (err) {
      toast.error(`创建章节失败: ${(err as Error).message}`)
      setIsGeneratingNext(false)
    }
  }

  const handleCancelGenerate = useCallback(() => {
    if (stopGenerateRef.current) {
      stopGenerateRef.current()
      stopGenerateRef.current = null
    }
    if (generatingChapterId) {
      api.chapters.delete(generatingChapterId).catch(() => {})
      queryClient.invalidateQueries({ queryKey: ['chapters', novelId] })
    }
    setIsGeneratingContent(false)
    setGeneratingChapterId(null)
    setGeneratingOutput('')
    generatedContentRef.current = ''
    setNextChapterDialogOpen(false)
    setSelectedVolumeForNext(null)
  }, [generatingChapterId, novelId, queryClient])

  const handleStartGenerateNextQueue = async () => {
    if (!selectedVolumeForNext || !chapters) return
    setIsQueueSubmitting(true)

    const maxOrder = chapters.length > 0 ? Math.max(...chapters.map(c => c.sortOrder)) : -1
    const chapterNumber = chapters.length + 1
    const tempTitle = `第${chapterNumber}章`

    try {
      const newChapter = await api.chapters.create({
        novelId,
        title: tempTitle,
        sortOrder: maxOrder + 1,
        content: null,
        volumeId: selectedVolumeForNext.id,
        summary: '',
      })

      const result = await api.generate.chapterQueue({
        chapterId: newChapter.id,
        novelId,
        mode: 'generate',
      })

      if (result.ok) {
        setIsQueueSubmitted(true)
        setIsQueueSubmitting(false)
        toast.success('章节生成任务已提交到后台队列', {
          description: '您可以关闭页面，任务将在后台继续执行',
          duration: 5000,
        })
        queryClient.invalidateQueries({ queryKey: ['chapters', novelId] })

        setTimeout(() => {
          setNextChapterDialogOpen(false)
          setSelectedVolumeForNext(null)
          setIsQueueSubmitted(false)
        }, 2000)

        if (onChapterSelect) {
          onChapterSelect(newChapter.id)
        }
      } else {
        throw new Error(result.error || '提交失败')
      }
    } catch (err) {
      toast.error(`提交失败: ${(err as Error).message}`)
      setIsQueueSubmitting(false)
    }
  }

  const handleCloseDialog = (open: boolean) => {
    if (!open && isGeneratingContent) {
      handleCancelGenerate()
      return
    }
    setNextChapterDialogOpen(open)
    if (!open) {
      setSelectedVolumeForNext(null)
      setGeneratingOutput('')
      setGeneratingChapterId(null)
    }
  }

  const { data: chapters, isLoading } = useQuery({
    queryKey: ['chapters', novelId],
    queryFn: () => api.chapters.list(novelId),
  })

  const { data: volumes } = useQuery({
    queryKey: ['volumes', novelId],
    queryFn: () => api.volumes.list(novelId),
  })

  const { data: plHistory } = useQuery({
    queryKey: ['power-level-history', novelId],
    queryFn: () => api.powerLevel.history(novelId),
    enabled: !!novelId,
  })

  const chapterBreakthroughs = useMemo(() => {
    const map = new Map<string, Array<{ characterName: string; from: string; to: string }>>()
    if (!plHistory?.history) return map
    for (const item of plHistory.history) {
      for (const bt of item.breakthroughs) {
        if (!map.has(bt.chapterId)) map.set(bt.chapterId, [])
        map.get(bt.chapterId)!.push({ characterName: item.characterName, from: bt.from, to: bt.to })
      }
    }
    return map
  }, [plHistory])

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

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ChapterStatus }) =>
      api.chapters.update(id, { status } as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chapters', novelId] })
      toast.success('状态已更新')
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
      summary: '',
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

  const toggleChapter = (chapterId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpandedChapters(prev => {
      const next = new Set(prev)
      if (next.has(chapterId)) next.delete(chapterId)
      else next.add(chapterId)
      return next
    })
  }

  const renderChapter = (chapter: Chapter, idx: number) => {
    const statusInfo = chapterStatusConfig[chapter.status] || chapterStatusConfig.draft
    const isExpanded = expandedChapters.has(chapter.id)

    return (
      <div
        key={chapter.id}
        className="hover:bg-muted/60 rounded-md transition-colors"
      >
        <div
          className="flex items-center gap-3 py-2 px-3 cursor-pointer group"
          onClick={() => onChapterSelect?.(chapter.id)}
        >
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 shrink-0"
            onClick={(e) => toggleChapter(chapter.id, e)}
          >
            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </Button>
          <span className="text-[11px] text-muted-foreground/40 w-5 text-right shrink-0 font-mono tabular-nums">
            {String(idx + 1).padStart(2, '0')}
          </span>
          <div className="flex-1 min-w-0 space-y-1">
            <p className="text-sm truncate leading-tight">{chapter.title}</p>
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-medium cursor-pointer hover:opacity-80 transition-opacity ${statusInfo.color}`}>
                    {statusInfo.icon}
                    {statusInfo.label}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="right">
                  {(Object.entries(chapterStatusConfig) as [ChapterStatus, typeof chapterStatusConfig[keyof typeof chapterStatusConfig]][]).map(([key, config]) => (
                    <DropdownMenuItem
                      key={key}
                      className="gap-2 cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (key !== chapter.status) {
                          updateStatusMutation.mutate({ id: chapter.id, status: key })
                        }
                      }}
                      disabled={updateStatusMutation.isPending}
                    >
                      <span className={config.color.split(' ')[0]}>{config.icon}</span>
                      {config.label}
                      {key === chapter.status && <span className="ml-auto text-[10px] text-muted-foreground">当前</span>}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {chapter.wordCount > 0 && (
                <span className="text-[11px] text-muted-foreground/60">
                  {chapter.wordCount.toLocaleString()} 字
                </span>
              )}
              {(() => {
                const bts = chapterBreakthroughs.get(chapter.id)
                if (!bts || bts.length === 0) return null
                return (
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-sm bg-purple-50 dark:bg-purple-950 text-purple-600 dark:text-purple-400 text-[10px] font-medium">
                    <Zap className="h-2.5 w-2.5" />
                    {bts[0].characterName}: {bts[0].from}→{bts[0].to}
                    {bts.length > 1 && <span className="ml-0.5 opacity-60">+{bts.length - 1}</span>}
                  </span>
                )
              })()}
            </div>
          </div>
          <div className="flex items-center opacity-0 group-hover:opacity-100 shrink-0 transition-opacity">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={(e) => {
                e.stopPropagation()
                navigate(`/novels/${novelId}/read/${chapter.id}`)
              }}
            >
              <BookOpen className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive"
              onClick={(e) => {
                e.stopPropagation()
                if (confirm('确定要删除这个章节吗？')) {
                  deleteMutation.mutate(chapter.id)
                }
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        {isExpanded && (
          <div className="border-t bg-muted/30 px-3 py-2 space-y-1.5">
            {chapter.summary && (
              <div className="flex items-start gap-2">
                <FileText className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground/70 line-clamp-2 leading-relaxed">
                  摘要：{chapter.summary}
                </p>
              </div>
            )}
            {chapter.modelUsed && (
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60">
                <Sparkles className="h-3 w-3" />
                <span>生成模型：{chapter.modelUsed}</span>
                {chapter.generationTime && (
                  <span>· 耗时 {chapter.generationTime}ms</span>
                )}
              </div>
            )}
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground/60">
              <span>创建于 {new Date(chapter.createdAt * 1000).toLocaleDateString()}</span>
              {chapter.summaryAt && (
                <span>摘要更新于 {new Date(chapter.summaryAt * 1000).toLocaleDateString()}</span>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  const renderVolumeGroup = (volume: Volume | null, volumeId: string) => {
    const volumeChapters = chaptersByVolume[volumeId] || []
    if (volumeChapters.length === 0 && volumeId !== 'uncategorized') return null

    const isExpanded = expandedVolumes.has(volumeId)
    const totalWords = volumeChapters.reduce((sum, ch) => sum + ch.wordCount, 0)

    return (
      <div key={volumeId} className="mb-1">
        <div
          className="flex items-center gap-2 py-2 px-3 hover:bg-muted/50 rounded-lg cursor-pointer transition-colors"
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
              <span className="text-xs font-semibold truncate flex-1">{volume.title}</span>
            </>
          ) : (
            <>
              <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground truncate flex-1">未分类</span>
            </>
          )}

          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[11px] text-muted-foreground/70 tabular-nums">
              {volumeChapters.length} 章
            </span>
            {totalWords > 0 && (
              <span className="text-[11px] text-muted-foreground/50 tabular-nums">
                {(totalWords / 1000).toFixed(1)}k字
              </span>
            )}
          </div>
        </div>

        {isExpanded && (
          <div className="ml-3 mt-0.5 border-l border-border/50 pl-1">
            {volumeChapters.map((chapter, idx) => renderChapter(chapter, idx))}
          </div>
        )}
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="p-4 space-y-2">
        {[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-muted rounded-md animate-pulse" />)}
      </div>
    )
  }

  const sortedVolumes = [...(volumes || [])].sort((a, b) => a.sortOrder - b.sortOrder)

  return (
    <div className="flex flex-col h-full">
      {/* 操作栏 */}
      <div className="px-3 py-2.5 border-b flex items-center justify-between gap-2">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="w-full gap-2 h-8">
              <Plus className="h-3.5 w-3.5" />
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

        <Dialog open={nextChapterDialogOpen} onOpenChange={handleCloseDialog}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="w-full gap-2 h-8">
              <Wand2 className="h-3.5 w-3.5" />
              生成下一章
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Wand2 className="h-5 w-5 text-primary" />
                AI 生成下一章
              </DialogTitle>
              <DialogDescription>
                {isGeneratingContent
                  ? '正在生成章节内容...'
                  : '选择目标卷，即时生成或后台生成章节正文'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 flex-1 overflow-hidden">
              {!isGeneratingContent ? (
                <div className="space-y-4">
                  <div className="bg-muted/50 p-3 rounded-lg">
                    <p className="text-sm font-medium">目标卷：《{selectedVolumeForNext?.title || '请选择卷'}》</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      选择卷后可选择"即时生成"（等待完成）或"后台生成"（可关闭页面）
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>选择卷</Label>
                    <Select value={selectedVolumeForNext?.id || ''} onValueChange={(v) => {
                      const volume = volumes?.find(vol => vol.id === v)
                      if (volume) setSelectedVolumeForNext(volume)
                    }}>
                      <SelectTrigger><SelectValue placeholder="选择目标卷" /></SelectTrigger>
                      <SelectContent>
                        {volumes?.map(v => (
                          <SelectItem key={v.id} value={v.id}>{v.title}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <Button
                    onClick={handleStartGenerateNext}
                    disabled={isGeneratingNext || !selectedVolumeForNext || isQueueSubmitting || isQueueSubmitted}
                    className="flex-1 gap-2"
                  >
                    {isGeneratingNext ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        创建中...
                      </>
                    ) : (
                      <>
                        <Wand2 className="h-4 w-4" />
                        即时生成
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleStartGenerateNextQueue}
                    disabled={isGeneratingNext || !selectedVolumeForNext || isQueueSubmitting || isQueueSubmitted}
                    className="flex-1 gap-2"
                    title="提交到后台队列生成，可关闭页面"
                  >
                    {isQueueSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        提交中...
                      </>
                    ) : isQueueSubmitted ? (
                      <>
                        <Wand2 className="h-4 w-4 text-green-600" />
                        已提交
                      </>
                    ) : (
                      <>
                        <CloudUpload className="h-4 w-4" />
                        后台生成
                      </>
                    )}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3 flex-1 overflow-hidden flex flex-col">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      <span className="text-sm font-medium">正在生成...</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {generatingOutput.length.toLocaleString()} 字
                    </span>
                  </div>

                  <ScrollArea className="flex-1 h-[400px] border rounded-lg p-3 bg-muted/30">
                    <pre className="text-sm whitespace-pre-wrap font-mono leading-relaxed">
                      {generatingOutput || '等待内容...'}
                    </pre>
                  </ScrollArea>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={handleCancelGenerate}
                      className="flex-1 gap-2"
                    >
                      <Square className="h-4 w-4" />
                      取消生成
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* 章节列表 */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {chapters && chapters.length > 0 ? (
          <>
            {sortedVolumes.map(volume => renderVolumeGroup(volume, volume.id))}
            {chaptersByVolume['uncategorized'] && chaptersByVolume['uncategorized'].length > 0 && (
              renderVolumeGroup(null, 'uncategorized')
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <BookOpen className="h-10 w-10 mb-3 opacity-20" />
            <p className="text-sm">暂无章节</p>
            <p className="text-xs mt-1 opacity-60">点击上方按钮创建第一章</p>
          </div>
        )}
      </div>
    </div>
  )
}
