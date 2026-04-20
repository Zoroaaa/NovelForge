/**
 * NovelForge · ContextPreview 组件
 *
 * 展示 AI 生成时使用的 RAG 上下文信息：
 * - 强制注入内容（大纲、摘要、角色）
 * - RAG 检索到的相关片段
 * - Token 使用统计
 */

import { useState } from 'react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  ChevronDown,
  ChevronRight,
  FileText,
  User,
  BookOpen,
  Brain,
  Clock,
  Hash,
  AlertCircle,
} from 'lucide-react'

export interface ContextDebugInfo {
  totalTokenEstimate: number
  ragHitsCount: number
  skippedByBudget: number
  buildTimeMs: number
}

export interface RagChunk {
  sourceType: 'outline' | 'character' | 'chapter_summary'
  title: string
  content: string
  score: number
}

export interface ContextBundle {
  mandatory: {
    chapterOutline: string
    prevChapterSummary: string
    volumeSummary: string
    protagonistCards: string[]
  }
  ragChunks: RagChunk[]
  debug: ContextDebugInfo
}

interface ContextPreviewProps {
  contextBundle: ContextBundle | null
  isGenerating?: boolean
}

const SOURCE_TYPE_CONFIG = {
  outline: { icon: FileText, label: '大纲', color: 'bg-blue-100 text-blue-800' },
  character: { icon: User, label: '角色', color: 'bg-purple-100 text-purple-800' },
  chapter_summary: { icon: BookOpen, label: '章节摘要', color: 'bg-green-100 text-green-800' },
}

export function ContextPreview({ contextBundle, isGenerating }: ContextPreviewProps) {
  const [isOpen, setIsOpen] = useState(false)

  if (!contextBundle && !isGenerating) return null

  if (isGenerating && !contextBundle) {
    return (
      <div className="space-y-2 p-3 bg-muted/30 rounded-lg border">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Brain className="h-4 w-4 animate-pulse text-primary" />
          <span>正在构建智能上下文...</span>
        </div>
        <p className="text-xs text-muted-foreground pl-6">
          Agent 正在检索相关资料、组装生成上下文
        </p>
      </div>
    )
  }

  if (!contextBundle) return null

  const { mandatory, ragChunks, debug } = contextBundle

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="space-y-2 p-3 bg-muted/30 rounded-lg border">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="w-full justify-between p-0 h-auto hover:bg-transparent">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">AI 上下文预览</span>
              <Badge variant="secondary" className="text-xs">
                Phase 2
              </Badge>
            </div>

            <div className="flex items-center gap-3">
              {/* 统计信息 */}
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Hash className="h-3 w-3" />
                  ~{debug.totalTokenEstimate} tokens
                </span>
                {ragChunks.length > 0 && (
                  <Badge variant="outline" className="text-xs">
                    +{ragChunks.length} RAG
                  </Badge>
                )}
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {debug.buildTimeMs}ms
                </span>
              </div>

              {isOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </div>
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="pt-3 space-y-3 mt-2 border-t">
            {/* 强制注入部分 */}
            {(mandatory.chapterOutline || mandatory.prevChapterSummary || mandatory.volumeSummary) && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <FileText className="h-3 w-3" />
                  基础上下文（强制注入）
                </h4>

                <div className="space-y-1.5 pl-4">
                  {mandatory.chapterOutline && (
                    <ContextItem
                      label="本章大纲"
                      content={mandatory.chapterOutline}
                      type="outline"
                    />
                  )}
                  {mandatory.prevChapterSummary && (
                    <ContextItem
                      label="上一章摘要"
                      content={mandatory.prevChapterSummary}
                      type="chapter_summary"
                    />
                  )}
                  {mandatory.volumeSummary && (
                    <ContextItem
                      label="当前卷概要"
                      content={mandatory.volumeSummary}
                      type="outline"
                    />
                  )}
                </div>
              </div>
            )}

            {/* 角色卡 */}
            {mandatory.protagonistCards.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <User className="h-3 w-3" />
                  出场角色 ({mandatory.protagonistCards.length})
                </h4>
                <ScrollArea className="max-h-32 rounded-md border bg-background/50 p-2">
                  <div className="space-y-1.5">
                    {mandatory.protagonistCards.map((card, index) => (
                      <div key={index} className="text-xs p-2 bg-muted/50 rounded">
                        <pre className="whitespace-pre-wrap font-mono leading-relaxed">
                          {card.slice(0, 200)}{card.length > 200 ? '...' : ''}
                        </pre>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* RAG 检索结果 */}
            {ragChunks.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <Brain className="h-3 w-3" />
                  RAG 语义检索 ({ragChunks.length} 条)
                </h4>

                <div className="space-y-1.5 pl-4">
                  {ragChunks.map((chunk, index) => {
                    const config = SOURCE_TYPE_CONFIG[chunk.sourceType]
                    const Icon = config.icon

                    return (
                      <div
                        key={index}
                        className="group p-2 rounded-md border hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="text-xs font-medium truncate">{chunk.title}</span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${config.color}`}>
                              {config.label}
                            </Badge>
                            <span className="text-[10px] text-muted-foreground font-mono">
                              {(chunk.score * 100).toFixed(0)}%
                            </span>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2 pl-5">
                          {chunk.content}
                        </p>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* 预算警告 */}
            {debug.skippedByBudget > 0 && (
              <div className="flex items-center gap-2 p-2 bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded-md">
                <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 shrink-0" />
                <span className="text-xs text-yellow-700 dark:text-yellow-300">
                  因 token 预算限制，跳过了 {debug.skippedByBudget} 条低相关性内容
                </span>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

/** 单个上下文项 */
function ContextItem({
  label,
  content,
  type,
}: {
  label: string
  content: string
  type: string
}) {
  const [expanded, setExpanded] = useState(false)
  const config = SOURCE_TYPE_CONFIG[type as keyof typeof SOURCE_TYPE_CONFIG]

  return (
    <div className="rounded border p-2 space-y-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full text-left"
      >
        <span className="text-xs font-medium flex items-center gap-1.5">
          <Badge variant="outline" className={`text-[10px] ${config?.color}`}>
            {config?.label}
          </Badge>
          {label}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {content.length} 字符
        </span>
      </button>

      {expanded && (
        <div className="text-xs text-muted-foreground bg-background/50 rounded p-2 max-h-24 overflow-y-auto">
          <pre className="whitespace-pre-wrap font-mono leading-relaxed">
            {content.slice(0, 500)}{content.length > 500 ? '\n...(截断)' : ''}
          </pre>
        </div>
      )}
    </div>
  )
}
