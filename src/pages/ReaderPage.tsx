/**
 * @file ReaderPage.tsx
 * @description 阅读器页面组件，提供小说章节的阅读功能，支持主题、字号、字体设置及一键排版
 * @version 2.0.0
 * @modified 2026-04-22 - 添加一键排版功能、增强排版选项和阅读体验
 */
import { useQuery } from '@tanstack/react-query'
import { useParams, useNavigate, Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '@/lib/api'
import { useReaderStore } from '@/store/readerStore'
import { formatForReading } from '@/lib/formatContent'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ArrowLeft, ChevronLeft, ChevronRight, Settings2, Type, Maximize2, Minimize2, Sparkles } from 'lucide-react'
import { useState, useMemo, useCallback, useEffect } from 'react'

type ParagraphIndent = 'none' | 'two-char' | 'four-char'
type DialogueStyle = 'normal' | 'highlight' | 'indent'

interface ReaderSettings {
  paragraphIndent: ParagraphIndent
  dialogueStyle: DialogueStyle
  paragraphSpacing: number
  showFormatted: boolean
  isFullscreen: boolean
}

/**
 * 阅读器页面组件
 * @description 提供小说章节的阅读功能，支持主题切换、字号调整、字体选择、一键排版等个性化设置
 * @returns {JSX.Element} 阅读器页面
 */
export default function ReaderPage() {
  const { id, chapterId } = useParams<{ id: string; chapterId?: string }>()
  const navigate = useNavigate()
  const [showSettings, setShowSettings] = useState(false)

  const { fontSize, theme, fontFamily, lineHeight, setFontSize, setTheme, setFontFamily } = useReaderStore()

  const [readerSettings, setReaderSettings] = useState<ReaderSettings>({
    paragraphIndent: 'two-char',
    dialogueStyle: 'highlight',
    paragraphSpacing: 1.8,
    showFormatted: false,
    isFullscreen: false,
  })

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

  const displayContent = useMemo(() => {
    if (!chapter?.content) return ''

    if (readerSettings.showFormatted) {
      return formatForReading(chapter.content)
    }

    return chapter.content
  }, [chapter?.content, readerSettings.showFormatted])

  const wordCount = useMemo(() => {
    if (!chapter?.content) return 0
    return chapter.content.replace(/\s/g, '').length
  }, [chapter?.content])

  const readingTime = useMemo(() => {
    const wordsPerMinute = 500
    const minutes = Math.ceil(wordCount / wordsPerMinute)
    return minutes > 60 ? `${Math.floor(minutes / 60)}小时${minutes % 60}分钟` : `${minutes}分钟`
  }, [wordCount])

  const handleFormatToggle = useCallback(() => {
    setReaderSettings(prev => ({
      ...prev,
      showFormatted: !prev.showFormatted,
    }))
  }, [])

  const handleFullscreenToggle = useCallback(() => {
    setReaderSettings(prev => ({
      ...prev,
      isFullscreen: !prev.isFullscreen,
    }))
  }, [])

  const getParagraphIndentStyle = useCallback((): string => {
    switch (readerSettings.paragraphIndent) {
      case 'none':
        return ''
      case 'two-char':
        return 'text-indent: 2em;'
      case 'four-char':
        return 'text-indent: 4em;'
      default:
        return ''
    }
  }, [readerSettings.paragraphIndent])

  const readerClasses = `reader-${theme} min-h-screen transition-colors duration-200 ${readerSettings.isFullscreen ? 'fixed inset-0 z-50 overflow-y-auto' : ''}`

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && readerSettings.isFullscreen) {
        setReaderSettings(prev => ({ ...prev, isFullscreen: false }))
      }
    }

    if (readerSettings.isFullscreen) {
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }
  }, [readerSettings.isFullscreen])

  return (
    <div className={readerClasses} style={{
      backgroundColor: `var(--reader-bg)`,
      color: `var(--reader-text)`,
      fontSize: `${fontSize}px`,
      fontFamily: fontFamily === 'serif' ? '"Noto Serif SC", "Source Han Serif SC", serif' : '"Noto Sans SC", system-ui, sans-serif',
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

          <div className="flex items-center gap-1">
            {chapter?.content && (
              <Button
                variant="ghost"
                size="icon"
                onClick={handleFormatToggle}
                title={readerSettings.showFormatted ? '关闭智能排版' : '一键排版'}
                className={readerSettings.showFormatted ? 'text-primary' : ''}
              >
                <Sparkles className={`h-4 w-4 ${readerSettings.showFormatted ? 'fill-current' : ''}`} />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={handleFullscreenToggle}
              title={readerSettings.isFullscreen ? '退出全屏' : '全屏阅读'}
            >
              {readerSettings.isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setShowSettings(!showSettings)}>
              <Settings2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {showSettings && (
          <div className="border-t border-[var(--reader-text)]/10 px-4 py-3 space-y-3 max-w-3xl mx-auto">
            <div className="flex items-center gap-4 text-sm">
              <label className="shrink-0 flex items-center gap-1">
                <Type className="h-3.5 w-3.5" />
                字号
              </label>
              <Select value={String(fontSize)} onValueChange={(v) => setFontSize(Number(v))}>
                <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[14, 16, 18, 20, 22, 24, 26, 28].map(s => (
                    <SelectItem key={s} value={String(s)}>{s}px</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <label className="shrink-0">主题</label>
              <Select value={theme} onValueChange={(v) => setTheme(v as 'light' | 'dark' | 'sepia')}>
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
              <Select value={fontFamily} onValueChange={(v: 'serif' | 'sans') => setFontFamily(v)}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="serif">衬线体</SelectItem>
                  <SelectItem value="sans">无衬线</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <label className="shrink-0">首行缩进</label>
              <Select
                value={readerSettings.paragraphIndent}
                onValueChange={(v) => setReaderSettings(p => ({ ...p, paragraphIndent: v as ParagraphIndent }))}
              >
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">无缩进</SelectItem>
                  <SelectItem value="two-char">两字符</SelectItem>
                  <SelectItem value="four-char">四字符</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <label className="shrink-0">段落间距</label>
              <Select
                value={String(readerSettings.paragraphSpacing)}
                onValueChange={(v) => setReaderSettings(p => ({ ...p, paragraphSpacing: Number(v) }))}
              >
                <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1.4, 1.6, 1.8, 2.0, 2.2, 2.5].map(s => (
                    <SelectItem key={s} value={String(s)}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <label className="shrink-0">对话样式</label>
              <Select
                value={readerSettings.dialogueStyle}
                onValueChange={(v) => setReaderSettings(p => ({ ...p, dialogueStyle: v as DialogueStyle }))}
              >
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">普通</SelectItem>
                  <SelectItem value="highlight">高亮</SelectItem>
                  <SelectItem value="indent">缩进</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {wordCount > 0 && (
              <div className="text-xs opacity-60 pt-2 border-t border-[var(--reader-text)]/10">
                本文字数：{wordCount.toLocaleString()} 字 · 预计阅读时间：{readingTime}
              </div>
            )}
          </div>
        )}
      </header>

      <main
        className="max-w-3xl mx-auto px-8 py-12"
        style={{ marginBottom: readerSettings.isFullscreen ? '80px' : undefined }}
      >
        {chapter?.content ? (
          <article className="reader-content max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {displayContent}
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

        {readerSettings.showFormatted && chapter?.content && (
          <div className="mt-6 p-3 bg-primary/5 border border-primary/20 rounded-lg text-xs text-muted-foreground">
            ✨ 已启用智能排版模式 · 内容已自动优化段落结构和可读性
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

      <style>{`
        .reader-content h1,
        .reader-content h2,
        .reader-content h3 {
          font-weight: 700;
          margin-top: 2em;
          margin-bottom: 0.8em;
          line-height: 1.4;
        }

        .reader-content h1 { font-size: 1.8em; }
        .reader-content h2 { font-size: 1.5em; }
        .reader-content h3 { font-size: 1.25em; }

        .reader-content p {
          margin-bottom: ${readerSettings.paragraphSpacing}em;
          text-align: justify;
          ${getParagraphIndentStyle()}
        }

        .reader-content blockquote {
          margin: 1.5em 0;
          padding: 0.8em 1.2em;
          border-left: 4px solid var(--reader-text);
          background-color: rgba(128, 128, 128, 0.08);
          font-style: italic;
        }

        .reader-content hr {
          margin: 2.5em auto;
          max-width: 200px;
          border: none;
          height: 2px;
          background: linear-gradient(
            to right,
            transparent,
            var(--reader-text),
            transparent
          );
          opacity: 0.3;
        }

        .reader-content strong {
          font-weight: 600;
        }

        .reader-content em {
          font-style: italic;
        }

        .reader-content code {
          background-color: rgba(128, 128, 128, 0.15);
          padding: 0.15em 0.4em;
          border-radius: 3px;
          font-size: 0.9em;
        }

        .reader-content ul,
        .reader-content ol {
          margin-bottom: ${readerSettings.paragraphSpacing}em;
          padding-left: 2em;
        }

        .reader-content li {
          margin-bottom: 0.5em;
        }

        .dialogue-group p.dialogue {
          ${
            readerSettings.dialogueStyle === 'highlight'
              ? 'color: var(--reader-accent, #d97706); font-weight: 500;'
              : readerSettings.dialogueStyle === 'indent'
              ? 'margin-left: 2em; margin-right: 2em;'
              : ''
          }
        }

        .scene-divider {
          text-align: center;
          letter-spacing: 0.5em;
          color: var(--reader-text);
          opacity: 0.4;
        }
      `}</style>
    </div>
  )
}
