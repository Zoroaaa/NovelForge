/**
 * @file WorkspaceHeader.tsx
 * @description 工作台顶部导航栏组件，提供返回、标题显示、阅读器入口和模型配置功能
 * @version 1.1.0
 * @modified 2026-04-26 - 增加小说设置Tab（System Prompt）
 */
import { Link } from 'react-router-dom'
import { ArrowLeft, BookOpen, Settings2, Home, Save, Network, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog'
import { ModelConfig } from '@/components/model/ModelConfig'
import { GenerationLogs } from '@/components/generation/GenerationLogs'
import { WritingStats } from '@/components/stats/WritingStats'
import { SearchBar } from '@/components/search/SearchBar'
import type { Novel } from '@/lib/types'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'

interface WorkspaceHeaderProps {
  novel: Novel
}

export function WorkspaceHeader({ novel }: WorkspaceHeaderProps) {
  const queryClient = useQueryClient()
  const [systemPrompt, setSystemPrompt] = useState(novel.systemPrompt || '')

  const updateNovelMutation = useMutation({
    mutationFn: (data: Partial<Novel>) => api.novels.update(novel.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['novel', novel.id] })
      toast.success('小说设置已保存')
    },
    onError: (error) => toast.error(`保存失败: ${error.message}`),
  })

  const generatePromptMutation = useMutation({
    mutationFn: () => api.novels.generateSystemPrompt(novel.id),
    onSuccess: (data) => {
      setSystemPrompt(data.systemPrompt)
      queryClient.invalidateQueries({ queryKey: ['novel', novel.id] })
      toast.success('AI 已生成专属 System Prompt')
    },
    onError: (error) => toast.error(`生成失败: ${error.message}`),
  })

  const handleSaveSystemPrompt = () => {
    updateNovelMutation.mutate({ systemPrompt })
  }

  const handleGenerateSystemPrompt = () => {
    generatePromptMutation.mutate()
  }

  return (
    <header className="h-14 border-b bg-card/50 backdrop-blur-sm flex items-center px-4 shrink-0">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <Button variant="ghost" size="icon" asChild className="shrink-0">
          <Link to="/novels" title="返回小说列表">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>

        <div className="flex items-center gap-2 min-w-0">
          <Home className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground">/</span>
          <h1 className="font-medium truncate">{novel.title}</h1>
          {novel.genre && (
            <span className="text-xs text-muted-foreground hidden sm:inline">
              · {novel.genre}
            </span>
          )}
        </div>

        {/* 全文搜索框 */}
        <div className="hidden md:block w-64 ml-4">
          <SearchBar novelId={novel.id} />
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2 hidden sm:flex" data-settings-trigger>
              <Settings2 className="h-4 w-4" />
              模型配置
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Settings2 className="h-5 w-5" />
                模型配置与小说设置
              </DialogTitle>
              <DialogDescription>
                配置AI模型参数、生成设置和小说专属约束
              </DialogDescription>
            </DialogHeader>
            <Tabs defaultValue="models" className="mt-4">
              <TabsList className="grid w-full grid-cols-4 h-8">
                <TabsTrigger value="models" className="text-xs">模型配置</TabsTrigger>
                <TabsTrigger value="logs" className="text-xs">生成日志</TabsTrigger>
                <TabsTrigger value="stats" className="text-xs">写作统计</TabsTrigger>
                <TabsTrigger value="novel-settings" className="text-xs">小说设置</TabsTrigger>
              </TabsList>
              <TabsContent value="models" className="mt-3">
                <ModelConfig novelId={novel.id} />
              </TabsContent>
              <TabsContent value="logs" className="mt-3">
                <GenerationLogs novelId={novel.id} />
              </TabsContent>
              <TabsContent value="stats" className="mt-3">
                <WritingStats novelId={novel.id} />
              </TabsContent>
              <TabsContent value="novel-settings" className="mt-3 space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="system-prompt" className="text-sm font-medium">
                      小说专属 System Prompt
                    </Label>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleGenerateSystemPrompt}
                      disabled={generatePromptMutation.isPending}
                      className="gap-1.5 h-7 text-xs"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      {generatePromptMutation.isPending ? '生成中...' : 'AI 生成'}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    填写后将作为 System Message 注入每次生成，优先级高于通用提示词。
                    点击「AI 生成」可基于小说题材和设定自动生成专属提示词。
                  </p>
                  <Textarea
                    id="system-prompt"
                    placeholder={`示例：\n本小说世界名：天玄大陆\n主角：林岩\n境界体系：炼气→筑基→金丹→元婴→化神\n任何设定词必须与角色卡和世界设定一字不差`}
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    className="min-h-[120px]"
                  />
                  <div className="flex justify-end pt-2">
                    <Button
                      size="sm"
                      onClick={handleSaveSystemPrompt}
                      disabled={updateNovelMutation.isPending}
                      className="gap-2"
                    >
                      <Save className="h-4 w-4" />
                      {updateNovelMutation.isPending ? '保存中...' : '保存设置'}
                    </Button>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>

        <Button variant="outline" size="sm" className="gap-2" asChild>
          <Link to={`/novels/${novel.id}/graph`}>
            <Network className="h-4 w-4" />
            <span className="hidden sm:inline">图谱</span>
          </Link>
        </Button>

        <Button variant="outline" size="sm" className="gap-2" asChild>
          <Link to={`/novels/${novel.id}/read`}>
            <BookOpen className="h-4 w-4" />
            <span className="hidden sm:inline">阅读</span>
          </Link>
        </Button>
      </div>
    </header>
  )
}
