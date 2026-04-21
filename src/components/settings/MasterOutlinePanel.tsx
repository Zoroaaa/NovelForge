/**
 * @file MasterOutlinePanel.tsx
 * @description 总纲管理面板组件，提供总纲的创建、编辑、版本管理功能
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { MasterOutline } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Save, History, Plus, Eye, Edit2, Trash2, FileText, Clock, Hash } from 'lucide-react'
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

interface MasterOutlinePanelProps {
  novelId: string
}

export function MasterOutlinePanel({ novelId }: MasterOutlinePanelProps) {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [viewMode, setViewMode] = useState<'edit' | 'preview'>('preview')
  
  // 表单状态
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    summary: '',
  })

  // 查询当前总纲
  const { data: currentOutlineData, isLoading: isLoadingCurrent } = useQuery({
    queryKey: ['master-outline', novelId],
    queryFn: () => api.masterOutline.get(novelId),
  })

  // 查询历史版本
  const { data: historyData } = useQuery({
    queryKey: ['master-outline-history', novelId],
    queryFn: () => api.masterOutline.history(novelId),
    enabled: historyOpen,
  })

  const currentOutline = currentOutlineData?.outline || null

  // 创建新版本 mutation
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

  // 更新当前版本 mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { title?: string; content?: string; summary?: string } }) =>
      api.masterOutline.update(id, data as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-outline'] })
      toast.success('✅ 总纲已更新')
    },
    onError: (err) => toast.error(`❌ 更新失败: ${(err as Error).message}`),
  })

  // 删除版本 mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.masterOutline.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-outline'] })
      queryClient.invalidateQueries({ queryKey: ['master-outline-history'] })
      toast.success('✅ 版本已删除')
    },
    onError: (err) => toast.error(`❌ 删除失败: ${(err as Error).message}`),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.title.trim() || !formData.content.trim()) {
      toast.warning('请填写标题和内容')
      return
    }
    
    if (currentOutline) {
      // 如果已有总纲，创建新版本（保留旧版）
      createMutation.mutate(formData)
    } else {
      // 首次创建
      createMutation.mutate(formData)
    }
  }

  const handleQuickUpdate = () => {
    if (!currentOutline?.id) return
    
    if (!formData.content.trim() && !formData.summary.trim()) {
      toast.warning('请填写要更新的内容')
      return
    }

    updateMutation.mutate({
      id: currentOutline.id,
      data: formData,
    })
    
    resetForm()
  }

  const handleDelete = (id: string) => {
    if (confirm('确定要删除这个版本的总纲吗？')) {
      deleteMutation.mutate(id)
    }
  }

  const resetForm = () => {
    setFormData({ title: '', content: '', summary: '' })
  }

  // 简单的 Markdown 预览（实际项目应使用 react-markdown）
  const renderMarkdown = (text: string) => {
    if (!text) return null
    return text.split('\n').map((line, i) => {
      if (line.startsWith('# ')) return <h1 key={i} className="text-xl font-bold mt-4 mb-2">{line.slice(2)}</h1>
      if (line.startsWith('## ')) return <h2 key={i} className="text-lg font-semibold mt-3 mb-2">{line.slice(3)}</h2>
      if (line.startsWith('### ')) return <h3 key={i} className="text-base font-medium mt-2 mb-1">{line.slice(4)}</h3>
      if (line.startsWith('- ')) return <li key={i} className="ml-4 list-disc">• {line.slice(2)}</li>
      if (line.trim() === '') return <br key={i} />
      return <p key={i}>{line}</p>
    })
  }

  if (isLoadingCurrent) return <div className="p-4 text-center">加载中...</div>

  return (
    <div className="space-y-4">
      {/* 头部操作栏 */}
      <div className="flex items-center justify-between px-4 pt-4">
        <div className="flex items-center gap-3">
          {currentOutline && (
            <>
              <Badge variant="secondary" className="gap-1">
                <Hash className="h-3 w-3" />
                v{currentOutline.version}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {currentOutline.wordCount} 字 · {new Date(currentOutline.updatedAt * 1000).toLocaleDateString()}
              </span>
            </>
          )}
          {!currentOutline && (
            <span className="text-sm text-muted-foreground">尚未创建总纲</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* 历史版本按钮 */}
          <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="gap-2">
                <History className="h-4 w-4" />
                历史
              </Button>
            </DialogTrigger>
            
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>📜 版本历史</DialogTitle>
                <DialogDescription>查看和管理总纲的历史版本</DialogDescription>
              </DialogHeader>
              
              <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                {(historyData?.history || []).length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    暂无历史版本
                  </div>
                ) : (
                  (historyData?.history || []).map((version: MasterOutline) => (
                    <div key={version.id} className={`p-3 border rounded-lg ${version.id === currentOutline?.id ? 'bg-primary/5 border-primary' : ''}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="outline">v{version.version}</Badge>
                            <span className="font-medium truncate">{version.title}</span>
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {version.summary || version.content?.slice(0, 80)}
                          </p>
                          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {new Date(version.createdAt * 1000).toLocaleString()}
                            <FileText className="h-3 w-3 ml-1" />
                            {version.wordCount} 字
                          </div>
                        </div>

                        {version.id !== currentOutline?.id && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-destructive"
                            onClick={() => handleDelete(version.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </DialogContent>
          </Dialog>

          {/* 新建/编辑按钮 */}
          <Dialog open={dialogOpen} onOpenChange={(open) => {
            setDialogOpen(open)
            if (!open) resetForm()
          }}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2">
                <Plus className="h-4 w-4" />
                {currentOutline ? '新建版本' : '创建总纲'}
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
                  <Label>总纲内容 *（支持 Markdown，建议 2000 字以上）</Label>
                  <Textarea
                    placeholder={`# 小说总纲\n\n## 一、核心设定\n\n### 世界观概述\n...\n\n### 主角定位\n...\n\n## 二、主线剧情\n...`}
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
                  <Button 
                    type="submit" 
                    disabled={createMutation.isPending}
                  >
                    {createMutation.isPending ? '保存中...' : '创建新版本'}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* 当前总纲内容展示 */}
      <div className="px-4 pb-4">
        {currentOutline ? (
          <div className="border rounded-lg overflow-hidden">
            {/* 视图切换 */}
            <div className="flex items-center justify-between p-3 bg-muted/30 border-b">
              <div className="font-medium flex items-center gap-2">
                <FileText className="h-4 w-4" />
                当前版本：v{currentOutline.version}
              </div>
              
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={viewMode === 'edit' ? 'default' : 'ghost'}
                  onClick={() => setViewMode('edit')}
                  className="gap-1"
                >
                  <Edit2 className="h-3 w-3" />
                  编辑
                </Button>
                <Button
                  size="sm"
                  variant={viewMode === 'preview' ? 'default' : 'ghost'}
                  onClick={() => setViewMode('preview')}
                  className="gap-1"
                >
                  <Eye className="h-3 w-3" />
                  预览
                </Button>
              </div>
            </div>

            {/* 内容区域 */}
            <div className="p-4 max-h-[60vh] overflow-y-auto">
              {viewMode === 'preview' ? (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  {renderMarkdown(currentOutline.content || '')}
                </div>
              ) : (
                <div className="space-y-3">
                  <Textarea
                    defaultValue={currentOutline.content || ''}
                    rows={20}
                    onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
                    className="font-mono text-sm"
                  />
                  
                  <div className="flex justify-end gap-2">
                    <Button 
                      size="sm" 
                      onClick={handleQuickUpdate}
                      disabled={updateMutation.isPending || !formData.content.trim()}
                    >
                      <Save className="h-4 w-4 mr-1" />
                      {updateMutation.isPending ? '保存中...' : '快速更新'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* 无总纲时的空状态 */
          <div className="border rounded-lg p-6 text-center bg-muted/10">
            <div className="mb-3">
              <FileText className="h-8 w-8 mx-auto text-muted-foreground opacity-50" />
            </div>
            <h3 className="font-medium mb-1 text-sm">还没有创建总纲</h3>
            <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
              总纲是小说的核心框架，包含世界观、主线剧情、角色发展轨迹等关键信息。AI 在生成章节时会参考总纲来保持剧情一致性。
            </p>
            
            <Button onClick={() => setDialogOpen(true)} className="gap-2" size="sm">
              <Plus className="h-4 w-4" />
              创建第一个总纲
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
