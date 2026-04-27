/**
 * @file ChapterSummaryTab.tsx
 * @description 章摘要Tab组件，提供章节摘要的查看和编辑功能
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, FileText, Sparkles, Pencil, Check, X } from 'lucide-react'

interface ChapterSummaryTabProps {
  chapterId: string
  chapterTitle: string
  summary: string | null
  summaryAt: number | null
  summaryModel: string | null
  onSummaryChange?: (summary: string) => void
}

export function ChapterSummaryTab({
  chapterId,
  chapterTitle,
  summary,
  summaryAt,
  summaryModel,
  onSummaryChange,
}: ChapterSummaryTabProps) {
  const queryClient = useQueryClient()
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(summary || '')

  const updateMutation = useMutation({
    mutationFn: (newSummary: string) => api.chapters.update(chapterId, { summary: newSummary }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chapters'] })
      toast.success('摘要已保存')
      setIsEditing(false)
      onSummaryChange?.(editValue)
    },
    onError: (error) => {
      toast.error(`保存失败: ${error.message}`)
    },
  })

  const generateSummaryMutation = useMutation({
    mutationFn: () => api.chapters.generateSummary(chapterId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chapters'] })
      toast.success('摘要生成中...')
    },
    onError: (error) => {
      toast.error(`生成失败: ${error.message}`)
    },
  })

  const handleSave = () => {
    updateMutation.mutate(editValue)
  }

  const handleCancel = () => {
    setEditValue(summary || '')
    setIsEditing(false)
  }

  const handleGenerate = () => {
    generateSummaryMutation.mutate()
  }

  return (
    <div className="p-4 space-y-4">
      <div className="space-y-2">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          章摘要
        </h3>
        <p className="text-xs text-muted-foreground">
          当前章节：{chapterTitle}
        </p>
      </div>

      {summaryAt && (
        <div className="text-[10px] text-muted-foreground bg-muted/50 rounded px-2 py-1.5">
          <span>最后更新：{new Date(summaryAt * 1000).toLocaleString()}</span>
          {summaryModel && (
            <span className="ml-2">· 生成模型：{summaryModel}</span>
          )}
        </div>
      )}

      {!summary && !isEditing && (
        <div className="text-center py-8 space-y-3">
          <div className="w-12 h-12 mx-auto rounded-full bg-muted flex items-center justify-center">
            <FileText className="h-6 w-6 text-muted-foreground/40" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">暂无章节摘要</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              可以手动编辑或让 AI 自动生成
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={handleGenerate}
            disabled={generateSummaryMutation.isPending}
          >
            {generateSummaryMutation.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                AI 生成摘要
              </>
            )}
          </Button>
        </div>
      )}

      {isEditing ? (
        <div className="space-y-3">
          <Textarea
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            placeholder="请输入章节摘要，描述本章的主要内容、情节发展和关键事件..."
            className="min-h-[150px] text-sm resize-y"
            autoFocus
          />
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={handleCancel}>
              <X className="h-3.5 w-3.5 mr-1" />
              取消
            </Button>
            <Button size="sm" onClick={handleSave} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  保存中...
                </>
              ) : (
                <>
                  <Check className="h-3.5 w-3.5 mr-1" />
                  保存
                </>
              )}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {summary ? (
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                {summary}
              </p>
            </div>
          ) : null}
          
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 gap-1.5"
              onClick={() => setIsEditing(true)}
            >
              <Pencil className="h-3.5 w-3.5" />
              {summary ? '编辑摘要' : '手动添加'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 gap-1.5"
              onClick={handleGenerate}
              disabled={generateSummaryMutation.isPending}
            >
              {generateSummaryMutation.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  生成中...
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  AI 生成
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}