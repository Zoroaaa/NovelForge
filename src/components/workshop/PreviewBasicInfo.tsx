import { Sparkles, Zap } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { ExtractedData } from './types'

interface PreviewBasicInfoProps {
  data: Pick<ExtractedData, 'title' | 'genre' | 'description' | 'coreAppeal' | 'targetWordCount' | 'targetChapters'>
}

export function PreviewBasicInfo({ data }: PreviewBasicInfoProps) {
  const { title, genre, description, coreAppeal, targetWordCount, targetChapters } = data

  if (!title && !genre && !description && !targetWordCount && !targetChapters && !coreAppeal?.length) {
    return null
  }

  return (
    <div className="rounded-lg border bg-background p-4 space-y-3">
      <h4 className="text-sm font-semibold flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        基本信息
      </h4>
      <div className="space-y-2">
        {title && (
          <div className="space-y-0.5">
            <span className="text-xs text-muted-foreground">标题</span>
            <p className="text-sm font-semibold text-base">{title}</p>
          </div>
        )}
        {genre && (
          <div className="space-y-0.5">
            <span className="text-xs text-muted-foreground">流派</span>
            <p className="text-sm">{genre}</p>
          </div>
        )}
        {description && (
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">简介</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">四要素格式</span>
            </div>
            <pre className="text-sm whitespace-pre-wrap bg-muted/50 p-2 rounded text-xs max-h-28 overflow-auto">{description}</pre>
          </div>
        )}
        {targetWordCount && (
          <div className="space-y-0.5">
            <span className="text-xs text-muted-foreground">预计字数</span>
            <p className="text-sm">{targetWordCount}万字</p>
          </div>
        )}
        {targetChapters && (
          <div className="space-y-0.5">
            <span className="text-xs text-muted-foreground">预计章节</span>
            <p className="text-sm">{targetChapters}章</p>
          </div>
        )}
        {coreAppeal && coreAppeal.length > 0 && (
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground flex items-center gap-1"><Zap className="h-3 w-3" />核心爽点</span>
            <div className="flex flex-wrap gap-1">
              {coreAppeal.map((item, i) => (
                <Badge key={i} variant="secondary" className="text-xs">{item}</Badge>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
