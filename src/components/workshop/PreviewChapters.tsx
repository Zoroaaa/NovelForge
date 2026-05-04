/**
 * @file PreviewChapters.tsx
 * @description 预览面板 - 章节列表预览（标题/摘要/排序）
 * @date 2026-05-04
 */
import { FileText } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { Chapter } from './types'

interface PreviewChaptersProps {
  chapters: Chapter[]
}

export function PreviewChapters({ chapters }: PreviewChaptersProps) {
  if (!chapters || chapters.length === 0) return null

  return (
    <div className="rounded-lg border bg-background p-4 space-y-3">
      <h4 className="text-sm font-semibold flex items-center gap-2">
        <FileText className="h-4 w-4 text-primary" />
        章节大纲
      </h4>
      <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
        {chapters.map((chap, i) => (
          <div key={i} className="border-l-2 border-primary/20 pl-3 py-1">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="secondary" className="text-[10px]">第{i + 1}章</Badge>
              <span className="font-medium text-sm">{chap.title}</span>
            </div>
            {chap.summary && (
              <p className="text-xs text-muted-foreground line-clamp-2 ml-5">{chap.summary}</p>
            )}
            {chap.characters && chap.characters.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1 ml-5">
                {chap.characters.slice(0, 4).map((char, idx) => (
                  <Badge key={idx} variant="outline" className="text-[10px]">{char}</Badge>
                ))}
                {chap.characters.length > 4 && (
                  <Badge variant="outline" className="text-[10px]">+{chap.characters.length - 4}</Badge>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
