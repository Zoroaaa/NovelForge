import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import type { Chapter } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Plus, FileText, BookOpen } from 'lucide-react'

interface ChapterListProps {
  novelId: string
}

export function ChapterList({ novelId }: ChapterListProps) {
  const navigate = useNavigate()

  const { data: chapters, isLoading } = useQuery({
    queryKey: ['chapters', novelId],
    queryFn: () => api.chapters.list(novelId),
  })

  if (isLoading) {
    return <div className="animate-pulse space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-10 bg-muted rounded" />)}</div>
  }

  return (
    <div className="space-y-2">
      <Button variant="outline" size="sm" className="w-full gap-2" onClick={() => {}}>
        <Plus className="h-4 w-4" />
        添加章节
      </Button>

      <div className="mt-4 space-y-1">
        {chapters && chapters.length > 0 ? (
          chapters.map((chapter) => (
            <div
              key={chapter.id}
              className="flex items-center gap-2 py-2 px-3 hover:bg-muted rounded cursor-pointer group"
              onClick={() => navigate(`/novels/${novelId}`, { state: { chapterId: chapter.id } })}
            >
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="flex-1 text-sm truncate">{chapter.title}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 opacity-0 group-hover:opacity-100 shrink-0"
                onClick={(e) => {
                  e.stopPropagation()
                  navigate(`/novels/${novelId}/read/${chapter.id}`)
                }}
              >
                <BookOpen className="h-3 w-3" />
              </Button>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">暂无章节</p>
        )}
      </div>
    </div>
  )
}
