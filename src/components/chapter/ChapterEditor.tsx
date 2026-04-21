/**
 * @file ChapterEditor.tsx
 * @description 章节编辑器组件，基于Tipoff实现富文本编辑，支持自动保存和内容注入
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { useMutation } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorRoot, EditorContent, useEditor } from 'novel'
import StarterKit from '@tiptap/starter-kit'
import { useDebouncedCallback } from 'use-debounce'
import type { Chapter } from '@/lib/types'
import { api } from '@/lib/api'
import { htmlToMarkdown } from '@/lib/html-to-markdown'
import { Button } from '@/components/ui/button'
import { PenLine, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'

/**
 * 章节编辑器组件属性
 */
interface ChapterEditorProps {
  /** 章节数据对象 */
  chapter: Chapter
  /** 可选的注入内容（从AI生成面板插入） */
  injectedContent?: string
  /** 内容插入完成后的回调 */
  onContentInserted?: () => void
}

/**
 * 章节编辑器内部组件，用于访问useCurrentEditor钩子
 */
function ChapterEditorInner({ chapter, injectedContent, onContentInserted, onSave }: ChapterEditorProps & { onSave: (content: string) => void }) {
  const { editor } = useEditor()
  const [showInsertBanner, setShowInsertBanner] = useState(false)
  const [lastInjectedContent, setLastInjectedContent] = useState<string>('')
  const [pendingContent, setPendingContent] = useState<string>('')

  const isEditorReady = useMemo(() => !!editor, [editor])

  const editorRef = useRef(editor)
  const onContentInsertedRef = useRef(onContentInserted)
  const onSaveRef = useRef(onSave)

  editorRef.current = editor
  onContentInsertedRef.current = onContentInserted
  onSaveRef.current = onSave

  const lastProcessedRef = useRef<string>('')

  useEffect(() => {
    console.log('[ChapterEditor] Editor state changed:', {
      hasEditor: !!editor,
      isReady: !!editor,
      hasPendingContent: !!pendingContent
    })
  }, [editor, pendingContent])

  const performInsert = useCallback((content: string) => {
    const currentEditor = editorRef.current
    if (!currentEditor) return false

    try {
      currentEditor.commands.insertContent(content)
      setShowInsertBanner(true)
      onContentInsertedRef.current?.()
      setLastInjectedContent(content)
      setTimeout(() => setShowInsertBanner(false), 3000)
      toast.success('内容已注入编辑器')
      console.log('[ChapterEditor] ✅ Content successfully inserted into editor')
      return true
    } catch (error) {
      console.error('[ChapterEditor] Failed to insert content:', error)
      toast.error('内容注入失败，请重试')
      return false
    }
  }, [])

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const startPollingForEditor = useCallback((content: string) => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
    }

    console.log('[ChapterEditor] ⏳ Starting to poll for editor readiness...')

    let attempts = 0
    const maxAttempts = 100

    pollTimerRef.current = setInterval(() => {
      attempts++
      const currentEditor = editorRef.current

      console.log(`[ChapterEditor] Polling attempt ${attempts}/${maxAttempts}:`, {
        hasEditor: !!currentEditor,
        isReady: !!currentEditor
      })

      if (currentEditor && content !== lastProcessedRef.current) {
        console.log('[ChapterEditor] ✅ Editor is ready! Inserting cached content now.')
        clearInterval(pollTimerRef.current!)
        pollTimerRef.current = null
        lastProcessedRef.current = content
        performInsert(content)
        setPendingContent('')
        return
      }

      if (attempts >= maxAttempts) {
        console.warn('[ChapterEditor] ⚠️ Max polling attempts reached. Editor may not be initializing.')
        clearInterval(pollTimerRef.current!)
        pollTimerRef.current = null
        toast.error('编辑器初始化超时，请刷新页面后重试')
      }
    }, 100)
  }, [performInsert])

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (isEditorReady && pendingContent && pendingContent !== lastProcessedRef.current) {
      console.log('[ChapterEditor] Auto-injecting pending content:', pendingContent.substring(0, 50) + '...')
      lastProcessedRef.current = pendingContent
      performInsert(pendingContent)
      setPendingContent('')
    }
  }, [isEditorReady, pendingContent, performInsert])

  useEffect(() => {
    if (!injectedContent || injectedContent === lastInjectedContent) return

    console.log('[ChapterEditor] Received new injectedContent:', injectedContent.substring(0, 50) + '...')
    console.log('[ChapterEditor] isEditorReady:', isEditorReady, 'editor exists:', !!editor)

    if (isEditorReady && editor) {
      lastProcessedRef.current = injectedContent
      performInsert(injectedContent)
    } else {
      setPendingContent(injectedContent)
      toast.info('编辑器准备中，内容将在就绪后自动写入')
      console.log('[ChapterEditor] Content cached in pendingContent, waiting for editor...')
      startPollingForEditor(injectedContent)
    }
  }, [injectedContent, lastInjectedContent, isEditorReady, editor, performInsert, startPollingForEditor])

  const handleInsertContent = () => {
    if (!injectedContent) {
      toast.error('没有可写入的生成内容')
      return
    }

    const currentEditor = editorRef.current

    if (!isEditorReady || !currentEditor) {
      setPendingContent(injectedContent)
      toast.info('编辑器准备中，内容将在就绪后自动写入')
      console.log('[ChapterEditor] Manual insert: Editor not ready, caching content')
      startPollingForEditor(injectedContent)
      return
    }

    try {
      console.log('[ChapterEditor] Manual insert: Editor ready, inserting now')

      if (currentEditor.getText().trim()) {
        currentEditor.commands.insertContent('\n\n' + injectedContent)
      } else {
        currentEditor.commands.insertContent(injectedContent)
      }

      onSaveRef.current(htmlToMarkdown(currentEditor.getHTML()))
      setShowInsertBanner(true)
      onContentInsertedRef.current?.()
      setLastInjectedContent(injectedContent)
      setTimeout(() => setShowInsertBanner(false), 3000)
      toast.success('内容已成功写入')
    } catch (error) {
      console.error('[ChapterEditor] Failed to insert content:', error)
      toast.error('内容写入失败，请重试')
    }
  }

  return (
    <div>
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

      <EditorContent
        extensions={[StarterKit]}
        initialContent={chapter.content || '<p></p>' as any}
        onUpdate={({ editor: updatedEditor }: any) => {
          const html = updatedEditor.getHTML()
          if (html !== '<p></p>') onSave(htmlToMarkdown(html))
        }}
        className="font-serif text-base leading-relaxed focus:outline-none min-h-[500px]"
      />
    </div>
  )
}

/**
 * 章节编辑器组件
 * @description 基于Tipoff的富文本编辑器，支持自动保存、内容注入和撤销功能
 * @param {ChapterEditorProps} props - 组件属性
 * @returns {JSX.Element} 编辑器组件
 */
export function ChapterEditor({ chapter, injectedContent, onContentInserted }: ChapterEditorProps) {
  const mutation = useMutation({
    mutationFn: (content: string) => api.chapters.update(chapter.id, { content }),
  })

  const save = useDebouncedCallback((content: string) => {
    mutation.mutate(content)
  }, 1500)

  return (
    <div className="max-w-3xl mx-auto px-8 py-12">
      <EditorRoot>
        <ChapterEditorInner
          chapter={chapter}
          injectedContent={injectedContent}
          onContentInserted={onContentInserted}
          onSave={save}
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
