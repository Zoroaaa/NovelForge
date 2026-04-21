/**
 * @file SettingsPanel.tsx
 * @description 小说设定面板组件，管理世界观、力量体系、势力等设定
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { NovelSetting } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Plus, Trash2, Edit2, Save, X, ChevronDown, ChevronRight, Globe, Sword, Users, Map, Package } from 'lucide-react'
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

interface SettingsPanelProps {
  novelId: string
}

const SETTING_TYPES = [
  { value: 'worldview', label: '世界观', icon: Globe, color: 'bg-blue-500' },
  { value: 'power_system', label: '境界体系', icon: Sword, color: 'bg-purple-500' },
  { value: 'faction', label: '势力组织', icon: Users, color: 'bg-red-500' },
  { value: 'geography', label: '地理环境', icon: Map, color: 'bg-green-500' },
  { value: 'item_skill', label: '宝物功法', icon: Package, color: 'bg-yellow-500' },
  { value: 'misc', label: '其他设定', icon: Package, color: 'bg-gray-500' },
]

const IMPORTANCE_OPTIONS = [
  { value: 'high', label: '重要', color: 'bg-red-100 text-red-800' },
  { value: 'normal', label: '一般', color: 'bg-gray-100 text-gray-800' },
  { value: 'low', label: '次要', color: 'bg-blue-100 text-blue-800' },
]

export function SettingsPanel({ novelId }: SettingsPanelProps) {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set())
  
  // 表单状态
  const [formData, setFormData] = useState<{
    type: 'worldview' | 'power_system' | 'faction' | 'geography' | 'item_skill' | 'misc'
    category: string
    name: string
    content: string
    importance: 'high' | 'normal' | 'low'
  }>({
    type: 'worldview',
    category: '',
    name: '',
    content: '',
    importance: 'normal',
  })

  // 查询所有设定
  const { data: settingsData, isLoading } = useQuery({
    queryKey: ['settings', novelId],
    queryFn: () => api.settings.list(novelId),
  })

  const settings = settingsData?.settings || []

  // 创建/更新 mutation
  const createMutation = useMutation({
    mutationFn: (data: typeof formData) => 
      api.settings.create({ ...data, novelId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      toast.success('✅ 设定创建成功')
      resetForm()
      setDialogOpen(false)
    },
    onError: (err) => toast.error(`❌ 创建失败: ${(err as Error).message}`),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<NovelSetting> }) =>
      api.settings.update(id, data as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      toast.success('✅ 设定更新成功')
      setEditingId(null)
      resetForm()
    },
    onError: (err) => toast.error(`❌ 更新失败: ${(err as Error).message}`),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.settings.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      toast.success('✅ 设定已删除')
    },
    onError: (err) => toast.error(`❌ 删除失败: ${(err as Error).message}`),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name.trim() || !formData.content.trim()) {
      toast.warning('请填写名称和内容')
      return
    }
    
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: formData })
    } else {
      createMutation.mutate(formData)
    }
  }

  const handleEdit = (setting: NovelSetting) => {
    setEditingId(setting.id)
    setFormData({
      type: setting.type as 'worldview' | 'power_system' | 'faction' | 'geography' | 'item_skill' | 'misc',
      category: setting.category || '',
      name: setting.name,
      content: setting.content || '',
      importance: setting.importance,
    })
    setDialogOpen(true)
  }

  const handleDelete = (id: string) => {
    if (confirm('确定要删除这个设定吗？')) {
      deleteMutation.mutate(id)
    }
  }

  const toggleTypeExpand = (type: string) => {
    setExpandedTypes(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  const resetForm = () => {
    setFormData({ type: 'worldview', category: '', name: '', content: '', importance: 'normal' })
    setEditingId(null)
  }

  // 按类型分组
  const groupedSettings = settings.reduce((acc, s) => {
    if (!acc[s.type]) acc[s.type] = []
    acc[s.type].push(s)
    return acc
  }, {} as Record<string, NovelSetting[]>)

  if (isLoading) return <div className="p-4 text-center">加载中...</div>

  return (
    <div className="space-y-4">
      {/* 头部操作栏 */}
      <div className="px-3 pt-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">共 {settings.length} 条设定</span>
          
          <Dialog open={dialogOpen} onOpenChange={(open) => {
            setDialogOpen(open)
            if (!open) resetForm()
          }}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-7 gap-1.5 text-xs">
                <Plus className="h-3.5 w-3.5" />
                新增设定
              </Button>
            </DialogTrigger>
          
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingId ? '编辑设定' : '新增设定'}</DialogTitle>
            </DialogHeader>
            
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>类型</Label>
                  <Select 
                    value={formData.type} 
                    onValueChange={(v) => setFormData(prev => ({ ...prev, type: v as 'worldview' | 'power_system' | 'faction' | 'geography' | 'item_skill' | 'misc' }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SETTING_TYPES.map(t => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

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
                <Label>子分类（可选）</Label>
                <Input
                  placeholder="如：修仙、魔法、科技..."
                  value={formData.category}
                  onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <Label>名称 *</Label>
                <Input
                  placeholder="设定名称"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label>详细描述 *（支持 Markdown）</Label>
                <Textarea
                  placeholder="详细描述这个设定..."
                  rows={8}
                  value={formData.content}
                  onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
                  required
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

      {/* 设定列表（按类型分组展示） */}
      <div className="px-3 pb-3 space-y-1.5">
        {SETTING_TYPES.map(({ value, label, icon: Icon, color }) => {
          const items = groupedSettings[value] || []
          const isExpanded = expandedTypes.has(value)
          
          return (
            <div key={value} className="border rounded-lg overflow-hidden">
              <button
                onClick={() => toggleTypeExpand(value)}
                className="w-full flex items-center gap-3 p-3 hover:bg-muted/50 transition-colors"
              >
                <div className={`w-3 h-3 rounded-full ${color}`} />
                <Icon className="h-4 w-4" />
                <span className="font-medium flex-1 text-left">{label}</span>
                <Badge variant="secondary">{items.length}</Badge>
                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>

              {isExpanded && (
                <div className="border-t divide-y">
                  {items.length === 0 ? (
                    <div className="p-4 text-center text-sm text-muted-foreground">
                      暂无{label}设定
                    </div>
                  ) : (
                    items.map(item => (
                      <div key={item.id} className="p-3 hover:bg-muted/30 transition-colors group">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium truncate">{item.name}</span>
                              <Badge 
                                variant="outline" 
                                className={`text-xs ${IMPORTANCE_OPTIONS.find(o => o.value === item.importance)?.color}`}
                              >
                                {IMPORTANCE_OPTIONS.find(o => o.value === item.importance)?.label}
                              </Badge>
                            </div>
                            {item.category && (
                              <span className="text-xs text-muted-foreground">#{item.category}</span>
                            )}
                            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                              {item.content?.slice(0, 100)}...
                            </p>
                          </div>
                          
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
                    ))
                  )}
                </div>
              )}
            </div>
          )
        })}

        {settings.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <p className="mb-2">📚 还没有小说设定</p>
            <p className="text-sm">点击上方按钮添加世界观、境界体系等设定</p>
          </div>
        )}
      </div>
    </div>
  )
}
