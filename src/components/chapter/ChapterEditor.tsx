/**
 * @file ChapterEditor.tsx
 * @description 章节编辑器组件，基于 novel/tiptap 实现富文本编辑，支持自动保存和内容注入
 * @version 2.0.0
 * @modified 2026-04-22 - 重构内容注入逻辑，用 onCreate ref 替代 useEditor() 轮询，彻底解决时序问题
 */
import { useMutation } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { EditorRoot, EditorContent } from 'novel'
import StarterKit from '@tiptap/starter-kit'
import { useDebouncedCallback } from 'use-debounce'
import type { Chapter } from '@/lib/types'
import { api } from '@/lib/api'
import { htmlToMarkdown } from '@/lib/html-to-markdown'
import { formatContentForEditor } from '@/lib/formatContent'
import { Button } from '@/components/ui/button'
import { PenLine, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'

/**
 * 章节编辑器组件属性
 */
interface ChapterEditorProps {
  chapter: Chapter
  injectedContent?: string
  injectedInsertMode?: 'replace' | 'append'
  onContentInserted?: () => void
  onContentChange?: (content: string) => void
}

/**
 * 章节编辑器组件
 * @description 基于 novel/tiptap 的富文本编辑器，支持自动保存、内容注入
 *
 * 核心设计：通过 EditorContent 的 onCreate 回调直接获取 editor 实例并存入 ref，
 * 避免依赖 useEditor() hook 的异步 re-render 时序，从根本上解决内容注入竞态问题。
 */
export function ChapterEditor({ chapter, injectedContent, injectedInsertMode = 'replace', onContentInserted, onContentChange }: ChapterEditorProps) {
  const mutation = useMutation({
    mutationFn: (content: string) => api.chapters.update(chapter.id, { content }),
  })

  const save = useDebouncedCallback((content: string) => {
    mutation.mutate(content)
  }, 1500)

  // 直接持有 editor 实例，通过 onCreate 赋值，不依赖 useEditor() 的 re-render 时序
  const editorRef = useRef<any>(null)
  // 存储在 editor ready 之前到达的内容
  const pendingContentRef = useRef<string | null>(null)
  // 存储待注入内容的插入模式
  const pendingInsertModeRef = useRef<'replace' | 'append'>('replace')

  const [showInsertBanner, setShowInsertBanner] = useState(false)
  // 用于去重：记录最后一次成功处理的内容，避免同一内容重复注入
  const lastInsertedRef = useRef<string>('')

  const onContentInsertedRef = useRef(onContentInserted)
  onContentInsertedRef.current = onContentInserted

  /**
   * 监听章节切换：当 chapter.id 变化时，主动更新编辑器内容
   */
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    if (chapter.content) {
      editor.commands.setContent(chapter.content)
    } else {
      editor.commands.setContent('<p></p>')
    }
  }, [chapter.id, chapter.content])

  /**
   * 核心注入函数：向编辑器写入内容并触发保存
   * @param mode 'replace' 覆盖模式（清空内容后写入）|'append' 追加模式（在末尾接入内容）
   */
  const doInsert = (editor: any, content: string, mode: 'replace' | 'append' = 'replace') => {
    try {
      const formattedContent = formatContentForEditor(content)

      if (!formattedContent) {
        toast.warning('内容为空，无法写入')
        return
      }

      if (mode === 'replace') {
        editor.commands.setContent(formattedContent)
      } else {
        if (editor.getText().trim()) {
          editor.commands.insertContentAt(editor.state.doc.content.size, formattedContent)
        } else {
          editor.commands.setContent(formattedContent)
        }
      }
      save(htmlToMarkdown(editor.getHTML()))

      lastInsertedRef.current = content
      setShowInsertBanner(true)
      setTimeout(() => setShowInsertBanner(false), 3000)
      onContentInsertedRef.current?.()
      toast.success(mode === 'replace' ? '内容已覆盖写入编辑器' : '内容已追加到编辑器')
    } catch (error) {
      console.error('[ChapterEditor] Insert failed:', error)
      toast.error('内容写入失败，请重试')
    }
  }

  /**
   * 监听 injectedContent 变化
   * - editor 已就绪：直接注入
   * - editor 尚未就绪：缓存到 pendingContentRef，等 onCreate 触发时处理
   */
  useEffect(() => {
    if (!injectedContent || injectedContent === lastInsertedRef.current) return

    const editor = editorRef.current
    if (editor) {
      doInsert(editor, injectedContent, injectedInsertMode)
    } else {
      pendingContentRef.current = injectedContent
      pendingInsertModeRef.current = injectedInsertMode
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [injectedContent, injectedInsertMode])

  /**
   * 手动点击"写入生成内容"按钮
   */
  const handleInsertContent = () => {
    if (!injectedContent) {
      toast.error('没有可写入的生成内容')
      return
    }
    const editor = editorRef.current
    if (!editor) {
      pendingContentRef.current = injectedContent
      pendingInsertModeRef.current = injectedInsertMode
      toast.info('编辑器准备中，内容将在就绪后自动写入')
      return
    }
    doInsert(editor, injectedContent, injectedInsertMode)
  }

  return (
    <div className="max-w-3xl mx-auto px-8 py-12">
      <EditorRoot>
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
            onCreate={({ editor: createdEditor }: { editor: any }) => {
              editorRef.current = createdEditor
              if (pendingContentRef.current && pendingContentRef.current !== lastInsertedRef.current) {
                const pending = pendingContentRef.current
                const pendingMode = pendingInsertModeRef.current
                pendingContentRef.current = null
                pendingInsertModeRef.current = 'replace'
                doInsert(createdEditor, pending, pendingMode)
              }
            }}
            onUpdate={({ editor: updatedEditor }: any) => {
              const html = updatedEditor.getHTML()
              const md = htmlToMarkdown(html)
              if (html !== '<p></p>') save(md)
              onContentChange?.(md)
            }}
            onDestroy={() => {
              editorRef.current = null
            }}
            className="font-serif text-base leading-relaxed focus:outline-none min-h-[500px]"
          />
        </div>
      </EditorRoot>

      <div className="text-xs text-muted-foreground mt-4 flex items-center gap-2">
        <span className={`inline-block w-2 h-2 rounded-full ${mutation.isPending ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'}`} />
        {mutation.isPending ? '保存中...' : '已自动保存'}
        {mutation.isSuccess && ' · 上次保存成功'}
      </div>
    </div>
  )
}
