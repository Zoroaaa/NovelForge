/**
 * @file GraphPage.tsx
 * @description 情节图谱页面 - 支持小说图谱、卷图谱、章节图谱、角色关系图谱
 * @version 1.0.0
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Graph } from '@antv/g6'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Network,
  BookOpen,
  Library,
  FileText,
  Users,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Loader2,
  Sparkles,
  Download,
  ArrowLeft,
} from 'lucide-react'
import type { GraphData, PlotNode, Volume, Chapter } from '@/lib/types'

type GraphMode = 'novel' | 'characters'

const NODE_STYLE_MAP: Record<string, { color: string; borderColor: string; icon: string; label: string }> = {
  event: { color: '#EEF2FF', borderColor: '#6366F1', icon: '⚡', label: '事件' },
  character: { color: '#FDF2F8', borderColor: '#EC4899', icon: '👤', label: '角色' },
  location: { color: '#ECFDF5', borderColor: '#10B981', icon: '📍', label: '地点' },
  item: { color: '#FFFBEB', borderColor: '#F59E0B', icon: '💎', label: '物品' },
  foreshadowing: { color: '#FEF2F2', borderColor: '#EF4444', icon: '🔮', label: '伏笔' },
}

const EDGE_STYLE_MAP: Record<string, { color: string; label: string; dash?: number[] }> = {
  caused_by: { color: '#6366F1', label: '导致', dash: undefined },
  participated_in: { color: '#EC4899', label: '参与', dash: [4, 4] },
  occurred_at: { color: '#10B981', label: '发生于', dash: [2, 2] },
  owned_by: { color: '#F59E0B', label: '属于', dash: [6, 3] },
  related_to: { color: '#8B5CF6', label: '关联', dash: [4, 4] },
  leads_to: { color: '#3B82F6', label: '引出', dash: undefined },
}

export default function GraphPage() {
  const { id: novelId } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [graphMode, setGraphMode] = useState<GraphMode>('novel')
  const [selectedVolumeId, setSelectedVolumeId] = useState<string>('all')
  const [selectedChapterId, setSelectedChapterId] = useState<string>('all')
  const [selectedNode, setSelectedNode] = useState<PlotNode | null>(null)
  const [filterTypes, setFilterTypes] = useState<Set<string>>(new Set())

  const containerRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<Graph | null>(null)

  const { data: novelData } = useQuery({
    queryKey: ['novel', novelId],
    queryFn: () => api.novels.get(novelId!),
    enabled: !!novelId,
  })

  const { data: volumesData } = useQuery({
    queryKey: ['volumes', novelId],
    queryFn: () => api.volumes.list(novelId!),
    enabled: !!novelId,
  })

  const { data: chaptersData } = useQuery({
    queryKey: ['chapters', novelId],
    queryFn: () => api.chapters.list(novelId!),
    enabled: !!novelId,
  })

  const volumes = (volumesData as Volume[] | undefined) || []
  const chapters = (chaptersData as Chapter[] | undefined) || []

  const graphQueryKey = graphMode === 'characters'
    ? ['graph', 'characters', novelId]
    : selectedChapterId !== 'all'
      ? ['graph', 'chapter', selectedChapterId]
      : selectedVolumeId !== 'all'
        ? ['graph', 'volume', selectedVolumeId]
        : ['graph', 'novel', novelId]

  const graphQueryFn = graphMode === 'characters'
    ? () => api.graph.characters(novelId!)
    : selectedChapterId !== 'all'
      ? () => api.graph.chapter(selectedChapterId)
      : selectedVolumeId !== 'all'
        ? () => api.graph.volume(selectedVolumeId)
        : () => api.graph.novel(novelId!)

  const { data: graphData, isLoading: graphLoading, refetch: refetchGraph } = useQuery({
    queryKey: graphQueryKey,
    queryFn: graphQueryFn,
    enabled: !!novelId,
  })

  const extractMutation = useMutation({
    mutationFn: () => api.graph.extractNovel(novelId!),
    onSuccess: (data) => {
      toast.success(data.message || '图谱提取任务已提交')
      setTimeout(() => refetchGraph(), 5000)
    },
    onError: (error) => toast.error(error.message),
  })

  const buildG6Data = useCallback((data: GraphData) => {
    const filteredNodes = filterTypes.size > 0
      ? data.nodes.filter(n => filterTypes.has(n.type))
      : data.nodes

    const nodeIds = new Set(filteredNodes.map(n => n.id))

    const filteredEdges = data.edges.filter(
      e => nodeIds.has(e.fromId) && nodeIds.has(e.toId)
    )

    const nodes = filteredNodes.map(node => {
      const style = NODE_STYLE_MAP[node.type] || NODE_STYLE_MAP.event
      return {
        id: node.id,
        data: {
          type: node.type,
          title: node.title,
          description: node.description,
          chapterId: node.chapterId,
        },
        style: {
          size: node.type === 'character' ? 48 : node.type === 'event' ? 42 : 36,
          fill: style.color,
          stroke: style.borderColor,
          lineWidth: 2,
          labelText: node.title,
          labelFontSize: 11,
          labelFill: '#374151',
          labelFontWeight: 500,
          labelOffsetY: 28,
          labelBackground: true,
          labelBackgroundFill: '#ffffff',
          labelBackgroundOpacity: 0.85,
          labelBackgroundRadius: 4,
          labelBackgroundPadding: [2, 4, 2, 4],
          iconText: style.icon,
          iconFontSize: 16,
          iconFill: style.borderColor,
        },
      }
    })

    const edges = filteredEdges.map(edge => {
      const style = EDGE_STYLE_MAP[edge.relation] || EDGE_STYLE_MAP.related_to
      return {
        id: edge.id,
        source: edge.fromId,
        target: edge.toId,
        data: { relation: edge.relation },
        style: {
          stroke: style.color,
          lineWidth: 1.5,
          lineDash: style.dash,
          endArrow: true,
          endArrowSize: 6,
          endArrowFill: style.color,
          labelText: style.label,
          labelFontSize: 9,
          labelFill: '#6B7280',
          labelBackground: true,
          labelBackgroundFill: '#ffffff',
          labelBackgroundOpacity: 0.8,
          labelBackgroundRadius: 3,
          labelBackgroundPadding: [1, 3, 1, 3],
        },
      }
    })

    return { nodes, edges }
  }, [filterTypes])

  useEffect(() => {
    if (!containerRef.current || !graphData?.graph) return

    if (graphRef.current) {
      graphRef.current.destroy()
      graphRef.current = null
    }

    const container = containerRef.current
    const width = container.offsetWidth
    const height = container.offsetHeight

    const g6Data = buildG6Data(graphData.graph)

    if (g6Data.nodes.length === 0) return

    const graph = new Graph({
      container,
      width,
      height,
      autoFit: 'view',
      padding: [40, 40, 40, 40],
      node: {
        type: 'circle',
        style: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          size: (d: any) => d.style?.size || 36,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          fill: (d: any) => d.style?.fill || '#EEF2FF',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          stroke: (d: any) => d.style?.stroke || '#6366F1',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          lineWidth: (d: any) => d.style?.lineWidth || 2,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          labelText: (d: any) => d.style?.labelText || '',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          labelFontSize: (d: any) => d.style?.labelFontSize || 11,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          labelFill: (d: any) => d.style?.labelFill || '#374151',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          labelFontWeight: (d: any) => d.style?.labelFontWeight || 500,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          labelOffsetY: (d: any) => d.style?.labelOffsetY || 28,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          labelBackground: (d: any) => d.style?.labelBackground ?? true,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          labelBackgroundFill: (d: any) => d.style?.labelBackgroundFill || '#fff',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          labelBackgroundOpacity: (d: any) => d.style?.labelBackgroundOpacity ?? 0.85,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          labelBackgroundRadius: (d: any) => d.style?.labelBackgroundRadius || 4,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          labelBackgroundPadding: (d: any) => d.style?.labelBackgroundPadding || [2, 4, 2, 4],
        },
        state: {
          hover: {
            lineWidth: 3,
            shadowColor: '#6366F1',
            shadowBlur: 12,
          },
          selected: {
            lineWidth: 3,
            stroke: '#4F46E5',
            shadowColor: '#4F46E5',
            shadowBlur: 16,
          },
        },
      },
      edge: {
        type: 'line',
        style: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          stroke: (d: any) => d.style?.stroke || '#94A3B8',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          lineWidth: (d: any) => d.style?.lineWidth || 1.5,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          lineDash: (d: any) => d.style?.lineDash || undefined,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          endArrow: (d: any) => d.style?.endArrow ?? true,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          endArrowSize: (d: any) => d.style?.endArrowSize || 6,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          endArrowFill: (d: any) => d.style?.endArrowFill || '#94A3B8',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          labelText: (d: any) => d.style?.labelText || '',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          labelFontSize: (d: any) => d.style?.labelFontSize || 9,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          labelFill: (d: any) => d.style?.labelFill || '#6B7280',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          labelBackground: (d: any) => d.style?.labelBackground ?? true,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          labelBackgroundFill: (d: any) => d.style?.labelBackgroundFill || '#fff',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          labelBackgroundOpacity: (d: any) => d.style?.labelBackgroundOpacity ?? 0.8,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          labelBackgroundRadius: (d: any) => d.style?.labelBackgroundRadius || 3,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          labelBackgroundPadding: (d: any) => d.style?.labelBackgroundPadding || [1, 3, 1, 3],
        },
      },
      layout: {
        type: 'fruchterman',
        gravity: 1,
        speed: 5,
        clustering: false,
        maxIteration: 1000,
        workerEnabled: false,
      },
      behaviors: ['drag-canvas', 'zoom-canvas', 'drag-element', 'click-select'],
      plugins: [
        {
          type: 'tooltip',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          getContent: (e: any) => {
            const data = e.target?.data?.data
            if (!data) return ''
            const style = NODE_STYLE_MAP[data.type] || NODE_STYLE_MAP.event
            return `<div style="padding:8px 12px;font-size:12px;max-width:240px;">
              <div style="font-weight:600;margin-bottom:4px;">${style.icon} ${data.title}</div>
              <div style="color:#6B7280;">类型：${style.label}</div>
              ${data.description ? `<div style="color:#6B7280;margin-top:4px;">${data.description}</div>` : ''}
            </div>`
          },
        },
      ],
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    graph.on('node:click', (evt: any) => {
      const nodeId = evt.target?.id
      if (nodeId && graphData.graph) {
        const node = graphData.graph.nodes.find(n => n.id === nodeId)
        setSelectedNode(node || null)
      }
    })

    graph.on('canvas:click', () => {
      setSelectedNode(null)
    })

    graph.setData(g6Data)
    graph.render()

    graph.on('afterrender', () => {
      if (!graphRef.current) return
      graphRef.current.fitView({ padding: [60, 60, 60, 60] })
    })

    graphRef.current = graph

    let resizeTimer: ReturnType<typeof setTimeout>
    const resizeObserver = new ResizeObserver(() => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        if (graphRef.current && container) {
          graphRef.current.resize(container.offsetWidth, container.offsetHeight)
        }
      }, 150)
    })
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      clearTimeout(resizeTimer)
      if (graphRef.current) {
        graphRef.current.destroy()
        graphRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphData])

  // Effect 2: filterTypes 变化时只更新数据，不重建 graph（避免重新触发物理仿真）
  useEffect(() => {
    if (!graphRef.current || !graphData?.graph) return
    const g6Data = buildG6Data(graphData.graph)
    graphRef.current.setData(g6Data)
    graphRef.current.render()
  }, [filterTypes, graphData, buildG6Data])

  const handleZoomIn = () => {
    if (graphRef.current) {
      const zoom = graphRef.current.getZoom()
      graphRef.current.zoomTo(zoom * 1.2)
    }
  }

  const handleZoomOut = () => {
    if (graphRef.current) {
      const zoom = graphRef.current.getZoom()
      graphRef.current.zoomTo(zoom / 1.2)
    }
  }

  const handleFitView = () => {
    graphRef.current?.fitView()
  }

  const handleExport = () => {
    if (!graphRef.current) return
    const canvas = containerRef.current?.querySelector('canvas')
    if (!canvas) return
    const url = canvas.toDataURL('image/png')
    const a = document.createElement('a')
    a.href = url
    a.download = `graph-${novelData?.title || 'novel'}.png`
    a.click()
  }

  const toggleFilterType = (type: string) => {
    setFilterTypes(prev => {
      const next = new Set(prev)
      if (next.has(type)) {
        next.delete(type)
      } else {
        next.add(type)
      }
      return next
    })
  }

  const filteredVolumes = volumes.filter(v => !v.deletedAt)
  const filteredChapters = chapters.filter(c => !c.deletedAt)
  const currentGraphData = graphData?.graph
  const nodeCount = currentGraphData?.nodes.length || 0
  const edgeCount = currentGraphData?.edges.length || 0

  const headerActions = (
    <div className="flex items-center gap-2">
      <Link to={`/novels/${novelId}`}>
        <Button variant="ghost" size="sm" className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> 返回工作台
        </Button>
      </Link>
      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-1.5"
        onClick={() => extractMutation.mutate()}
        disabled={extractMutation.isPending}
      >
        {extractMutation.isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Sparkles className="h-3.5 w-3.5" />
        )}
        <span className="hidden sm:inline text-xs">提取图谱</span>
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-1.5"
        onClick={() => refetchGraph()}
      >
        <RefreshCw className="h-3.5 w-3.5" />
        <span className="hidden sm:inline text-xs">刷新</span>
      </Button>
    </div>
  )

  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="h-14 border-b bg-card/50 backdrop-blur-sm flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">情节图谱</h1>
          <p className="text-sm text-muted-foreground">{novelData?.title || '加载中...'}</p>
        </div>
        {headerActions}
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* 左侧控制面板 */}
        <div className="w-72 shrink-0 border-r border-border/50 bg-background overflow-y-auto">
          <div className="p-4 space-y-5">
            {/* 图谱类型选择 */}
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                图谱类型
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => { setGraphMode('novel'); setSelectedChapterId('all') }}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all ${
                    graphMode === 'novel'
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-border hover:border-primary/50 text-muted-foreground'
                  }`}
                >
                  <Network className="h-5 w-5" />
                  <span className="text-xs font-medium">情节图谱</span>
                </button>
                <button
                  onClick={() => { setGraphMode('characters'); setSelectedChapterId('all') }}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all ${
                    graphMode === 'characters'
                      ? 'border-pink-500 bg-pink-50 dark:bg-pink-950/20 text-pink-600'
                      : 'border-border hover:border-pink-500/50 text-muted-foreground'
                  }`}
                >
                  <Users className="h-5 w-5" />
                  <span className="text-xs font-medium">角色关系</span>
                </button>
              </div>
            </div>

            {/* 范围筛选 */}
            {graphMode === 'novel' && (
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  范围筛选
                </h3>
                <div className="space-y-2">
                  <Select value={selectedVolumeId} onValueChange={(v) => { setSelectedVolumeId(v); setSelectedChapterId('all') }}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="选择卷" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部卷</SelectItem>
                      {filteredVolumes.map(vol => (
                        <SelectItem key={vol.id} value={vol.id}>{vol.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={selectedChapterId} onValueChange={setSelectedChapterId}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="选择章节" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部章节</SelectItem>
                      {filteredChapters
                        .filter(ch => selectedVolumeId === 'all' || ch.volumeId === selectedVolumeId)
                        .map(ch => (
                          <SelectItem key={ch.id} value={ch.id}>{ch.title}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* 节点类型筛选 */}
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                节点类型
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(NODE_STYLE_MAP).map(([type, style]) => (
                  <button
                    key={type}
                    onClick={() => toggleFilterType(type)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all border ${
                      filterTypes.has(type)
                        ? `border-transparent`
                        : 'border-border opacity-50 hover:opacity-80'
                    }`}
                    style={{
                      backgroundColor: filterTypes.has(type) ? style.color : 'transparent',
                      color: style.borderColor,
                      borderColor: filterTypes.has(type) ? style.borderColor : undefined,
                    }}
                  >
                    <span>{style.icon}</span>
                    <span>{style.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 统计信息 */}
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                统计
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-muted/50 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-foreground">{nodeCount}</div>
                  <div className="text-xs text-muted-foreground">节点</div>
                </div>
                <div className="bg-muted/50 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-foreground">{edgeCount}</div>
                  <div className="text-xs text-muted-foreground">关系</div>
                </div>
              </div>
            </div>

            {/* 选中节点详情 */}
            {selectedNode && (
              <Card className="border-primary/30">
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{NODE_STYLE_MAP[selectedNode.type]?.icon}</span>
                    <div>
                      <div className="font-semibold text-sm">{selectedNode.title}</div>
                      <Badge variant="secondary" className="text-[10px] mt-0.5">
                        {NODE_STYLE_MAP[selectedNode.type]?.label}
                      </Badge>
                    </div>
                  </div>
                  {selectedNode.description && (
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {selectedNode.description}
                    </p>
                  )}
                  {selectedNode.chapterId && (
                    <button
                      onClick={() => navigate(`/novels/${novelId}?chapter=${selectedNode.chapterId}`)}
                      className="text-xs text-primary hover:underline"
                    >
                      查看关联章节 →
                    </button>
                  )}
                </CardContent>
              </Card>
            )}

            {/* 图例 */}
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                关系图例
              </h3>
              <div className="space-y-1.5">
                {Object.entries(EDGE_STYLE_MAP).map(([rel, style]) => (
                  <div key={rel} className="flex items-center gap-2 text-xs">
                    <div
                      className="w-6 h-0.5 shrink-0"
                      style={{
                        backgroundColor: style.color,
                        borderTop: style.dash ? `2px dashed ${style.color}` : undefined,
                        height: style.dash ? 0 : 2,
                      }}
                    />
                    <span className="text-muted-foreground">{style.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 图谱画布区域 */}
        <div className="flex-1 relative bg-gradient-to-br from-slate-50 to-gray-100 dark:from-gray-900 dark:to-gray-950">
          {graphLoading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">加载图谱数据...</p>
              </div>
            </div>
          ) : nodeCount === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex flex-col items-center gap-4 text-center max-w-md">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-100 to-purple-100 dark:from-indigo-950/30 dark:to-purple-950/30 flex items-center justify-center">
                  <Network className="h-10 w-10 text-indigo-500" />
                </div>
                <h3 className="text-lg font-semibold">暂无图谱数据</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  点击"提取图谱"按钮，AI 将自动从章节内容中提取情节节点和关系，构建可视化图谱。
                </p>
                <Button
                  onClick={() => extractMutation.mutate()}
                  disabled={extractMutation.isPending}
                  className="gap-2"
                >
                  {extractMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  提取图谱
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div ref={containerRef} className="w-full h-full" />

              {/* 工具栏 */}
              <div className="absolute top-4 right-4 flex flex-col gap-1.5">
                <Button variant="secondary" size="icon" className="h-8 w-8 shadow-md" onClick={handleZoomIn}>
                  <ZoomIn className="h-4 w-4" />
                </Button>
                <Button variant="secondary" size="icon" className="h-8 w-8 shadow-md" onClick={handleZoomOut}>
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <Button variant="secondary" size="icon" className="h-8 w-8 shadow-md" onClick={handleFitView}>
                  <Maximize2 className="h-4 w-4" />
                </Button>
                <div className="h-px bg-border my-0.5" />
                <Button variant="secondary" size="icon" className="h-8 w-8 shadow-md" onClick={handleExport}>
                  <Download className="h-4 w-4" />
                </Button>
              </div>

              {/* 当前视图标签 */}
              <div className="absolute top-4 left-4">
                <Badge variant="secondary" className="gap-1.5 shadow-md bg-background/80 backdrop-blur-sm">
                  {graphMode === 'characters' ? (
                    <><Users className="h-3 w-3" /> 角色关系图谱</>
                  ) : selectedChapterId !== 'all' ? (
                    <><FileText className="h-3 w-3" /> 章节图谱</>
                  ) : selectedVolumeId !== 'all' ? (
                    <><Library className="h-3 w-3" /> 卷图谱</>
                  ) : (
                    <><BookOpen className="h-3 w-3" /> 小说图谱</>
                  )}
                </Badge>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
