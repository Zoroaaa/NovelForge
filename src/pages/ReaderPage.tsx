/**
 * @file ReaderPage.tsx
 * @description 阅读器页面组件，提供小说章节的阅读功能，支持主题、字号、字体设置
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { useQuery } from '@tanstack/react-query'
import { useParams, useNavigate, Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '@/lib/api'
import { useReaderStore } from '@/store/readerStore'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ArrowLeft, ChevronLeft, ChevronRight, Settings2 } from 'lucide-react'
import { useState } from 'react'

/**
 * 阅读器页面组件
 * @description 提供小说章节的阅读功能，支持主题切换、字号调整、字体选择等个性化设置
 * @returns {JSX.Element} 阅读器页面
 */
export default function ReaderPage() {
  const { id, chapterId } = useParams<{ id: string; chapterId?: string }>()
  const navigate = useNavigate()
  const [showSettings, setShowSettings] = useState(false)

  const { fontSize, theme, fontFamily, lineHeight, setFontSize, setTheme, setFontFamily } = useReaderStore()

  const { data: novel } = useQuery({
    queryKey: ['novel', id],
    queryFn: () => api.novels.get(id!),
    enabled: !!id,
  })

  const { data: chapters } = useQuery({
    queryKey: ['chapters', id],
    queryFn: () => api.chapters.list(id!),
    enabled: !!id,
  })

  const { data: chapter } = useQuery({
    queryKey: ['chapter', chapterId],
    queryFn: () => chapterId ? api.chapters.get(chapterId) : Promise.resolve(null),
    enabled: !!chapterId,
  })

  const currentIndex = chapterId && chapters ? chapters.findIndex(c => c.id === chapterId) : -1
  const isValidIndex = currentIndex >= 0 && currentIndex < (chapters?.length ?? 0)

  const prevChapter = isValidIndex && currentIndex > 0 ? chapters![currentIndex - 1] : null
  const nextChapter = isValidIndex && currentIndex < (chapters!.length - 1) ? chapters![currentIndex + 1] : null

  const readerClasses = `reader-${theme} min-h-screen transition-colors duration-200`

  return (
    <div className={readerClasses} style={{
      backgroundColor: `var(--reader-bg)`,
      color: `var(--reader-text)`,
      fontSize: `${fontSize}px`,
      fontFamily: fontFamily === 'serif' ? '"Noto Serif SC", serif' : 'system-ui, sans-serif',
      lineHeight: lineHeight,
    }}>
      <header className="sticky top-0 z-10 backdrop-blur-md bg-[var(--reader-bg)]/80 border-b border-[var(--reader-text)]/10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to={`/novels/${id}`} className="flex items-center gap-2 text-sm hover:opacity-70">
            <ArrowLeft className="h-4 w-4" />
            返回工作台
          </Link>

          <h2 className="font-medium text-center flex-1 truncate px-4">
            {chapter?.title || novel?.title || '阅读器'}
          </h2>

          <Button variant="ghost" size="icon" onClick={() => setShowSettings(!showSettings)}>
            <Settings2 className="h-4 w-4" />
          </Button>
        </div>

        {showSettings && (
          <div className="border-t border-[var(--reader-text)]/10 px-4 py-3 space-y-3 max-w-3xl mx-auto">
            <div className="flex items-center gap-4 text-sm">
              <label className="shrink-0">字号</label>
              <Select value={String(fontSize)} onValueChange={(v) => setFontSize(Number(v))}>
                <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[14, 16, 18, 20, 22, 24].map(s => (
                    <SelectItem key={s} value={String(s)}>{s}px</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <label className="shrink-0">主题</label>
              <Select value={theme} onValueChange={(v) => setTheme(v as any)}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">浅色</SelectItem>
                  <SelectItem value="dark">暗色</SelectItem>
                  <SelectItem value="sepia">护眼</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <label className="shrink-0">字体</label>
              <Select value={fontFamily} onValueChange={(v) => setFontFamily(v as any)}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="serif">衬线</SelectItem>
                  <SelectItem value="sans">无衬线</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </header>

      <main className="max-w-3xl mx-auto px-8 py-12">
        {chapter?.content ? (
          <article className="prose prose-lg max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {chapter.content}
            </ReactMarkdown>
          </article>
        ) : (
          <div className="text-center py-20 opacity-60">
            <p>请选择一个章节开始阅读</p>
            {!chapterId && chapters && chapters.length > 0 && (
              <Button variant="outline" className="mt-4" onClick={() => navigate(`/novels/${id}/read/${chapters[0].id}`)}>
                从第一章开始
              </Button>
            )}
          </div>
        )}
      </main>

      {(prevChapter || nextChapter) && (
        <footer className="sticky bottom-0 backdrop-blur-md bg-[var(--reader-bg)]/80 border-t border-[var(--reader-text)]/10">
          <div className="max-w-3xl mx-auto px-4 py-3 flex justify-between items-center">
            <Button
              variant="ghost"
              disabled={!prevChapter}
              onClick={() => prevChapter && navigate(`/novels/${id}/read/${prevChapter.id}`)}
              className="gap-2"
            >
              <ChevronLeft className="h-4 w-4" />
              上一章
            </Button>
            <span className="text-xs opacity-50">{currentIndex + 1} / {chapters?.length}</span>
            <Button
              variant="ghost"
              disabled={!nextChapter}
              onClick={() => nextChapter && navigate(`/novels/${id}/read/${nextChapter.id}`)}
              className="gap-2"
            >
              下一章
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </footer>
      )}
    </div>
  )
}
