/**
 * @file WorkspacePage.tsx
 * @description 工作台页面组件，提供章节编辑、AI生成、导出等核心功能
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { AppLayout } from '@/components/layout/AppLayout'
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader'
import { Sidebar } from '@/components/layout/Sidebar'
import { ChapterEditor } from '@/components/chapter/ChapterEditor'
import { GeneratePanel } from '@/components/generate/GeneratePanel'
import { ExportDialog } from '@/components/export/ExportDialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PenLine, Sparkles, FileDown, AlertTriangle, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * 工作台页面组件
 * @description 提供章节编辑、AI内容生成、小说导出等核心功能的工作界面
 * @returns {JSX.Element} 工作台页面
 */
export default function WorkspacePage() {
  const { id } = useParams<{ id: string }>()
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null)
  const [injectedContent, setInjectedContent] = useState<string | null>(null)
  const [editorContent, setEditorContent] = useState('')

  const { data: novel, isLoading: novelLoading } = useQuery({
    queryKey: ['novel', id],
    queryFn: () => api.novels.get(id!),
    enabled: !!id,
  })

  const { data: chapters, isLoading: chaptersLoading } = useQuery({
    queryKey: ['chapters', id],
    queryFn: () => api.chapters.list(id!),
    enabled: !!id,
  })

  const { data: modelConfigs } = useQuery({
    queryKey: ['model-configs', id],
    queryFn: () => id ? api.modelConfigs.list({ novelId: id }) : Promise.resolve([]),
    enabled: !!id,
  })

  const showModelWarning = modelConfigs && Array.isArray(modelConfigs) && modelConfigs.length === 0

  const activeChapter = chapters?.find(c => c.id === activeChapterId)

  useEffect(() => {
    if (activeChapter?.content) {
      setEditorContent(activeChapter.content)
    } else {
      setEditorContent('')
    }
  }, [activeChapter?.id, activeChapter?.content])

  if (novelLoading || chaptersLoading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">加载中...</div>
      </div>
    )
  }

  if (!novel) {
    return (
      <div className="h-screen flex items-center justify-center">
        <p className="text-destructive">小说不存在</p>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      <WorkspaceHeader novel={novel} />

      {showModelWarning && (
        <div className="flex items-center gap-3 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="text-sm flex-1">尚未配置 AI 模型，章节和大纲的 AI 生成功能无法使用。</span>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 h-7 text-xs bg-transparent"
            onClick={() => {
              const settingsBtn = document.querySelector('[data-settings-trigger]') as HTMLElement
              settingsBtn?.click()
            }}
          >
            <Settings2 className="h-3.5 w-3.5" />
            前往配置
          </Button>
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        <AppLayout
          left={<Sidebar novelId={id!} onChapterSelect={setActiveChapterId} />}
          center={
            activeChapter ? (
              <ChapterEditor
                chapter={activeChapter}
                injectedContent={injectedContent ?? undefined}
                onContentInserted={() => setInjectedContent(null)}
                onContentChange={setEditorContent}
              />
            ) : (
              <div className="h-full flex items-center justify-center">
                <div className="text-center text-muted-foreground space-y-4">
                  <div className="w-20 h-20 mx-auto rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                    <Sparkles className="h-10 w-10 text-primary/60" />
                  </div>
                  <div>
                    <p className="text-lg font-medium">选择一个章节开始编辑</p>
                    <p className="text-sm mt-1">或从左侧面板创建新章节</p>
                  </div>
                </div>
              </div>
            )
          }
          right={
            activeChapter ? (
              <div className="h-full flex flex-col bg-muted/30">
                <div className="px-4 py-3 border-b bg-background">
                  <h3 className="font-medium text-sm truncate">{activeChapter.title}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {activeChapter.wordCount > 0 ? `${activeChapter.wordCount} 字` : '未开始'}
                  </p>
                </div>

                <Tabs defaultValue="generate" className="flex-1 flex flex-col">
                  <TabsList className="grid w-full grid-cols-2 rounded-none border-b bg-transparent h-10">
                    <TabsTrigger value="generate" className="gap-1.5 text-xs rounded-none data-[state=active]:bg-background">
                      <PenLine className="h-3.5 w-3.5" />
                      AI 生成
                    </TabsTrigger>
                    <TabsTrigger value="export" className="gap-1.5 text-xs rounded-none data-[state=active]:bg-background">
                      <FileDown className="h-3.5 w-3.5" />
                      导出
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="generate" className="flex-1 overflow-y-auto mt-0 p-3">
                    <GeneratePanel
                      novelId={id!}
                      chapterId={activeChapter.id}
                      chapterTitle={activeChapter.title}
                      existingContent={editorContent}
                      onInsertContent={(content) => {
                        setInjectedContent(content)
                      }}
                    />
                  </TabsContent>

                  <TabsContent value="export" className="flex-1 overflow-y-auto mt-0 p-3">
                    <div className="space-y-4">
                      <p className="text-sm text-muted-foreground">
                        导出当前小说为各种格式
                      </p>
                      <ExportDialog novelId={id!} novelTitle={novel.title} />
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center p-4 text-center text-muted-foreground">
                <FileDown className="h-12 w-12 mb-3 opacity-20" />
                <p className="text-sm">选择章节后<br />可导出小说</p>
              </div>
            )
          }
        />
      </div>
    </div>
  )
}
