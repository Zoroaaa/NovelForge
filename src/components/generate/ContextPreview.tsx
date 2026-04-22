/**
 * @file ContextPreview.tsx
 * @description 上下文预览组件 v3 - 展示AI生成时使用的分槽RAG上下文信息和Token统计
 * @version 3.0.0
 * @modified 2026-04-22 - 适配v3分槽架构
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
  Map,
  Sword,
  Gem,
  Users,
  Sparkles,
} from 'lucide-react'

export interface ContextDebugInfo {
  totalTokenEstimate: number
  slotBreakdown: Record<string, number>
  ragQueriesCount: number
  ragHitsCount: number
  summaryChainLength: number
  buildTimeMs: number
  budgetTier: {
    core: number
    summaryChain: number
    characters: number
    foreshadowing: number
    settings: number
    rules: number
    total: number
  }
  chapterTypeHint: string
}

export interface SlottedSettings {
  worldRules: string[]
  powerSystem: string[]
  geography: string[]
  factions: string[]
  artifacts: string[]
  misc: string[]
}

export interface ContextBundle {
  core: {
    masterOutlineSummary: string
    volumeBlueprint: string
    volumeEventLine: string
    prevChapterSummary: string
    protagonistStateCards: string[]
    highPriorityRules: string[]
  }
  dynamic: {
    summaryChain: string[]
    characterCards: string[]
    relevantForeshadowing: string[]
    relevantSettings: SlottedSettings
    chapterTypeRules: string[]
  }
  debug: ContextDebugInfo
}

export interface ToolCallEvent {
  name: string
  args: Record<string, any>
  result: string
  status?: 'running' | 'done'
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

const SETTING_SLOT_CONFIG = {
  worldRules: { icon: Sparkles, label: '世界法则', color: 'bg-blue-100 text-blue-800' },
  powerSystem: { icon: Sword, label: '境界体系', color: 'bg-red-100 text-red-800' },
  geography: { icon: Map, label: '场景地理', color: 'bg-green-100 text-green-800' },
  factions: { icon: Users, label: '相关势力', color: 'bg-purple-100 text-purple-800' },
  artifacts: { icon: Gem, label: '相关法宝', color: 'bg-yellow-100 text-yellow-800' },
  misc: { icon: FileText, label: '其他设定', color: 'bg-gray-100 text-gray-800' },
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
          <Badge variant="secondary" className="text-xs">
            v3 分槽
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground pl-6">
          Agent 正在分槽检索相关资料、组装精准上下文
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

  const { core, dynamic, debug } = contextBundle

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="space-y-2 p-3 bg-muted/30 rounded-lg border">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="w-full justify-between p-0 h-auto hover:bg-transparent">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">AI 上下文预览</span>
              <Badge variant="secondary" className="text-xs">
                v3 分槽
              </Badge>
            </div>

            <div className="flex items-center gap-3">
              {/* 统计信息 */}
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1" title={`总Token预算: ${debug.budgetTier.total}`}>
                  <Hash className="h-3 w-3" />
                  ~{debug.totalTokenEstimate} tokens
                </span>
                {debug.ragQueriesCount > 0 && (
                  <Badge variant="outline" className="text-xs">
                    {debug.ragQueriesCount} RAG查询
                  </Badge>
                )}
                {debug.chapterTypeHint && debug.chapterTypeHint !== '常规叙述' && (
                  <Badge variant="outline" className="text-[10px]">
                    {debug.chapterTypeHint}
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

            {/* v3: Core层 - 固定注入 */}
            {(core.masterOutlineSummary || core.volumeBlueprint || core.volumeEventLine || core.prevChapterSummary) && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <FileText className="h-3 w-3" />
                  核心上下文（固定注入）
                  {debug.slotBreakdown && (
                    <Badge variant="outline" className="text-[10px]">
                      {(debug.slotBreakdown.masterOutlineSummary || 0) +
                       (debug.slotBreakdown.volumeBlueprint || 0) +
                       (debug.slotBreakdown.volumeEventLine || 0) +
                       (debug.slotBreakdown.prevChapterSummary || 0)}t
                    </Badge>
                  )}
                </h4>

                <div className="space-y-1.5 pl-4">
                  {core.masterOutlineSummary && (
                    <ContextItem
                      label="总纲摘要"
                      content={core.masterOutlineSummary}
                      type="master_outline"
                    />
                  )}
                  {core.volumeBlueprint && (
                    <ContextItem
                      label="卷蓝图"
                      content={core.volumeBlueprint}
                      type="volume_blueprint"
                    />
                  )}
                  {core.volumeEventLine && (
                    <ContextItem
                      label="卷事件线"
                      content={core.volumeEventLine}
                      type="event_line"
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

            {/* 主角状态卡 */}
            {core.protagonistStateCards.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <User className="h-3 w-3" />
                  主角状态卡
                  {debug.slotBreakdown?.protagonistCards && (
                    <Badge variant="outline" className="text-[10px]">
                      {debug.slotBreakdown.protagonistCards}t
                    </Badge>
                  )}
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

            {/* 核心创作规则 */}
            {core.highPriorityRules.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  核心创作准则（必须遵守）
                  {debug.slotBreakdown?.topRules && (
                    <Badge variant="outline" className="text-[10px]">
                      {debug.slotBreakdown.topRules}t
                    </Badge>
                  )}
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

            {/* v3: Dynamic层 - 摘要链 */}
            {dynamic.summaryChain.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <BookOpen className="h-3 w-3" />
                  近期剧情摘要
                  {debug.slotBreakdown?.summaryChain && (
                    <Badge variant="outline" className="text-[10px]">
                      {debug.slotBreakdown.summaryChain}t (×{dynamic.summaryChain.length})
                    </Badge>
                  )}
                </h4>
                <div className="rounded border p-2 space-y-1">
                  <ScrollArea className="max-h-20 mt-1">
                    <div className="space-y-0.5">
                      {dynamic.summaryChain.map((summary, idx) => (
                        <p key={idx} className="text-xs text-muted-foreground px-1 py-0.5 hover:bg-muted/30 rounded truncate">
                          {summary.slice(0, 120)}{summary.length > 120 ? '...' : ''}
                        </p>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              </div>
            )}

            {/* v3: Dynamic层 - 出场角色卡（RAG） */}
            {dynamic.characterCards.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <User className="h-3 w-3" />
                  本章出场角色（RAG）
                  {debug.slotBreakdown?.characterCards && (
                    <Badge variant="outline" className="text-[10px]">
                      {debug.slotBreakdown.characterCards}t (×{dynamic.characterCards.length})
                    </Badge>
                  )}
                </h4>
                <ScrollArea className="max-h-28 rounded-md border bg-background/50 p-2">
                  <div className="space-y-1">
                    {dynamic.characterCards.map((card, index) => (
                      <div key={index} className="text-xs p-1.5 bg-purple-50 dark:bg-purple-950 rounded">
                        <pre className="whitespace-pre-wrap font-mono leading-relaxed line-clamp-2">
                          {card.slice(0, 150)}{card.length > 150 ? '...' : ''}
                        </pre>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* v3: Dynamic层 - 相关伏笔（RAG过滤） */}
            {dynamic.relevantForeshadowing.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  待回收伏笔（相关）
                  {debug.slotBreakdown?.foreshadowing && (
                    <Badge variant="outline" className="text-[10px]">
                      {debug.slotBreakdown.foreshadowing}t (×{dynamic.relevantForeshadowing.length})
                    </Badge>
                  )}
                </h4>
                <div className="rounded border p-2 space-y-1">
                  <ScrollArea className="max-h-20 mt-1">
                    <div className="space-y-0.5">
                      {dynamic.relevantForeshadowing.map((fs, idx) => (
                        <p key={idx} className="text-xs text-orange-600 dark:text-orange-400 px-1 py-0.5 truncate">
                          {fs.slice(0, 100)}{fs.length > 100 ? '...' : ''}
                        </p>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              </div>
            )}

            {/* v3: Dynamic层 - 分槽设定 */}
            {(dynamic.relevantSettings.worldRules.length > 0 ||
              dynamic.relevantSettings.powerSystem.length > 0 ||
              dynamic.relevantSettings.geography.length > 0 ||
              dynamic.relevantSettings.factions.length > 0 ||
              dynamic.relevantSettings.artifacts.length > 0 ||
              dynamic.relevantSettings.misc.length > 0) && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <Brain className="h-3 w-3" />
                  世界设定（分槽）
                  {debug.slotBreakdown?.settings && (
                    <Badge variant="outline" className="text-[10px]">
                      {debug.slotBreakdown.settings}t
                    </Badge>
                  )}
                </h4>

                <div className="space-y-1.5 pl-4">
                  {Object.entries(dynamic.relevantSettings).map(([slotKey, items]) => {
                    if (items.length === 0) return null
                    const config = SETTING_SLOT_CONFIG[slotKey as keyof typeof SETTING_SLOT_CONFIG]
                    if (!config) return null
                    const Icon = config.icon

                    return (
                      <div key={slotKey} className="rounded border p-2 space-y-1">
                        <div className="flex items-center gap-1.5">
                          <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${config.color}`}>
                            {config.label} (×{items.length})
                          </Badge>
                        </div>
                        <ScrollArea className="max-h-16 mt-1">
                          <div className="space-y-0.5 pl-5">
                            {items.map((item: string, idx: number) => (
                              <p key={idx} className="text-xs text-muted-foreground truncate py-0.5">
                                {item.slice(0, 80)}{item.length > 80 ? '...' : ''}
                              </p>
                            ))}
                          </div>
                        </ScrollArea>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* v3: Dynamic层 - 章节类型规则 */}
            {dynamic.chapterTypeRules.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <Wrench className="h-3 w-3" />
                  本章创作指引
                  {debug.slotBreakdown?.chapterTypeRules && (
                    <Badge variant="outline" className="text-[10px]">
                      {debug.slotBreakdown.chapterTypeRules}t
                    </Badge>
                  )}
                </h4>
                <ScrollArea className="max-h-24 rounded-md border bg-background/50 p-2">
                  <div className="space-y-1">
                    {dynamic.chapterTypeRules.map((rule, index) => (
                      <div key={index} className="text-xs p-1.5 bg-blue-50 dark:bg-blue-950 rounded">
                        <pre className="whitespace-pre-wrap font-mono leading-relaxed line-clamp-2">
                          {rule.slice(0, 150)}{rule.length > 150 ? '...' : ''}
                        </pre>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* Token分配明细 */}
            {debug.slotBreakdown && Object.keys(debug.slotBreakdown).length > 0 && (
              <div className="rounded-md border p-3 space-y-2 bg-gradient-to-r from-slate-50 to-gray-50 dark:from-slate-950 dark:to-gray-950">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <Hash className="h-3 w-3" />
                  Token 分配明细（分槽）
                </h4>
                <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                  {Object.entries(debug.slotBreakdown).map(([key, value]) => (
                    <div key={key} className="flex justify-between items-center px-2 py-1 rounded bg-background/50">
                      <span className="text-muted-foreground truncate">{key}</span>
                      <span className="font-mono font-medium">{value}t</span>
                    </div>
                  ))}
                </div>
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

  const TYPE_CONFIG: Record<string, { label: string; color: string }> = {
    master_outline: { label: '总纲', color: 'bg-blue-100 text-blue-800' },
    volume_blueprint: { label: '蓝图', color: 'bg-indigo-100 text-indigo-800' },
    event_line: { label: '事件线', color: 'bg-violet-100 text-violet-800' },
    chapter_summary: { label: '摘要', color: 'bg-green-100 text-green-800' },
  }

  const config = TYPE_CONFIG[type] || TYPE_CONFIG['master_outline']

  return (
    <div className="rounded border p-2 space-y-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full text-left"
      >
        <span className="text-xs font-medium flex items-center gap-1.5">
          <Badge variant="outline" className={`text-[10px] ${config.color}`}>
            {config.label}
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
