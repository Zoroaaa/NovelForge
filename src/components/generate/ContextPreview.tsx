/**
 * @file ContextPreview.tsx
 * @description 上下文预览组件，展示AI生成时使用的RAG上下文信息和Token统计
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
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
  Wrench,
  Loader2,
} from 'lucide-react'

export interface ContextDebugInfo {
  totalTokenEstimate: number
  coreTokens?: number
  supplementaryTokens?: number
  ragHitsCount: number
  skippedByBudget: number
  buildTimeMs: number
  summaryChainLength?: number
  appliedBudgetTier?: { core: number; supplementary: number; rag: number }
}

export interface RagChunk {
  sourceType: 'setting' | 'character' | 'chapter_summary' | 'master_outline' | 'writing_rules'
  title: string
  content: string
  score: number
}

export interface ContextBundle {
  core: {
    chapterOutline: string
    prevChapterSummary: string
    protagonistStateCards: string[]
    highPriorityRules: string[]
  }
  supplementary: {
    summaryChain: string[]
    volumeSummary: string
    characterCards: string[]
    openForeshadowing: string[]
  }
  ragChunks: RagChunk[]
  debug: ContextDebugInfo
}

export interface ToolCallEvent {
  name: string
  args: Record<string, any>
  result: string
  status?: 'running' | 'done'  // Phase 1.4: 工具调用状态
}

const TOOL_LABELS: Record<string, string> = {
  queryOutline: '查询大纲',
  queryCharacter: '查询角色',
  searchSemantic: '语义搜索',
}

interface ContextPreviewProps {
  contextBundle: ContextBundle | null
  isGenerating?: boolean
  toolCalls?: ToolCallEvent[]
}

const SOURCE_TYPE_CONFIG = {
  setting: { icon: FileText, label: '设定', color: 'bg-blue-100 text-blue-800' },
  character: { icon: User, label: '角色', color: 'bg-purple-100 text-purple-800' },
  chapter_summary: { icon: BookOpen, label: '章节摘要', color: 'bg-green-100 text-green-800' },
  master_outline: { icon: FileText, label: '总纲/卷纲', color: 'bg-blue-100 text-blue-800' },
  writing_rules: { icon: AlertCircle, label: '规则', color: 'bg-amber-100 text-amber-800' },
}

export function ContextPreview({ contextBundle, isGenerating, toolCalls }: ContextPreviewProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [toolsExpanded, setToolsExpanded] = useState<number | null>(null)

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
        {toolCalls && toolCalls.length > 0 && (
          <div className="mt-2 space-y-1.5 pl-6">
            {toolCalls.map((tc, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <Wrench className="h-3 w-3 text-amber-500" />
                <span className="text-muted-foreground">{TOOL_LABELS[tc.name] || tc.name}</span>
                <Badge variant="outline" className="text-[10px] h-4 px-1">已完成</Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (!contextBundle) return null

  const { core, supplementary, ragChunks, debug } = contextBundle

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="space-y-2 p-3 bg-muted/30 rounded-lg border">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="w-full justify-between p-0 h-auto hover:bg-transparent">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">AI 上下文预览</span>
              <Badge variant="secondary" className="text-xs">
                Phase 2.2
              </Badge>
            </div>

            <div className="flex items-center gap-3">
              {/* 统计信息 */}
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1" title={`核心: ${debug.coreTokens || 0} | 补充: ${debug.supplementaryTokens || 0}`}>
                  <Hash className="h-3 w-3" />
                  ~{debug.totalTokenEstimate} tokens
                </span>
                {ragChunks.length > 0 && (
                  <Badge variant="outline" className="text-xs">
                    +{ragChunks.length} RAG
                  </Badge>
                )}
                {debug.appliedBudgetTier && (
                  <span className="text-[10px] opacity-70" title={`预算分配 - 核心:${debug.appliedBudgetTier.core} 补充:${debug.appliedBudgetTier.supplementary} RAG:${debug.appliedBudgetTier.rag}`}>
                    分层
                  </span>
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
            {/* 工具调用记录 */}
            {toolCalls && toolCalls.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <Wrench className="h-3 w-3" />
                  Agent 工具调用 ({toolCalls.length})
                </h4>
                <div className="space-y-1.5">
                  {toolCalls.map((tc, i) => (
                    <div key={i} className="rounded border overflow-hidden">
                      <button
                        onClick={() => setToolsExpanded(toolsExpanded === i ? null : i)}
                        className="w-full flex items-center justify-between p-2 text-left hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <Wrench className="h-3.5 w-3.5 text-amber-500" />
                          <span className="text-xs font-medium">{TOOL_LABELS[tc.name] || tc.name}</span>
                          <Badge variant="outline" className="text-[10px] h-4 px-1">
                            {tc.result.startsWith('Error:') ? '失败' : '成功'}
                          </Badge>
                        </div>
                        {toolsExpanded === i ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>
                      {toolsExpanded === i && (
                        <div className="px-3 pb-2 space-y-2 bg-muted/20 border-t">
                          <div className="pt-2">
                            <span className="text-xs text-muted-foreground">参数：</span>
                            <pre className="text-xs mt-1 bg-background p-1.5 rounded font-mono overflow-x-auto">
                              {JSON.stringify(tc.args, null, 2)}
                            </pre>
                          </div>
                          <div>
                            <span className="text-xs text-muted-foreground">结果：</span>
                            <pre className="text-xs mt-1 bg-background p-1.5 rounded font-mono overflow-x-auto max-h-32 whitespace-pre-wrap">
                              {tc.result.slice(0, 1000)}
                              {tc.result.length > 1000 ? '\n...(截断)' : ''}
                            </pre>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Phase 2.2: 第一层 - 核心必带上下文 */}
            {(core.chapterOutline || core.prevChapterSummary) && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <FileText className="h-3 w-3" />
                  核心上下文（强制注入 ~4000 tokens）
                  {debug.coreTokens && (
                    <Badge variant="outline" className="text-[10px]">
                      {debug.coreTokens}t
                    </Badge>
                  )}
                </h4>

                <div className="space-y-1.5 pl-4">
                  {core.chapterOutline && (
                    <ContextItem
                      label="本章大纲"
                      content={core.chapterOutline}
                      type="master_outline"
                    />
                  )}
                  {core.prevChapterSummary && (
                    <ContextItem
                      label="上一章摘要"
                      content={core.prevChapterSummary}
                      type="chapter_summary"
                    />
                  )}
                </div>
              </div>
            )}

            {/* 主角状态卡（含境界信息） */}
            {core.protagonistStateCards.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <User className="h-3 w-3" />
                  主角状态卡（境界 + 随行）
                </h4>
                <ScrollArea className="max-h-32 rounded-md border bg-background/50 p-2">
                  <div className="space-y-1.5">
                    {core.protagonistStateCards.map((card, index) => (
                      <div key={index} className="text-xs p-2 bg-purple-50 dark:bg-purple-950 rounded">
                        <pre className="whitespace-pre-wrap font-mono leading-relaxed">
                          {card.slice(0, 200)}{card.length > 200 ? '...' : ''}
                        </pre>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* 高优先级创作规则 */}
            {core.highPriorityRules.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  创作规则（高优先级）
                </h4>
                <ScrollArea className="max-h-24 rounded-md border bg-background/50 p-2">
                  <div className="space-y-1">
                    {core.highPriorityRules.map((rule, index) => (
                      <div key={index} className="text-xs p-1.5 bg-amber-50 dark:bg-amber-950 rounded">
                        <pre className="whitespace-pre-wrap font-mono leading-relaxed line-clamp-2">
                          {rule.slice(0, 150)}{rule.length > 150 ? '...' : ''}
                        </pre>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* Phase 2.2: 第二层 - 补充上下文 */}
            {(supplementary.summaryChain.length > 0 || supplementary.volumeSummary || supplementary.openForeshadowing.length > 0) && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <BookOpen className="h-3 w-3" />
                  补充上下文（按需注入 ~4000 tokens）
                  {debug.supplementaryTokens && (
                    <Badge variant="outline" className="text-[10px]">
                      {debug.supplementaryTokens}t
                    </Badge>
                  )}
                </h4>

                <div className="space-y-1.5 pl-4">
                  {supplementary.volumeSummary && (
                    <ContextItem
                      label="当前卷概要"
                      content={supplementary.volumeSummary}
                      type="master_outline"
                    />
                  )}

                  {supplementary.summaryChain.length > 0 && (
                    <div className="rounded border p-2 space-y-1">
                      <span className="text-xs font-medium flex items-center gap-1.5">
                        <Badge variant="outline" className="text-[10px]">
                          摘要链 (×{supplementary.summaryChain.length})
                        </Badge>
                      </span>
                      <ScrollArea className="max-h-20 mt-1">
                        <div className="space-y-0.5">
                          {supplementary.summaryChain.map((summary, idx) => (
                            <p key={idx} className="text-xs text-muted-foreground px-1 py-0.5 hover:bg-muted/30 rounded truncate">
                              {summary.slice(0, 120)}{summary.length > 120 ? '...' : ''}
                            </p>
                          ))}
                        </div>
                      </ScrollArea>
                    </div>
                  )}

                  {supplementary.openForeshadowing.length > 0 && (
                    <div className="rounded border p-2 space-y-1">
                      <span className="text-xs font-medium flex items-center gap-1.5">
                        未收尾伏笔 ({supplementary.openForeshadowing.length})
                      </span>
                      <ScrollArea className="max-h-20 mt-1">
                        <div className="space-y-0.5">
                          {supplementary.openForeshadowing.map((fs, idx) => (
                            <p key={idx} className="text-xs text-orange-600 dark:text-orange-400 px-1 py-0.5 truncate">
                              {fs.slice(0, 100)}{fs.length > 100 ? '...' : ''}
                            </p>
                          ))}
                        </div>
                      </ScrollArea>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 本章角色设定卡 */}
            {supplementary.characterCards.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <User className="h-3 w-3" />
                  本章角色设定 ({supplementary.characterCards.length})
                </h4>
                <ScrollArea className="max-h-28 rounded-md border bg-background/50 p-2">
                  <div className="space-y-1">
                    {supplementary.characterCards.map((card, index) => (
                      <div key={index} className="text-xs p-1.5 bg-muted/50 rounded">
                        <pre className="whitespace-pre-wrap font-mono leading-relaxed line-clamp-2">
                          {card.slice(0, 150)}{card.length > 150 ? '...' : ''}
                        </pre>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* 第三层：RAG 检索结果 */}
            {ragChunks.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <Brain className="h-3 w-3" />
                  RAG 动态检索 (~4000 tokens)
                </h4>

                <div className="space-y-1.5 pl-4">
                  {ragChunks.map((chunk, index) => {
                    const config = SOURCE_TYPE_CONFIG[chunk.sourceType] || SOURCE_TYPE_CONFIG['setting']
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
