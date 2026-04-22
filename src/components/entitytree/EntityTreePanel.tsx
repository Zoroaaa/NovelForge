import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { EntityTreeResponse } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ChevronRight,
  ChevronDown,
  BookOpen,
  Library,
  FileText,
  Users,
  Layers,
  RefreshCw,
  Loader2,
  TreePine,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface EntityTreePanelProps {
  novelId: string
  onChapterSelect?: (chapterId: string) => void
}

type EntityType = 'novel' | 'volume' | 'chapter' | 'character' | 'setting'

const ENTITY_CONFIG: Record<EntityType, {
  icon: React.ElementType
  label: string
  color: string
  bgColor: string
}> = {
  novel:     { icon: BookOpen,   label: '小说',     color: 'text-purple-600',   bgColor: 'bg-purple-50 dark:bg-purple-950' },
  volume:    { icon: Library,    label: '卷',        color: 'text-blue-600',    bgColor: 'bg-blue-50 dark:bg-blue-950' },
  chapter:   { icon: FileText,   label: '章节',      color: 'text-green-600',   bgColor: 'bg-green-50 dark:bg-green-950' },
  character: { icon: Users,      label: '角色',      color: 'text-orange-600',  bgColor: 'bg-orange-50 dark:bg-orange-950' },
  setting:   { icon: Layers,     label: '设定',      color: 'text-cyan-600',    bgColor: 'bg-cyan-50 dark:bg-cyan-950' },
}

interface TreeNode {
  id: string
  type: string
  entityId: string
  title: string
  depth: number
  meta: Record<string, unknown> | null
  children: TreeNode[]
}

function TreeNodeItem({
  node,
  expandedIds,
  onToggle,
  onChapterSelect,
  depth = 0,
}: {
  node: TreeNode
  expandedIds: Set<string>
  onToggle: (id: string) => void
  onChapterSelect?: (chapterId: string) => void
  depth?: number
}) {
  const hasChildren = node.children && node.children.length > 0
  const isExpanded = expandedIds.has(node.id)
  const config = ENTITY_CONFIG[node.type as EntityType] || ENTITY_CONFIG.setting
  const Icon = config.icon

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1.5 py-1.5 px-2 rounded-md cursor-pointer group hover:bg-muted/60 transition-colors',
          depth > 0 && 'ml-4'
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => hasChildren && onToggle(node.id)}
        onDoubleClick={() => {
          if (node.type === 'chapter' && onChapterSelect) {
            onChapterSelect(node.entityId)
          }
        }}
      >
        {/* 展开/折叠箭头 */}
        <span className={cn('w-4 h-4 flex items-center justify-center shrink-0', !hasChildren && 'invisible')}>
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </span>

        {/* 类型图标 */}
        <span className={cn('w-6 h-6 rounded flex items-center justify-center shrink-0', config.bgColor)}>
          <Icon className={cn('h-3.5 w-3.5', config.color)} />
        </span>

        {/* 标题 */}
        <span className="text-sm truncate flex-1 min-w-0">{node.title}</span>

        {/* 元数据徽标 */}
        {node.meta && (
          <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            {node.meta.wordCount !== undefined && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-normal">
                {(node.meta.wordCount as number).toLocaleString()}字
              </Badge>
            )}
            {node.type === 'chapter' && !!node.meta.hasContent && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-normal text-green-600 border-green-300">
                有内容
              </Badge>
            )}
            {node.type === 'character' && String(node.meta.role ?? '') && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-normal">
                {String(node.meta.role)}
              </Badge>
            )}
            {node.type === 'setting' && String(node.meta.type ?? '') && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-normal">
                {String(node.meta.type)}
              </Badge>
            )}
          </div>
        )}

        {/* 子节点数量 */}
        {hasChildren && (
          <span className="text-[10px] text-muted-foreground/60 shrink-0">
            {node.children.length}
          </span>
        )}
      </div>

      {/* 子节点 */}
      {hasChildren && isExpanded && (
        <div>
          {node.children.map((child) => (
            <TreeNodeItem
              key={child.id}
              node={child}
              expandedIds={expandedIds}
              onToggle={onToggle}
              onChapterSelect={onChapterSelect}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function EntityTreePanel({ novelId, onChapterSelect }: EntityTreePanelProps) {
  const queryClient = useQueryClient()
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const { data: treeData, isLoading, error } = useQuery({
    queryKey: ['entity-tree', novelId],
    queryFn: async () => {
      const res = await api.entities.tree(novelId)
      return res as unknown as EntityTreeResponse
    },
  })

  const rebuildMutation = useMutation({
    mutationFn: () => api.entities.rebuild({ novelId }),
    onSuccess: () => {
      toast.success('实体树重建成功')
      queryClient.invalidateQueries({ queryKey: ['entity-tree', novelId] })
    },
    onError: (e: Error) => toast.error(`重建失败：${e.message}`),
  })

  const toggleNode = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const expandAll = () => {
    if (!treeData?.tree) return
    const collectIds = (nodes: TreeNode[]): string[] => {
      return nodes.flatMap((n) => [n.id, ...collectIds(n.children)])
    }
    setExpandedIds(new Set(collectIds(treeData.tree as unknown as TreeNode[])))
  }

  const collapseAll = () => {
    setExpandedIds(new Set())
  }

  if (isLoading) {
    return (
      <div className="p-4 space-y-3">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-8 w-1/2" />
      </div>
    )
  }

  if (error || !treeData) {
    return (
      <div className="p-4 text-center space-y-3">
        <TreePine className="h-10 w-10 mx-auto text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">加载失败或暂无数据</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => queryClient.invalidateQueries({ queryKey: ['entity-tree', novelId] })}
        >
          重试
        </Button>
      </div>
    )
  }

  const stats = treeData.stats ?? {}
  const totalNodes = treeData.totalNodes ?? 0

  return (
    <div className="flex flex-col h-full">
      {/* 工具栏 */}
      <div className="px-4 py-3 border-b bg-background/80 shrink-0 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-wide text-foreground">实体树</h2>
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={expandAll}
            >
              全部展开
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={collapseAll}
            >
              全部收起
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => rebuildMutation.mutate()}
              disabled={rebuildMutation.isPending}
            >
              {rebuildMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              重建索引
            </Button>
          </div>
        </div>

        {/* 统计信息 */}
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary" className="text-xs font-normal">
            共 {totalNodes} 个节点
          </Badge>
          {Object.entries(stats).map(([type, count]) => {
            const cfg = ENTITY_CONFIG[type as EntityType]
            return cfg ? (
              <Badge key={type} variant="outline" className={cn('text-xs font-normal gap-1', cfg.color)}>
                <cfg.icon className="h-3 w-3" />
                {cfg.label} {count}
              </Badge>
            ) : null
          })}
        </div>
      </div>

      {/* 树形内容区 */}
      <div className="flex-1 overflow-y-auto py-2">
        {!treeData.tree || treeData.tree.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground space-y-2">
            <TreePine className="h-10 w-10 mx-auto text-muted-foreground/30" />
            <p>暂无实体数据</p>
            <p className="text-xs">点击「重建索引」构建实体树</p>
          </div>
        ) : (
          <div className="px-1">
            {(treeData.tree as unknown as TreeNode[]).map((node) => (
              <TreeNodeItem
                key={node.id}
                node={node}
                expandedIds={expandedIds}
                onToggle={toggleNode}
                onChapterSelect={onChapterSelect}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
