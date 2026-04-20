import { useMutation } from '@tanstack/react-query'
import { EditorRoot, EditorContent } from 'novel'
import { useDebouncedCallback } from 'use-debounce'
import type { Chapter } from '@/lib/types'
import { api } from '@/lib/api'

interface ChapterEditorProps {
  chapter: Chapter
}

export function ChapterEditor({ chapter }: ChapterEditorProps) {
  const mutation = useMutation({
    mutationFn: (content: string) => api.chapters.update(chapter.id, { content }),
  })

  const save = useDebouncedCallback((content: string) => {
    mutation.mutate(content)
  }, 1500)

  return (
    <div className="max-w-3xl mx-auto px-8 py-12">
      <h1 className="text-2xl font-bold mb-8">{chapter.title}</h1>

      <EditorRoot>
        <EditorContent
          initialContent={chapter.content ?? undefined as any}
          onUpdate={({ editor }: any) => {
            const html = editor.getHTML()
            if (html !== '<p></p>') save(html)
          }}
          className="font-serif text-base leading-relaxed focus:outline-none"
        />
      </EditorRoot>

      <div className="text-xs text-muted-foreground mt-4 flex items-center gap-2">
        <span className={`inline-block w-2 h-2 rounded-full ${mutation.isPending ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'}`} />
        {mutation.isPending ? '保存中...' : '已保存'}
      </div>
    </div>
  )
}
