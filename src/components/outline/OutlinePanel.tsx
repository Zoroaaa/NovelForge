/**
 * @file OutlinePanel.tsx
 * @description 总纲管理面板组件，提供总纲的创建、编辑、版本管理功能
 * @version 2.0.0 - 优化侧边栏显示，简化布局
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { MasterOutline } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Save, History, Plus, Eye, Edit2, Trash2, FileText, Clock, Hash, ChevronDown, ChevronRight, Wand2, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'

interface OutlinePanelProps {
  novelId: string
}

export function OutlinePanel({ novelId }: OutlinePanelProps) {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    summary: '',
  })

  const { data: currentOutlineData, isLoading: isLoadingCurrent } = useQuery({
    queryKey: ['master-outline', novelId],
    queryFn: () => api.masterOutline.get(novelId),
  })

  const { data: historyData } = useQuery({
    queryKey: ['master-outline-history', novelId],
    queryFn: () => api.masterOutline.history(novelId),
    enabled: historyOpen,
  })

  const currentOutline = currentOutlineData?.outline || null

  const createMutation = useMutation({
    mutationFn: (data: typeof formData) =>
      api.masterOutline.create({ ...data, novelId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-outline'] })
      queryClient.invalidateQueries({ queryKey: ['master-outline-history'] })
      toast.success('✅ 总纲 v' + (currentOutline?.version ? currentOutline.version + 1 : 1) + ' 已创建')
      resetForm()
      setDialogOpen(false)
    },
    onError: (err) => toast.error(`❌ 创建失败: ${(err as Error).message}`),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { title?: string; content?: string; summary?: string } }) =>
      api.masterOutline.update(id, data as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-outline'] })
      toast.success('✅ 总纲已更新')
      setEditDialogOpen(false)
    },
    onError: (err) => toast.error(`❌ 更新失败: ${(err as Error).message}`),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.masterOutline.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-outline'] })
      queryClient.invalidateQueries({ queryKey: ['master-outline-history'] })
      toast.success('✅与其他版本已删除')
    },
    onError: (err) => toast.error(`❌ 删除失败: ${(err as Error).message}`),
  })

  const generateSummaryMutation = useMutation({
    mutationFn: () => api.generate.masterOutlineSummary({ novelId }),
    onSuccess: (result) => {
      if (result.summary) {
        setFormData(prev => ({ ...prev, summary: result.summary || '' }))
        toast.success('✅ 摘要已生成')
      }
    },
    onError: (err) => toast.error(`❌ 生成摘要失败: ${(err as Error).message}`),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.title.trim() || !formData.content.trim()) {
      toast.warning('请填写标题和内容')
      return
    }
    createMutation.mutate(formData)
  }

  const handleEdit = () => {
    if (!currentOutline) return
    setFormData({
      title: currentOutline.title,
      content: currentOutline.content || '',
      summary: currentOutline.summary || '',
    })
    setEditDialogOpen(true)
  }

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentOutline?.id) return
    updateMutation.mutate({
      id: currentOutline.id,
      data: formData,
    })
  }

  const handleDelete = (id: string) => {
    if (confirm('确定要删除这个版本的总纲吗？')) {
      deleteMutation.mutate(id)
    }
  }

  const resetForm = () => {
    setFormData({ title: '', content: '', summary: '' })
  }

  const renderMarkdown = (text: string) => {
    if (!text) return null
    return text.split('\n').map((line, i) => {
      if (line.startsWith('# ')) return <h1 key={i} className="text-base font-bold mt-3 mb-1">{line.slice(2)}</h1>
      if (line.startsWith('## ')) return <h2 key={i} className="text-sm font-semibold mt-2 mb-1">{line.slice(3)}</h2>
      if (line.startsWith('### ')) return <h3 key={i} className="text-xs font-medium mt-1 mb-0.5">{line.slice(4)}</h3>
      if (line.startsWith('- ')) return <li key={i} className="ml-3 text-xs list-disc">• {line.slice(2)}</li>
      if (line.trim() === '') return null
      return <p key={i} className="text-xs">{line}</p>
    })
  }

  if (isLoadingCurrent) return <div className="p-4 text-center text-sm">加载中...</div>

  return (
    <div className="space-y-3">
      <div className="px-3 pt-3 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {currentOutline ? `v${currentOutline.version} · ${currentOutline.wordCount} 字` : '尚未创建'}
        </span>
        
        <div className="flex items-center gap-1">
          {currentOutline && (
            <>
              <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                    <History className="h-3.5 w-3.5" />
                  </Button>
                </DialogTrigger>
                
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>版本历史</DialogTitle>
                    <DialogDescription>查看和管理总纲的历史版本</DialogDescription>
                  </DialogHeader>
                  
                  <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                    {(historyData?.history || []).length === 0 ? (
                      <div className="text-center py-8 text-sm text-muted-foreground">
                        暂无历史版本
                      </div>
                    ) : (
                      (historyData?.history || []).map((version: MasterOutline) => (
                        <div key={version.id} className={`p-3 border rounded-lg ${version.id === currentOutline?.id ? 'bg-primary/5 border-primary' : ''}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge variant="outline" className="text-[10px]">v{version.version}</Badge>
                                <span className="text-sm font-medium truncate">{version.title}</span>
                              </div>
                              <p className="text-xs text-muted-foreground line-clamp-2">
                                {version.summary || version.content?.slice(0, 80)}
                              </p>
                              <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                                <Clock className="h-3 w-3" />
                                {new Date(version.createdAt * 1000).toLocaleDateString()}
                                <span>{version.wordCount} 字</span>
                              </div>
                            </div>

                            {version.id !== currentOutline?.id && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-destructive"
                                onClick={() => handleDelete(version.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </DialogContent>
              </Dialog>

              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={handleEdit}>
                <Edit2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}

          <Dialog open={dialogOpen} onOpenChange={(open) => {
            setDialogOpen(open)
            if (!open) resetForm()
          }}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-7 gap-1 text-xs">
                <Plus className="h-3.5 w-3.5" />
                {currentOutline ? '新版本' : '创建'}
              </Button>
            </DialogTrigger>
            
            <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{currentOutline ? `新建总纲 v${currentOutline.version + 1}` : '创建总纲'}</DialogTitle>
                <DialogDescription>填写总纲标题和内容，创建新的版本</DialogDescription>
              </DialogHeader>
              
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label>总纲标题 *</Label>
                  <Input
                    placeholder="如：修仙世界总纲 - 从凡人到仙帝的逆袭之路"
                    value={formData.title}
                    onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label>摘要（可选，200字以内）</Label>
                  <Input
                    placeholder="简要描述这个版本的总纲要点..."
                    maxLength={200}
                    value={formData.summary}
                    onChange={(e) => setFormData(prev => ({ ...prev, summary: e.target.value }))}
                  />
                </div>

                <div className="space-y-2">
                  <Label>总纲内容 *（支持 Markdown）</Label>
                  <Textarea
                    placeholder={`# 小说总纲\n\n## 一、核心设定\n\n### 世界观概述\n...\n\n## 二、主线剧情\n...`}
                    rows={15}
                    value={formData.content}
                    onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
                    required
                  />
                  <div className="text-right text-xs text-muted-foreground">
                    {formData.content.length} 字
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                    取消
                  </Button>
                  <Button type="submit" disabled={createMutation.isPending}>
                    {createMutation.isPending ? '保存中...' : '创建新版本'}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="px-3 pb-3">
        {currentOutline ? (
          <div className="border rounded-lg overflow-hidden">
            <div
              className="flex items-center gap-2 p-3 hover:bg-muted/50 cursor-pointer transition-colors"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              <FileText className="h-4 w-4 text-primary shrink-0" />
              <span className="text-sm font-medium truncate flex-1">{currentOutline.title}</span>
              <Badge variant="secondary" className="text-[10px]">
                <Hash className="h-3 w-3 mr-0.5" />
                v{currentOutline.version}
              </Badge>
            </div>

            {isExpanded && (
              <div className="border-t px-3 py-2 bg-muted/10">
                {currentOutline.summary && (
                  <p className="text-xs text-muted-foreground mb-2">
                    {currentOutline.summary}
                  </p>
                )}
                <div className="prose prose-sm dark:prose-invert max-w-none max-h-[40vh] overflow-y-auto">
                  {renderMarkdown(currentOutline.content || '')}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="border rounded-lg p-4 text-center bg-muted/10">
            <FileText className="h-6 w-6 mx-auto text-muted-foreground opacity-50 mb-2" />
            <p className="text-xs text-muted-foreground">
              总纲是小说的核心框架，AI 生成章节时会参考总纲保持剧情一致性
            </p>
          </div>
        )}
      </div>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>编辑总纲 v{currentOutline?.version}</DialogTitle>
          </DialogHeader>
          
          <form onSubmit={handleEditSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>总纲标题</Label>
              <Input
                value={formData.title}
                onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label>摘要</Label>
              <div className="flex gap-2">
                <Input
                  maxLength={200}
                  value={formData.summary}
                  onChange={(e) => setFormData(prev => ({ ...prev, summary: e.target.value }))}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => generateSummaryMutation.mutate()}
                  disabled={generateSummaryMutation.isPending}
                >
                  {generateSummaryMutation.isPending ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      生成中
                    </>
                  ) : (
                    <>
                      <Wand2 className="h-3.5 w-3.5" />
                      AI生成
                    </>
                  )}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>总纲内容</Label>
              <Textarea
                rows={15}
                value={formData.content}
                onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
                className="font-mono text-sm"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditDialogOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? '保存中...' : '保存'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
