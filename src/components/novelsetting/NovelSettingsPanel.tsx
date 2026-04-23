/**
 * @file NovelSettingsPanel.tsx
 * @description 小说设定面板组件，管理世界观、力量体系、势力等设定
 * @version 1.1.0 - 增加摘要字段与手动摘要生成
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { NovelSetting } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Plus, Trash2, Edit2, ChevronDown, ChevronRight, Globe, Sword, Users, Map, Package, Sparkles } from 'lucide-react'
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

interface NovelSettingsPanelProps {
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

export function NovelSettingsPanel({ novelId }: NovelSettingsPanelProps) {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set())
  
  const [formData, setFormData] = useState<{
    type: 'worldview' | 'power_system' | 'faction' | 'geography' | 'item_skill' | 'misc'
    category: string
    name: string
    summary: string
    content: string
    attributes: string
    importance: 'high' | 'normal' | 'low'
  }>({
    type: 'worldview',
    category: '',
    name: '',
    summary: '',
    content: '',
    attributes: '',
    importance: 'normal',
  })

  const { data: settingsData, isLoading } = useQuery({
    queryKey: ['settings', novelId],
    queryFn: () => api.settings.list(novelId),
  })

  const settings = settingsData?.settings || []

  const createMutation = useMutation({
    mutationFn: (data: typeof formData) => {
      const { attributes, ...rest } = data
      return api.settings.create({
        ...rest,
        novelId,
        attributes: attributes.trim() || undefined,
        summary: rest.summary.trim() || undefined,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      toast.success('✅ 设定创建成功')
      resetForm()
      setDialogOpen(false)
    },
    onError: (err) => toast.error(`❌ 创建失败: ${(err as Error).message}`),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<NovelSetting> & { attributes?: string; summary?: string } }) => {
      const { attributes, ...rest } = data
      return api.settings.update(id, {
        ...rest,
        attributes: attributes?.trim() || undefined,
        summary: rest.summary?.trim() || undefined,
      } as Record<string, unknown>)
    },
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
      summary: setting.summary || '',
      content: setting.content || '',
      attributes: setting.attributes || '',
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

  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false)

  const handleAutoSummary = async () => {
    if (!formData.content.trim()) {
      toast.warning('请先填写详细描述')
      return
    }
    
    if (!editingId) {
      toast.info('请先保存设定后再生成摘要')
      return
    }

    setIsGeneratingSummary(true)
    try {
      const result = await api.settings.generateSummary(editingId)
      if (result.ok && result.summary) {
        setFormData(prev => ({ ...prev, summary: result.summary! }))
        queryClient.invalidateQueries({ queryKey: ['settings'] })
        toast.success(`摘要已生成 (${result.summary.length} 字)`)
      } else {
        toast.error(result.error || '生成失败')
      }
    } catch (err) {
      toast.error(`生成摘要异常: ${(err as Error).message}`)
    } finally {
      setIsGeneratingSummary(false)
    }
  }

  const resetForm = () => {
    setFormData({ type: 'worldview', category: '', name: '', summary: '', content: '', attributes: '', importance: 'normal' })
    setEditingId(null)
  }

  const groupedSettings = settings.reduce((acc, s) => {
    if (!acc[s.type]) acc[s.type] = []
    acc[s.type].push(s)
    return acc
  }, {} as Record<string, NovelSetting[]>)

  if (isLoading) return (
    <div className="p-4 space-y-2">
      {[...Array(4)].map((_, i) => <div key={i} className="h-12 bg-muted rounded-lg animate-pulse" />)}
    </div>
  )

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground tabular-nums">{settings.length} 条</span>
        
        <Dialog open={dialogOpen} onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) resetForm()
        }}>
          <DialogTrigger asChild>
            <Button size="sm" className="h-8 gap-1.5 text-xs shrink-0">
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
                    onValueChange={(v) => setFormData(prev => ({ ...prev, importance: v as 'normal' | 'high' | 'low' }))}
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
                <Label className="flex items-center gap-1.5">
                  摘要（RAG 索引用，≤400字）
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={`h-6 px-2 text-[11px] gap-1 text-muted-foreground hover:text-primary ${isGeneratingSummary ? 'animate-pulse' : ''}`}
                    onClick={handleAutoSummary}
                    disabled={isGeneratingSummary}
                  >
                    <Sparkles className={`h-3 w-3 ${isGeneratingSummary ? 'animate-spin' : ''}`} />
                    {isGeneratingSummary ? '生成中...' : 'AI 生成摘要'}
                  </Button>
                </Label>
                <Textarea
                  placeholder="用于语义检索的精炼摘要，留空则自动从描述截取前400字"
                  rows={3}
                  maxLength={400}
                  value={formData.summary}
                  onChange={(e) => setFormData(prev => ({ ...prev, summary: e.target.value }))}
                />
                <p className="text-[10px] text-muted-foreground flex justify-between">
                  <span>{formData.summary.length}/400 字</span>
                  <span>此摘要将用于向量索引检索，影响 AI 写作时是否能找到该设定</span>
                </p>
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

              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  属性扩展（可选，JSON格式）
                </Label>
                <Textarea
                  placeholder='如：{"levels": ["练气期", "筑基期", "金丹期"], "maxLevel": 9}'
                  rows={2}
                  value={formData.attributes}
                  onChange={(e) => setFormData(prev => ({ ...prev, attributes: e.target.value }))}
                />
                <p className="text-[10px] text-muted-foreground">用于存储境界等级列表、技能体系等结构化数据（选填）</p>
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

      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {SETTING_TYPES.map(({ value, label, icon: Icon, color }) => {
          const items = groupedSettings[value] || []
          const isExpanded = expandedTypes.has(value)
          
          return (
            <div key={value} className="rounded-lg border overflow-hidden">
              <button
                onClick={() => toggleTypeExpand(value)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-muted/50 transition-colors"
              >
                <div className={`w-2 h-2 rounded-full shrink-0 ${color}`} />
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="text-sm font-medium flex-1 text-left">{label}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{items.length}</span>
                {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
              </button>

              {isExpanded && (
                <div className="border-t divide-y">
                  {items.length === 0 ? (
                    <div className="px-4 py-3 text-xs text-muted-foreground/60 text-center">
                      暂无{label}设定
                    </div>
                  ) : (
                    items.map(item => (
                      <div key={item.id} className="px-3 py-2.5 hover:bg-muted/30 transition-colors group">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0 space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium truncate">{item.name}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-sm font-medium shrink-0 ${IMPORTANCE_OPTIONS.find(o => o.value === item.importance)?.color}`}>
                                {IMPORTANCE_OPTIONS.find(o => o.value === item.importance)?.label}
                              </span>
                              {item.summary && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-sm font-medium shrink-0 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                                  已索引
                                </span>
                              )}
                            </div>
                            {item.category && (
                              <span className="text-[11px] text-muted-foreground/60">#{item.category}</span>
                            )}
                            {item.summary ? (
                              <p className="text-xs text-emerald-700/70 dark:text-emerald-400/70 line-clamp-2 leading-relaxed bg-emerald-50/50 dark:bg-emerald-950/30 rounded px-2 py-1">
                                {item.summary}
                              </p>
                            ) : (
                              <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                                {item.content?.slice(0, 100)}...
                              </p>
                            )}
                          </div>
                          
                          <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleEdit(item)}>
                              <Edit2 className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => handleDelete(item.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
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
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Globe className="h-10 w-10 mb-3 opacity-20" />
            <p className="text-sm">还没有小说设定</p>
            <p className="text-xs mt-1 opacity-60">添加世界观、境界体系等设定</p>
          </div>
        )}
      </div>
    </div>
  )
}
