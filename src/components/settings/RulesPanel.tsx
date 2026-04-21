import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { WritingRule } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Plus, Trash2, Edit2, Save, X, Power, PowerOff, Palette, Clock, Users, BookOpen, Globe, Ban, Lightbulb } from 'lucide-react'
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

interface RulesPanelProps {
  novelId: string
}

const RULE_CATEGORIES = [
  { value: 'style', label: '文风', icon: Palette, color: 'bg-pink-500' },
  { value: 'pacing', label: '节奏', icon: Clock, color: 'bg-blue-500' },
  { value: 'character', label: '角色一致性', icon: Users, color: 'bg-green-500' },
  { value: 'plot', label: '情节', icon: BookOpen, color: 'bg-purple-500' },
  { value: 'world', label: '世界观', icon: Globe, color: 'bg-orange-500' },
  { value: 'taboo', label: '禁忌事项', icon: Ban, color: 'bg-red-500' },
  { value: 'custom', label: '自定义', icon: Lightbulb, color: 'bg-gray-500' },
]

const PRIORITY_OPTIONS = [
  { value: 1, label: '最高', color: 'text-red-600 font-bold' },
  { value: 2, label: '高', color: 'text-orange-600' },
  { value: 3, label: '中', color: 'text-yellow-600' },
  { value: 4, label: '低', color: 'text-blue-600' },
  { value: 5, label: '最低', color: 'text-gray-600' },
]

export function RulesPanel({ novelId }: RulesPanelProps) {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  
  // 表单状态
  const [formData, setFormData] = useState<{
    category: 'style' | 'pacing' | 'character' | 'plot' | 'world' | 'taboo' | 'custom'
    title: string
    content: string
    priority: number
  }>({
    category: 'style',
    title: '',
    content: '',
    priority: 3,
  })

  // 查询所有规则
  const { data: rulesData, isLoading } = useQuery({
    queryKey: ['rules', novelId],
    queryFn: () => api.rules.list(novelId),
  })

  const rules = rulesData?.rules || []

  // 创建 mutation
  const createMutation = useMutation({
    mutationFn: (data: typeof formData) => 
      api.rules.create({ ...data, novelId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rules'] })
      toast.success('✅ 规则创建成功')
      resetForm()
      setDialogOpen(false)
    },
    onError: (err) => toast.error(`❌ 创建失败: ${(err as Error).message}`),
  })

  // 更新 mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<WritingRule> }) =>
      api.rules.update(id, data as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rules'] })
      toast.success('✅ 规则更新成功')
      setEditingId(null)
      resetForm()
    },
    onError: (err) => toast.error(`❌ 更新失败: ${(err as Error).message}`),
  })

  // 删除 mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.rules.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rules'] })
      toast.success('✅ 规则已删除')
    },
    onError: (err) => toast.error(`❌ 删除失败: ${(err as Error).message}`),
  })

  // 启用/禁用切换
  const toggleMutation = useMutation({
    mutationFn: (id: string) => api.rules.toggle(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rules'] })
      toast.success('✅ 规则状态已切换')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.title.trim() || !formData.content.trim()) {
      toast.warning('请填写标题和内容')
      return
    }
    
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: formData })
    } else {
      createMutation.mutate(formData)
    }
  }

  const handleEdit = (rule: WritingRule) => {
    setEditingId(rule.id)
    setFormData({
      category: rule.category as 'style' | 'pacing' | 'character' | 'plot' | 'world' | 'taboo' | 'custom',
      title: rule.title,
      content: rule.content || '',
      priority: rule.priority,
    })
    setDialogOpen(true)
  }

  const handleDelete = (id: string) => {
    if (confirm('确定要删除这条规则吗？')) {
      deleteMutation.mutate(id)
    }
  }

  const resetForm = () => {
    setFormData({ category: 'style', title: '', content: '', priority: 3 })
    setEditingId(null)
  }

  // 按类别分组
  const groupedRules = rules.reduce((acc, r) => {
    if (!acc[r.category]) acc[r.category] = []
    acc[r.category].push(r)
    return acc
  }, {} as Record<string, WritingRule[]>)

  if (isLoading) return <div className="p-4 text-center">加载中...</div>

  return (
    <div className="space-y-4">
      {/* 头部操作栏 */}
      <div className="px-3 pt-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            活跃 {rules.filter(r => r.isActive === 1).length} / 共 {rules.length} 条
          </span>
          
          <Dialog open={dialogOpen} onOpenChange={(open) => {
            setDialogOpen(open)
            if (!open) resetForm()
          }}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-7 gap-1.5 text-xs">
                <Plus className="h-3.5 w-3.5" />
                新增规则
              </Button>
            </DialogTrigger>
          
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingId ? '编辑规则' : '新增规则'}</DialogTitle>
            </DialogHeader>
            
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>类别</Label>
                  <Select 
                    value={formData.category} 
                    onValueChange={(v) => setFormData(prev => ({ ...prev, category: v as 'style' | 'pacing' | 'character' | 'plot' | 'world' | 'taboo' | 'custom' }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {RULE_CATEGORIES.map(c => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>优先级</Label>
                  <Select 
                    value={String(formData.priority)} 
                    onValueChange={(v) => setFormData(prev => ({ ...prev, priority: Number(v) }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PRIORITY_OPTIONS.map(p => (
                        <SelectItem key={p.value} value={String(p.value)}>{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>规则标题 *</Label>
                <Input
                  placeholder="如：禁止使用现代网络用语"
                  value={formData.title}
                  onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label>详细说明 *（支持 Markdown）</Label>
                <Textarea
                  placeholder="详细描述这条规则的执行标准..."
                  rows={6}
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

      {/* 规则列表（按类别分组展示） */}
      <div className="px-3 pb-3 space-y-1.5">
        {RULE_CATEGORIES.map(({ value, label, icon: Icon, color }) => {
          const items = groupedRules[value] || []
          const activeCount = items.filter(r => r.isActive === 1).length
          
          return (
            <div key={value} className="border rounded-lg overflow-hidden">
              <div className="flex items-center gap-3 p-3 bg-muted/30">
                <div className={`w-3 h-3 rounded-full ${color}`} />
                <Icon className="h-4 w-4" />
                <span className="font-medium flex-1">{label}</span>
                <Badge variant="secondary">{activeCount}/{items.length}</Badge>
              </div>

              {items.length > 0 && (
                <div className="divide-y">
                  {items.map(item => (
                    <div key={item.id} className={`p-3 group hover:bg-muted/20 transition-colors ${item.isActive !== 1 ? 'opacity-50' : ''}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-sm">{item.title}</span>
                            <Badge 
                              variant="outline" 
                              className={`text-xs ${PRIORITY_OPTIONS.find(p => p.value === item.priority)?.color}`}
                            >
                              P{item.priority}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {item.content?.slice(0, 120)}...
                          </p>
                        </div>
                        
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {/* 启用/禁用按钮 */}
                          <Button
                            size="icon"
                            variant="ghost"
                            className={`h-8 w-8 ${item.isActive === 1 ? 'text-green-600 hover:text-green-700' : 'text-gray-400 hover:text-gray-600'}`}
                            onClick={() => toggleMutation.mutate(item.id)}
                            disabled={toggleMutation.isPending}
                          >
                            {item.isActive === 1 ? <Power className="h-4 w-4" /> : <PowerOff className="h-4 w-4" />}
                          </Button>
                          
                          {/* 编辑按钮 */}
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() => handleEdit(item)}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          
                          {/* 删除按钮 */}
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
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {rules.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <p className="mb-2">📋 还没有创作规则</p>
            <p className="text-sm">添加规则来规范 AI 的写作风格、节奏和禁忌事项</p>
          </div>
        )}
      </div>
    </div>
  )
}
