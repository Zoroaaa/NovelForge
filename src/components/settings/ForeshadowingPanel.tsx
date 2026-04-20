import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { ForeshadowingItem } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Plus, Trash2, Edit2, Save, X, AlertTriangle, CheckCircle, Ban, Circle } from 'lucide-react'
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

export function ForeshadowingPanel({ novelId }: ForeshadowingPanelProps) {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  
  // 表单状态
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    importance: 'normal' as 'high' | 'normal' | 'low',
  })

  // 查询所有伏笔
  const { data: foreshadowingData, isLoading } = useQuery({
    queryKey: ['foreshadowing', novelId],
    queryFn: () => api.foreshadowing.list(novelId),
  })

  let foreshadowings = foreshadowingData?.foreshadowing || []
  
  // 状态筛选
  if (statusFilter !== 'all') {
    foreshadowings = foreshadowings.filter(f => f.status === statusFilter)
  }

  // 统计各状态数量
  const stats = (foreshadowingData?.foreshadowing || []).reduce((acc, f) => {
    acc[f.status] = (acc[f.status] || 0) + 1
    acc.total++
    return acc
  }, {} as Record<string, number>)

  // 创建 mutation
  const createMutation = useMutation({
    mutationFn: (data: typeof formData) =>
      api.foreshadowing.create({ ...data, novelId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['foreshadowing'] })
      toast.success('✅ 伏笔创建成功')
      resetForm()
      setDialogOpen(false)
    },
    onError: (err) => toast.error(`❌ 创建失败: ${(err as Error).message}`),
  })

  // 更新 mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ForeshadowingItem> }) =>
      api.foreshadowing.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['foreshadowing'] })
      toast.success('✅ 伏笔更新成功')
      setEditingId(null)
      resetForm()
    },
    onError: (err) => toast.error(`❌ 更新失败: ${(err as Error).message}`),
  })

  // 删除 mutation
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
    })
    setDialogOpen(true)
  }

  const handleStatusChange = (id: string, newStatus: 'resolved' | 'abandoned') => {
    updateMutation.mutate({ 
      id, 
      data: { status: newStatus }
    })
  }

  const handleDelete = (id: string) => {
    if (confirm('确定要删除这条伏笔吗？')) {
      deleteMutation.mutate(id)
    }
  }

  const resetForm = () => {
    setFormData({ title: '', description: '', importance: 'normal' })
    setEditingId(null)
  }

  if (isLoading) return <div className="p-4 text-center">加载中...</div>

  return (
    <div className="space-y-4">
      {/* 头部统计栏 */}
      <div className="flex items-center justify-between px-4 pt-4">
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="gap-1">
            <Circle className="h-3 w-3 fill-current" />
            共 {(stats.total || 0)} 条
          </Badge>
          
          <div className="flex items-center gap-1 text-xs">
            <span className={`px-2 py-0.5 rounded ${STATUS_CONFIG.open.badge}`}>
              ⚠️ 未收尾: {(stats['open'] || 0)}
            </span>
            <span className={`px-2 py-0.5 rounded ${STATUS_CONFIG.resolved.badge}`}>
              ✅ 已收尾: {(stats['resolved'] || 0)}
            </span>
            <span className={`px-2 py-0.5 rounded ${STATUS_CONFIG.abandoned.badge}`}>
              ❌ 已放弃: {(stats['abandoned'] || 0)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* 状态筛选 */}
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[120px] h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              <SelectItem value="open">未收尾</SelectItem>
              <SelectItem value="resolved">已收尾</SelectItem>
              <SelectItem value="abandoned">已放弃</SelectItem>
            </SelectContent>
          </Select>

          {/* 新建按钮 */}
          <Dialog open={dialogOpen} onOpenChange={(open) => {
            setDialogOpen(open)
            if (!open) resetForm()
          }}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2">
                <Plus className="h-4 w-4" />
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

      {/* 伏笔列表 */}
      <div className="px-4 pb-4 space-y-2">
        {foreshadowings.length === 0 ? (
          /* 空状态 */
          <div className="border rounded-lg p-12 text-center bg-muted/10">
            <AlertTriangle className="h-12 w-12 mx-auto text-muted-foreground opacity-50 mb-4" />
            <h3 className="font-medium mb-2">还没有伏笔记录</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
              伏笔是小说的重要叙事工具。AI 在生成章节时会自动识别和提取伏笔，
              你也可以手动添加和管理伏笔，确保剧情的连贯性和悬念感。
            </p>
            
            <Button onClick={() => setDialogOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              添加第一条伏笔
            </Button>
          </div>
        ) : (
          /* 伏笔列表 */
          foreshadowings.map(item => {
            const statusConfig = STATUS_CONFIG[item.status]
            const StatusIcon = statusConfig.icon
            
            return (
              <div key={item.id} className={`border rounded-lg p-4 transition-colors hover:bg-muted/20 ${statusConfig.color}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <StatusIcon className="h-5 w-5 mt-0.5 flex-shrink-0" />
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-medium">{item.title}</span>
                        
                        <Badge variant="outline" className={`text-xs ${IMPORTANCE_OPTIONS.find(o => o.value === item.importance)?.color}`}>
                          {IMPORTANCE_OPTIONS.find(o => o.value === item.importance)?.label}
                        </Badge>
                        
                        <Badge variant="outline" className={`text-xs ${statusConfig.badge}`}>
                          {statusConfig.label}
                        </Badge>
                      </div>
                      
                      {item.description && (
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                          {item.description}
                        </p>
                      )}

                      {item.resolvedChapterId && (
                        <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                          <CheckCircle className="h-3 w-3" />
                          已在第 {item.resolvedChapterId.slice(0, 8)}... 章收尾
                        </p>
                      )}
                      
                      <div className="text-xs text-muted-foreground mt-2">
                        创建于 {new Date(item.createdAt * 1000).toLocaleDateString()}
                      </div>
                    </div>
                  </div>

                  {/* 操作按钮 */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {item.status === 'open' && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 px-2 text-green-600 hover:text-green-700"
                          onClick={() => handleStatusChange(item.id, 'resolved')}
                          disabled={updateMutation.isPending}
                        >
                          <CheckCircle className="h-4 w-4 mr-1" />
                          收尾
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 px-2 text-gray-500"
                          onClick={() => handleStatusChange(item.id, 'abandoned')}
                          disabled={updateMutation.isPending}
                        >
                          <Ban className="h-4 w-4 mr-1" />
                          放弃
                        </Button>
                      </>
                    )}
                    
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => handleEdit(item)}
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive"
                      onClick={() => handleDelete(item.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
