/**
 * @file ForeshadowingPanel.tsx
 * @description 伏笔管理面板组件，提供伏笔的创建、编辑、状态管理功能
 * @version 2.0.0 - 添加章节关联功能
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { ForeshadowingItem, Chapter } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Plus, Trash2, Edit2, AlertTriangle, CheckCircle, Ban, FileText } from 'lucide-react'
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
import { Badge } from '@/components/ui/badge'

interface ForeshadowingPanelProps {
  novelId: string
  onChapterSelect?: (chapterId: string) => void
}

const STATUS_CONFIG = {
  open: {
    label: '未收尾',
    icon: AlertTriangle,
    color: 'text-yellow-600 bg-yellow-50 border-yellow-200',
    badge: 'bg-yellow-100 text-yellow-800',
  },
  resolved: {
    label: '已收尾',
    icon: CheckCircle,
    color: 'text-green-600 bg-green-50 border-green-200',
    badge: 'bg-green-100 text-green-800',
  },
  abandoned: {
    label: '已放弃',
    icon: Ban,
    color: 'text-gray-500 bg-gray-50 border-gray-200',
    badge: 'bg-gray-100 text-gray-600',
  },
} as const

const IMPORTANCE_OPTIONS = [
  { value: 'high', label: '重要', color: 'bg-red-100 text-red-800' },
  { value: 'normal', label: '一般', color: 'bg-gray-100 text-gray-800' },
  { value: 'low', label: '次要', color: 'bg-blue-100 text-blue-800' },
]

export function ForeshadowingPanel({ novelId, onChapterSelect }: ForeshadowingPanelProps) {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [resolveDialogOpen, setResolveDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [resolvingItem, setResolvingItem] = useState<ForeshadowingItem | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    importance: 'normal' as 'high' | 'normal' | 'low',
    chapterId: '' as string | null,
  })

  const [resolveChapterId, setResolveChapterId] = useState<string>('')

  const { data: foreshadowingData, isLoading } = useQuery({
    queryKey: ['foreshadowing', novelId],
    queryFn: () => api.foreshadowing.list(novelId),
  })

  const { data: chapters } = useQuery({
    queryKey: ['chapters', novelId],
    queryFn: () => api.chapters.list(novelId),
  })

  const chapterMap = (chapters || []).reduce((acc, ch) => {
    acc[ch.id] = ch
    return acc
  }, {} as Record<string, Chapter>)

  let foreshadowings = foreshadowingData?.foreshadowing || []
  
  if (statusFilter !== 'all') {
    foreshadowings = foreshadowings.filter(f => f.status === statusFilter)
  }

  const stats = (foreshadowingData?.foreshadowing || []).reduce((acc, f) => {
    acc[f.status] = (acc[f.status] || 0) + 1
    acc.total++
    return acc
  }, {} as Record<string, number>)

  const createMutation = useMutation({
    mutationFn: (data: typeof formData & { chapterId?: string | null }) =>
      api.foreshadowing.create({ 
        novelId, 
        title: data.title, 
        description: data.description || undefined,
        importance: data.importance,
        chapterId: data.chapterId || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['foreshadowing'] })
      toast.success('✅ 伏笔创建成功')
      resetForm()
      setDialogOpen(false)
    },
    onError: (err) => toast.error(`❌ 创建失败: ${(err as Error).message}`),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ForeshadowingItem> }) =>
      api.foreshadowing.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['foreshadowing'] })
      toast.success('✅ 伏笔更新成功')
      setEditingId(null)
      resetForm()
      setResolveDialogOpen(false)
      setResolvingItem(null)
    },
    onError: (err) => toast.error(`❌ 更新失败: ${(err as Error).message}`),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.foreshadowing.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['foreshadowing'] })
      toast.success('✅ 伏笔已删除')
    },
    onError: (err) => toast.error(`❌ 删除失败: ${(err as Error).message}`),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.title.trim()) {
      toast.warning('请填写伏笔标题')
      return
    }
    
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: formData })
    } else {
      createMutation.mutate(formData)
    }
  }

  const handleEdit = (item: ForeshadowingItem) => {
    setEditingId(item.id)
    setFormData({
      title: item.title,
      description: item.description || '',
      importance: item.importance,
      chapterId: item.chapterId || '',
    })
    setDialogOpen(true)
  }

  const handleResolve = (item: ForeshadowingItem) => {
    setResolvingItem(item)
    setResolveChapterId('')
    setResolveDialogOpen(true)
  }

  const handleResolveSubmit = () => {
    if (!resolvingItem) return
    updateMutation.mutate({
      id: resolvingItem.id,
      data: {
        status: 'resolved',
        resolvedChapterId: resolveChapterId || null,
      },
    })
  }

  const handleAbandon = (id: string) => {
    updateMutation.mutate({ id, data: { status: 'abandoned' } })
  }

  const handleDelete = (id: string) => {
    if (confirm('确定要删除这条伏笔吗？')) {
      deleteMutation.mutate(id)
    }
  }

  const resetForm = () => {
    setFormData({ title: '', description: '', importance: 'normal', chapterId: '' })
    setEditingId(null)
  }

  if (isLoading) return <div className="p-4 text-center">加载中...</div>

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2.5 border-b space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground tabular-nums">共 {stats.total || 0} 条</span>
          <span className={`text-xs px-1.5 py-0.5 rounded ${STATUS_CONFIG.open.badge}`}>
            ⚠️ 未收 {stats['open'] || 0}
          </span>
          <span className={`text-xs px-1.5 py-0.5 rounded ${STATUS_CONFIG.resolved.badge}`}>
            ✅ 已收 {stats['resolved'] || 0}
          </span>
          <span className={`text-xs px-1.5 py-0.5 rounded ${STATUS_CONFIG.abandoned.badge}`}>
            ❌ 放弃 {stats['abandoned'] || 0}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-7 text-xs flex-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              <SelectItem value="open">未收尾</SelectItem>
              <SelectItem value="resolved">已收尾</SelectItem>
              <SelectItem value="abandoned">已放弃</SelectItem>
            </SelectContent>
          </Select>

          <Dialog open={dialogOpen} onOpenChange={(open) => {
            setDialogOpen(open)
            if (!open) resetForm()
          }}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-8 gap-1.5 text-xs shrink-0">
                <Plus className="h-3.5 w-3.5" />
                新增伏笔
              </Button>
            </DialogTrigger>
            
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{editingId ? '编辑伏笔' : '新增伏笔'}</DialogTitle>
              </DialogHeader>
              
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label>伏笔标题 *</Label>
                  <Input
                    placeholder="如：主角身世之谜"
                    value={formData.title}
                    onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>重要性</Label>
                    <Select 
                      value={formData.importance} 
                      onValueChange={(v) => setFormData(prev => ({ ...prev, importance: v as any }))}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {IMPORTANCE_OPTIONS.map(o => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>埋设章节</Label>
                    <Select 
                      value={formData.chapterId || 'none'} 
                      onValueChange={(v) => setFormData(prev => ({ ...prev, chapterId: v === 'none' ? null : v }))}
                    >
                      <SelectTrigger><SelectValue placeholder="选择章节" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">未指定</SelectItem>
                        {chapters?.map(ch => (
                          <SelectItem key={ch.id} value={ch.id}>{ch.title}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>详细描述（可选）</Label>
                  <Textarea
                    placeholder="描述这个伏笔的具体内容、预期收尾方式等..."
                    rows={4}
                    value={formData.description}
                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
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
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {foreshadowings.length === 0 ? (
          <div className="border rounded-lg p-6 text-center bg-muted/10">
            <AlertTriangle className="h-8 w-8 mx-auto text-muted-foreground opacity-50 mb-3" />
            <h3 className="font-medium mb-1 text-sm">还没有伏笔记录</h3>
            <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
              AI 在生成章节时会自动识别和提取伏笔，你也可以手动添加和管理伏笔，确保剧情连贯性。
            </p>
            
            <Button onClick={() => setDialogOpen(true)} className="gap-2" size="sm">
              <Plus className="h-4 w-4" />
              添加第一条伏笔
            </Button>
          </div>
        ) : (
          foreshadowings.map(item => {
            const statusConfig = STATUS_CONFIG[item.status]
            const StatusIcon = statusConfig.icon
            const plantChapter = item.chapterId ? chapterMap[item.chapterId] : null
            const resolveChapter = item.resolvedChapterId ? chapterMap[item.resolvedChapterId] : null
            
            return (
              <div key={item.id} className={`border rounded-lg p-3 transition-colors hover:bg-muted/20 ${statusConfig.color}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2 flex-1 min-w-0">
                    <StatusIcon className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-medium text-sm">{item.title}</span>
                        
                        <Badge variant="outline" className={`text-[10px] ${IMPORTANCE_OPTIONS.find(o => o.value === item.importance)?.color}`}>
                          {IMPORTANCE_OPTIONS.find(o => o.value === item.importance)?.label}
                        </Badge>
                        
                        <Badge variant="outline" className={`text-[10px] ${statusConfig.badge}`}>
                          {statusConfig.label}
                        </Badge>
                      </div>
                      
                      {item.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {item.description}
                        </p>
                      )}

                      <div className="flex items-center gap-3 mt-2 text-[10px]">
                        {plantChapter && (
                          <span 
                            className="flex items-center gap-1 text-blue-600 cursor-pointer hover:underline"
                            onClick={() => onChapterSelect?.(plantChapter.id)}
                          >
                            <FileText className="h-3 w-3" />
                            埋设于「{plantChapter.title}」
                          </span>
                        )}
                        {resolveChapter && (
                          <span 
                            className="flex items-center gap-1 text-green-600 cursor-pointer hover:underline"
                            onClick={() => onChapterSelect?.(resolveChapter.id)}
                          >
                            <CheckCircle className="h-3 w-3" />
                            收尾于「{resolveChapter.title}」
                          </span>
                        )}
                      </div>
                      
                      <div className="text-[10px] text-muted-foreground mt-1.5">
                        创建于 {new Date(item.createdAt * 1000).toLocaleDateString()}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {item.status === 'open' && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-green-600 hover:text-green-700 text-xs"
                          onClick={() => handleResolve(item)}
                          disabled={updateMutation.isPending}
                        >
                          <CheckCircle className="h-3 w-3 mr-1" />
                          收尾
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-gray-500 text-xs"
                          onClick={() => handleAbandon(item.id)}
                          disabled={updateMutation.isPending}
                        >
                          <Ban className="h-3 w-3 mr-1" />
                          放弃
                        </Button>
                      </>
                    )}
                    
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => handleEdit(item)}
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </Button>
                    
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive"
                      onClick={() => handleDelete(item.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      <Dialog open={resolveDialogOpen} onOpenChange={setResolveDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>收尾伏笔</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              选择伏笔「{resolvingItem?.title}」收尾的章节：
            </p>
            
            <Select value={resolveChapterId} onValueChange={setResolveChapterId}>
              <SelectTrigger><SelectValue placeholder="选择收尾章节" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">未指定</SelectItem>
                {chapters?.map(ch => (
                  <SelectItem key={ch.id} value={ch.id}>{ch.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setResolveDialogOpen(false)}>
                取消
              </Button>
              <Button onClick={handleResolveSubmit} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? '处理中...' : '确认收尾'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
