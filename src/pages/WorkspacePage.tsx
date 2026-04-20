import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { useState } from 'react'
import { api } from '@/lib/api'
import { AppLayout } from '@/components/layout/AppLayout'
import { Sidebar } from '@/components/layout/Sidebar'
import { ChapterEditor } from '@/components/chapter/ChapterEditor'
import { GeneratePanel } from '@/components/generate/GeneratePanel'
import { ModelConfig } from '@/components/settings/ModelConfig'
import { ExportDialog } from '@/components/export/ExportDialog'
import type { Chapter, Novel } from '@/lib/types'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Settings2, PenLine, BookOpen } from 'lucide-react'

export default function WorkspacePage() {
  const { id } = useParams<{ id: string }>()
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null)
  const [rightTab, setRightTab] = useState<'generate' | 'settings'>('generate')
  const [injectedContent, setInjectedContent] = useState<string | null>(null)

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

  const activeChapter = chapters?.find(c => c.id === activeChapterId)

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
    <AppLayout
      left={<Sidebar novelId={id!} onChapterSelect={setActiveChapterId} />}
      center={
        activeChapter ? (
          <ChapterEditor
            chapter={activeChapter}
            injectedContent={injectedContent ?? undefined}
            onContentInserted={() => setInjectedContent(null)}
          />
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center text-muted-foreground space-y-4">
              <BookOpen className="h-16 w-16 mx-auto opacity-20" />
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
          <div className="h-full flex flex-col">
            {/* 导出按钮 */}
            <div className="flex items-center justify-between px-3 py-2 border-b">
              <ExportDialog novelId={id!} novelTitle={novel.title} />
            </div>

            <Tabs value={rightTab} onValueChange={(v) => setRightTab(v as any)} className="flex-1 flex flex-col">
              <TabsList className="grid w-full grid-cols-2 m-2">
                <TabsTrigger value="generate" className="gap-1 text-xs">
                  <PenLine className="h-3 w-3" />
                  AI 生成
                </TabsTrigger>
                <TabsTrigger value="settings" className="gap-1 text-xs">
                  <Settings2 className="h-3 w-3" />
                  模型配置
                </TabsTrigger>
              </TabsList>

              <TabsContent value="generate" className="flex-1 overflow-y-auto mt-0 px-2">
                <GeneratePanel
                  novelId={id!}
                  chapterId={activeChapter.id}
                  chapterTitle={activeChapter.title}
                  onInsertContent={(content) => {
                    setInjectedContent(content)
                    setRightTab('generate')
                  }}
                />
              </TabsContent>

              <TabsContent value="settings" className="flex-1 overflow-y-auto mt-0 px-2">
                <ModelConfig novelId={id!} />
              </TabsContent>
            </Tabs>
          </div>
        ) : undefined
      }
    />
  )
}
