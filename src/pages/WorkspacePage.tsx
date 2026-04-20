import { useQuery } from '@tanstack/react-query'
import { useParams, useLocation } from 'react-router-dom'
import { useState } from 'react'
import { api } from '@/lib/api'
import { AppLayout } from '@/components/layout/AppLayout'
import { Sidebar } from '@/components/layout/Sidebar'
import { ChapterEditor } from '@/components/chapter/ChapterEditor'
import { GeneratePanel } from '@/components/generate/GeneratePanel'
import type { Chapter, Novel } from '@/lib/types'

export default function WorkspacePage() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const initialChapterId = (location.state as any)?.chapterId

  const [activeChapterId, setActiveChapterId] = useState<string | null>(initialChapterId || null)

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
      left={<Sidebar novelId={id!} />}
      center={
        activeChapter ? (
          <ChapterEditor chapter={activeChapter} />
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center text-muted-foreground space-y-2">
              <p className="text-lg">选择一个章节开始编辑</p>
              <p className="text-sm">或从左侧面板创建新章节</p>
            </div>
          </div>
        )
      }
      right={
        activeChapter ? (
          <GeneratePanel
            novelId={id!}
            chapterId={activeChapter.id}
            chapterTitle={activeChapter.title}
            onInsertContent={(content) => {
              console.log('Insert content:', content)
            }}
          />
        ) : undefined
      }
    />
  )
}
