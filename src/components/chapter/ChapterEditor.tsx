import { useMutation } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { EditorRoot, EditorContent, type EditorInstance } from 'novel'
import { useDebouncedCallback } from 'use-debounce'
import type { Chapter } from '@/lib/types'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { PenLine, RotateCcw } from 'lucide-react'

interface ChapterEditorProps {
  chapter: Chapter
  injectedContent?: string
  onContentInserted?: () => void
}

export function ChapterEditor({ chapter, injectedContent, onContentInserted }: ChapterEditorProps) {
  const mutation = useMutation({
    mutationFn: (content: string) => api.chapters.update(chapter.id, { content }),
  })

  const [showInsertBanner, setShowInsertBanner] = useState(false)
  const editorRef = useRef<EditorInstance | null>(null)

  const save = useDebouncedCallback((content: string) => {
    mutation.mutate(content)
  }, 1500)

  useEffect(() => {
    if (injectedContent && editorRef.current) {
      const editor = editorRef.current
      editor.commands.insertContent(injectedContent)
      setShowInsertBanner(true)
      onContentInserted?.()
      setTimeout(() => setShowInsertBanner(false), 3000)
    }
  }, [injectedContent])

  const handleInsertContent = () => {
    if (!injectedContent || !editorRef.current) return

    const editor = editorRef.current

    if (editor.getText().trim()) {
      editor.commands.insertContent('\n\n' + injectedContent)
    } else {
      editor.commands.insertContent(injectedContent)
    }

    save(editor.getHTML())
    setShowInsertBanner(true)
    onContentInserted?.()
    setTimeout(() => setShowInsertBanner(false), 3000)
  }

  return (
    <div className="max-w-3xl mx-auto px-8 py-12">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">{chapter.title}</h1>
        {injectedContent && (
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={handleInsertContent}
          >
            <PenLine className="h-4 w-4" />
            写入生成内容
          </Button>
        )}
      </div>

      {showInsertBanner && (
        <div className="mb-4 p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg flex items-center justify-between animate-in slide-in-from-top-2">
          <span className="text-sm text-green-700 dark:text-green-300">✓ 内容已成功写入编辑器</span>
          <Button variant="ghost" size="sm" onClick={() => setShowInsertBanner(false)}>
            <RotateCcw className="h-3 w-3" />
          </Button>
        </div>
      )}

      <EditorRoot>
        <EditorContent
          ref={editorRef as any}
          initialContent={chapter.content ?? undefined as any}
          onUpdate={({ editor }: any) => {
            editorRef.current = editor
            const html = editor.getHTML()
            if (html !== '<p></p>') save(html)
          }}
          className="font-serif text-base leading-relaxed focus:outline-none min-h-[500px]"
        />
      </EditorRoot>

      <div className="text-xs text-muted-foreground mt-4 flex items-center gap-2">
        <span className={`inline-block w-2 h-2 rounded-full ${mutation.isPending ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'}`} />
        {mutation.isPending ? '保存中...' : '已自动保存'}
        {mutation.isSuccess && ' · 上次保存成功'}
      </div>
    </div>
  )
}
