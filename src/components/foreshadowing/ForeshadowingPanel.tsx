/**
 * @file ForeshadowingPanel.tsx
 * @description 伏笔管理面板组件，提供伏笔的创建、编辑、状态管理、推进追踪、健康检查和统计分析
 * @version 3.1.0 - UI 重构：对齐系统面板设计规范
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { ForeshadowingItem, Chapter, ForeshadowingHealthReport, ForeshadowingStats } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Plus, Trash2, Edit2, AlertTriangle, CheckCircle, Ban, FileText, Stethoscope, BarChart3, ChevronDown, ChevronRight, Clock, Lightbulb, Copy, Sparkles, MoreHorizontal } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface ForeshadowingPanelProps {
  novelId: string
  onChapterSelect?: (chapterId: string) => void
}

const STATUS_DOT: Record<string, { label: string; dotClass: string; textClass: string }> = {
  open:       { label: '未收尾', dotClass: 'bg-yellow-400',   textClass: 'text-yellow-600' },
  resolved:   { label: '已收尾', dotClass: 'bg-green-500',     textClass: 'text-green-600' },
  abandoned:  { label: '已放弃', dotClass: 'bg-gray-300',      textClass: 'text-gray-400' },
}

const IMPORTANCE_MAP: Record<string, { label: string; dotClass: string }> = {
  high:   { label: '重要', dotClass: 'bg-red-400' },
  normal: { label: '一般', dotClass: 'bg-gray-400' },
  low:    { label: '次要', dotClass: 'bg-blue-400' },
}

const PROGRESS_CONFIG: Record<string, { label: string; icon: typeof AlertTriangle; color: string; badge: string }> = {
  hint:          { label: '暗示',     icon: AlertTriangle, color: 'text-amber-600', badge: 'bg-amber-100 text-amber-800' },
  advance:       { label: '推进',     icon: ChevronRight,  color: 'text-blue-600',  badge: 'bg-blue-100 text-blue-800' },
  partial_reveal:{ label: '半揭露',   icon: Sparkles,      color: 'text-purple-600',badge: 'bg-purple-100 text-purple-800' },
}

export function ForeshadowingPanel({ novelId, onChapterSelect }: ForeshadowingPanelProps) {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [resolveDialogOpen, setResolveDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [resolvingItem, setResolvingItem] = useState<ForeshadowingItem | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [healthOpen, setHealthOpen] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)
  const [healthReport, setHealthReport] = useState<ForeshadowingHealthReport | null>(null)
  const [statsData, setStatsData] = useState<ForeshadowingStats | null>(null)
  const [healthLoading, setHealthLoading] = useState(false)
  const [staleLoading, setStaleLoading] = useState(false)
  const [staleItems, setStaleItems] = useState<ForeshadowingItem[]>([])

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    importance: 'normal' as 'high' | 'normal' | 'low',
    chapterId: '' as string | null,
  })

  const [resolveChapterId, setResolveChapterId] = useState<string>('')

  const { data: foreshadowingData, isLoading } = useQuery({
    queryKey: ['foreshadowing', novelId],
    queryFn: () => api.foreshadowing.list(novelId),
  })

  const { data: chapters } = useQuery({
    queryKey: ['chapters', novelId],
    queryFn: () => api.chapters.list(novelId),
  })

  const chapterMap = (chapters || []).reduce((acc, ch) => {
    acc[ch.id] = ch
    return acc
  }, {} as Record<string, Chapter>)

  let foreshadowings = foreshadowingData?.foreshadowing || []
  if (statusFilter === 'stale') {
    foreshadowings = staleItems
  } else if (statusFilter !== 'all') {
    foreshadowings = foreshadowings.filter(f => f.status === statusFilter)
  }

  const handleStatusFilterChange = useCallback(async (value: string) => {
    setStatusFilter(value)
    if (value === 'stale') {
      setStaleLoading(true)
      try {
        const result = await api.foreshadowing.getStale(novelId, 10)
        setStaleItems(result.foreshadowing)
      } catch (err) {
        toast.error(`获取沉寂伏笔失败: ${(err as Error).message}`)
      } finally {
        setStaleLoading(false)
      }
    }
  }, [novelId])

  const stats = (foreshadowingData?.foreshadowing || []).reduce((acc, f) => {
    acc[f.status] = (acc[f.status] || 0) + 1
    acc.total++
    return acc
  }, {} as Record<string, number>)

  const createMutation = useMutation({
    mutationFn: (data: typeof formData & { chapterId?: string | null }) =>
      api.foreshadowing.create({ novelId, title: data.title, description: data.description || undefined, importance: data.importance, chapterId: data.chapterId || undefined }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['foreshadowing'] }); toast.success('伏笔创建成功'); resetForm(); setDialogOpen(false) },
    onError: (err) => toast.error(`创建失败: ${(err as Error).message}`),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ForeshadowingItem> }) => api.foreshadowing.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['foreshadowing'] }); toast.success('伏笔更新成功'); setEditingId(null); resetForm(); setResolveDialogOpen(false); setResolvingItem(null) },
    onError: (err) => toast.error(`更新失败: ${(err as Error).message}`),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.foreshadowing.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['foreshadowing'] }); toast.success('伏笔已删除') },
    onError: (err) => toast.error(`删除失败: ${(err as Error).message}`),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.title.trim()) { toast.warning('请填写伏笔标题'); return }
    editingId ? updateMutation.mutate({ id: editingId, data: formData }) : createMutation.mutate(formData)
  }

  const handleEdit = (item: ForeshadowingItem) => {
    setEditingId(item.id)
    setFormData({ title: item.title, description: item.description || '', importance: item.importance, chapterId: item.chapterId || '' })
    setDialogOpen(true)
  }

  const handleResolve = (item: ForeshadowingItem) => { setResolvingItem(item); setResolveChapterId(''); setResolveDialogOpen(true) }
  const handleResolveSubmit = () => { if (!resolvingItem) return; updateMutation.mutate({ id: resolvingItem.id, data: { status: 'resolved', resolvedChapterId: resolveChapterId || null } }) }
  const handleAbandon = (e: React.MouseEvent, id: string) => { e.stopPropagation(); updateMutation.mutate({ id, data: { status: 'abandoned' } }) }
  const handleDelete = (e: React.MouseEvent, id: string) => { e.stopPropagation(); if (confirm('确定要删除这条伏笔吗？')) deleteMutation.mutate(id) }

  const handleHealthCheck = useCallback(async () => {
    setHealthLoading(true)
    try { const report = await api.foreshadowing.check(novelId); setHealthReport(report); setHealthOpen(true) }
    catch (err) { toast.error(`体检失败: ${(err as Error).message}`) }
    finally { setHealthLoading(false) }
  }, [novelId])

  const handleShowStats = useCallback(async () => {
    try { const data = await api.foreshadowing.getStats(novelId); setStatsData(data); setStatsOpen(true) }
    catch (err) { toast.error(`获取统计失败: ${(err as Error).message}`) }
  }, [novelId])

  const resetForm = () => { setFormData({ title: '', description: '', importance: 'normal', chapterId: '' }); setEditingId(null) }

  if (isLoading) return <div className="p-4 space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />)}</div>

  return (
    <div className="flex flex-col h-full">
      {/* 工具栏 */}
      <div className="px-3 py-2.5 border-b space-y-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-muted-foreground tabular-nums font-medium">{stats.total || 0} 条</span>
          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-50 text-yellow-700">
            <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />未收 {stats['open'] || 0}
          </span>
          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-green-50 text-green-700">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />已收 {stats['resolved'] || 0}
          </span>
          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-300" />放弃 {stats['abandoned'] || 0}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <Select value={statusFilter} onValueChange={handleStatusFilterChange}>
              <SelectTrigger className="h-7 text-xs w-[88px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="open">未收尾</SelectItem>
                <SelectItem value="resolved">已收尾</SelectItem>
                <SelectItem value="abandoned">已放弃</SelectItem>
                <SelectItem value="stale">可能遗忘</SelectItem>
              </SelectContent>
            </Select>

            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-[11px] shrink-0" onClick={handleHealthCheck} disabled={healthLoading}>
              <Stethoscope className="h-3 w-3" />
              {healthLoading ? '...' : '体检'}
            </Button>

            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-[11px] shrink-0" onClick={handleShowStats}>
              <BarChart3 className="h-3 w-3" />
              统计
            </Button>
          </div>

          <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm() }}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-8 gap-1.5 text-xs shrink-0">
                <Plus className="h-3.5 w-3.5" />
                新增伏笔
              </Button>
            </DialogTrigger>

            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{editingId ? '编辑伏笔' : '新增伏笔'}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label>伏笔标题 *</Label>
                  <Input placeholder="如：主角身世之谜" value={formData.title} onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))} required autoFocus />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>重要性</Label>
                    <Select value={formData.importance} onValueChange={(v) => setFormData(prev => ({ ...prev, importance: v as any }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{IMPORTANCE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>埋设章节</Label>
                    <Select value={formData.chapterId || 'none'} onValueChange={(v) => setFormData(prev => ({ ...prev, chapterId: v === 'none' ? null : v }))}>
                      <SelectTrigger><SelectValue placeholder="选择章节" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">未指定</SelectItem>
                        {chapters?.map(ch => <SelectItem key={ch.id} value={ch.id}>{ch.title}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>详细描述（可选）</Label>
                  <Textarea placeholder="描述这个伏笔的具体内容、预期收尾方式等..." rows={4} value={formData.description} onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))} />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
                  <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>{createMutation.isPending || updateMutation.isPending ? '保存中...' : (editingId ? '更新' : '创建')}</Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {foreshadowings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <AlertTriangle className="h-10 w-10 mb-3 opacity-20" />
            <p className="text-sm">还没有伏笔记录</p>
            <p className="text-xs mt-1 opacity-60">AI 在生成章节时会自动识别和提取伏笔</p>
          </div>
        ) : (
          foreshadowings.map(item => {
            const st = STATUS_DOT[item.status] || { dotClass: 'bg-gray-400', textClass: 'text-gray-500', label: '未知' }
            const imp = IMPORTANCE_MAP[item.importance]
            const plantChapter = item.chapterId ? chapterMap[item.chapterId] : null
            const resolveChapter = item.resolvedChapterId ? chapterMap[item.resolvedChapterId] : null
            const isExpanded = expandedId === item.id

            return (
              <div key={item.id} className="rounded-lg border overflow-hidden group">
                <div
                  className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50 cursor-pointer transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
                >
                  {/* 展开/折叠 */}
                  <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground/40 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />

                  {/* 状态圆点 */}
                  <span className={`w-2 h-2 rounded-full shrink-0 ${st.dotClass}`} />

                  {/* 主内容区 */}
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-[13px] truncate">{item.title}</span>
                      <span className={`text-[9px] font-medium tabular-nums ${st.textClass}`}>{st.label}</span>
                    </div>

                    {(plantChapter || resolveChapter || item.description) && (
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground/60 truncate">
                        {imp && <span className="shrink-0 opacity-70">{imp.label}</span>}
                        {plantChapter && (
                          <span className="inline-flex items-center gap-0.5 shrink-0">
                            <FileText className="h-2.5 w-2.5" />
                            <span className="truncate max-w-[80px]" title={`埋设于「${plantChapter.title}」`}>埋:{plantChapter.title}</span>
                          </span>
                        )}
                        {resolveChapter && (
                          <span className="inline-flex items-center gap-0.5 text-green-600/70 shrink-0">
                            <CheckCircle className="h-2.5 w-2.5" />
                            <span className="truncate max-w-[80px]" title={`收尾于「${resolveChapter.title}」`}>收:{resolveChapter.title}</span>
                          </span>
                        )}
                        {item.description && !plantChapter && (
                          <span className="truncate max-w-[120px]" title={item.description}>{item.description}</span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 操作按钮 — hover 显示 */}
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" onClick={(e) => e.stopPropagation()}>
                    {item.status === 'open' && (
                      <>
                        <Button size="icon" variant="ghost" className="h-6.5 w-6.5 text-green-600 hover:text-green-700 hover:bg-green-50" onClick={(e) => { e.stopPropagation(); handleResolve(item) }} title="收尾">
                          <CheckCircle className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-6.5 w-6.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50" onClick={(e) => handleAbandon(e, item.id)} title="放弃">
                          <Ban className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-6.5 w-6.5">
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-32">
                        <DropdownMenuItem onClick={() => handleEdit(item)}>
                          <Edit2 className="h-3.5 w-3.5 mr-2" />编辑
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={(e) => handleDelete(e, item.id)}>
                          <Trash2 className="h-3.5 w-3.5 mr-2" />删除
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                {/* 展开区域：推进时间线 */}
                {isExpanded && (
                  <ForeshadowingTimeline foreshadowingId={item.id} novelId={novelId} onChapterSelect={onChapterSelect} />
                )}
              </div>
            )
          })
        )}
      </div>

      {/* 收尾对话框 */}
      <Dialog open={resolveDialogOpen} onOpenChange={setResolveDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>收尾伏笔</DialogTitle>
            <DialogDescription>选择伏笔收尾的章节以完成此伏笔</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">选择伏笔「{resolvingItem?.title}」收尾的章节：</p>
            <Select value={resolveChapterId} onValueChange={setResolveChapterId}>
              <SelectTrigger><SelectValue placeholder="选择收尾章节" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">未指定</SelectItem>
                {chapters?.map(ch => <SelectItem key={ch.id} value={ch.id}>{ch.title}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setResolveDialogOpen(false)}>取消</Button>
              <Button onClick={handleResolveSubmit} disabled={updateMutation.isPending}>{updateMutation.isPending ? '处理中...' : '确认收尾'}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 健康报告对话框 */}
      <Dialog open={healthOpen} onOpenChange={setHealthOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Stethoscope className="h-5 w-5" />伏笔健康报告</DialogTitle>
          </DialogHeader>
          {healthReport && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: '未收尾', value: healthReport.totalOpen, cls: 'text-yellow-600' },
                  { label: '可能遗忘', value: healthReport.staleItems.length, cls: 'text-orange-500' },
                  { label: '矛盾风险', value: healthReport.atRiskOfContradiction.length, cls: 'text-red-500' },
                ].map(s => (
                  <div key={s.label} className="border rounded-lg p-3 text-center bg-muted/30">
                    <div className={`text-xl font-bold ${s.cls}`}>{s.value}</div>
                    <div className="text-[10px] text-muted-foreground">{s.label}</div>
                  </div>
                ))}
              </div>

              {healthReport.staleItems.length > 0 && (
                <div>
                  <h4 className="text-[13px] font-semibold mb-2 flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 text-orange-500" />沉寂伏笔</h4>
                  <div className="space-y-1.5">
                    {healthReport.staleItems.slice(0, 6).map(item => (
                      <div key={item.id} className="border rounded-md p-2.5 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[13px] font-medium truncate">{item.title}</span>
                          <span className="text-[10px] text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded shrink-0">{item.chaptersSinceLastProgress}章未推进</span>
                        </div>
                        {item.suggestion && (
                          <div className="flex items-start gap-1.5">
                            <Lightbulb className="h-3 w-3 mt-0.3 text-amber-500 shrink-0" />
                            <p className="text-[11px] text-muted-foreground leading-relaxed flex-1">{item.suggestion}</p>
                            <Button size="icon" variant="ghost" className="h-5 w-5 shrink-0" onClick={() => { navigator.clipboard.writeText(item.suggestion); toast.success('已复制') }}>
                              <Copy className="h-2.5 w-2.5" />
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {healthReport.atRiskOfContradiction.length > 0 && (
                <div>
                  <h4 className="text-[13px] font-semibold mb-2 flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5 text-red-500" />矛盾预警</h4>
                  <div className="space-y-1.5">
                    {healthReport.atRiskOfContradiction.map(item => (
                      <div key={item.id} className="border border-red-200 rounded-md p-2.5 bg-red-50/50">
                        <div className="text-[13px] font-medium text-red-700">{item.title}</div>
                        <p className="text-[11px] text-red-600 mt-0.5">{item.riskReason}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {healthReport.resolutionSuggestions.length > 0 && (
                <div>
                  <h4 className="text-[13px] font-semibold mb-2 flex items-center gap-1.5"><CheckCircle className="h-3.5 w-3.5 text-green-500" />收尾建议</h4>
                  <div className="space-y-1.5">
                    {healthReport.resolutionSuggestions.map(item => (
                      <div key={item.id} className="border border-green-200 rounded-md p-2.5 bg-green-50/50">
                        <div className="text-[13px] font-medium text-green-700">{item.title}</div>
                        <p className="text-[11px] text-green-600 mt-0.5">{item.suggestedResolution}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!healthReport.staleItems.length && !healthReport.atRiskOfContradiction.length && !healthReport.resolutionSuggestions.length && (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-400" />
                  <p className="text-sm">伏笔健康状况良好！</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 统计看板对话框 */}
      <Dialog open={statsOpen} onOpenChange={setStatsOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5" />伏笔统计看板</DialogTitle>
            <DialogDescription>查看伏笔的详细统计数据和分析图表</DialogDescription>
          </DialogHeader>
          {statsData && (
            <div className="space-y-5">
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: '总计', value: statsData.overview.total, cls: '' },
                  { label: '未收尾', value: statsData.overview.open, cls: 'text-yellow-600' },
                  { label: '已收尾', value: statsData.overview.resolved, cls: 'text-green-600' },
                  { label: '收尾率', value: `${statsData.overview.resolutionRate}%`, cls: '' },
                ].map(s => (
                  <div key={s.label} className="border rounded-lg p-3 text-center">
                    <div className={`text-lg font-bold ${s.cls}`}>{s.value}</div>
                    <div className="text-[10px] text-muted-foreground">{s.label}</div>
                  </div>
                ))}
              </div>

              <div>
                <h4 className="text-[13px] font-semibold mb-2">按重要性分布</h4>
                <div className="space-y-2">
                  {Object.entries(statsData.byImportance).map(([imp, data]) => (
                    <div key={imp} className="flex items-center gap-3">
                      <span className="text-[11px] w-10 shrink-0">{imp === 'high' ? '🔴 重要' : imp === 'normal' ? '⚪ 一般' : '🔵 次要'}</span>
                      <div className="flex-1 h-5 bg-muted rounded-full overflow-hidden">
                        <div className="bg-primary/70 h-full rounded-full transition-all" style={{ width: `${data.total > 0 ? (data.total / statsData.overview.total * 100) : 0}%` }} />
                      </div>
                      <span className="text-[11px] tabular-nums w-14 text-right">{data.total}（开{data.open}/收{data.resolved}）</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-[13px] font-semibold mb-2">年龄分布（埋设时长）</h4>
                <div className="flex gap-2">
                  {statsData.byAge.map(bucket => (
                    <div key={bucket.range} className="flex-1 text-center">
                      <div className={`rounded-t-md px-2 py-2.5 text-white text-[13px] font-semibold ${
                        bucket.range === '20章+' ? 'bg-red-400' : bucket.range === '11-20章' ? 'bg-orange-400' : bucket.range === '4-10章' ? 'bg-yellow-400' : 'bg-green-400'
                      }`}>{bucket.count}</div>
                      <div className="text-[10px] text-muted-foreground pb-1">{bucket.range}</div>
                    </div>
                  ))}
                </div>
              </div>

              {statsData.hotChapters.length > 0 && (
                <div>
                  <h4 className="text-[13px] font-semibold mb-2">伏笔密集章节 Top5</h4>
                  <div className="space-y-1">
                    {statsData.hotChapters.map((ch, i) => (
                      <div key={ch.chapterId} className="flex items-center gap-2.5 border rounded px-3 py-2 text-[11px]">
                        <span className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold shrink-0">{i + 1}</span>
                        <span className="font-medium truncate flex-1">{ch.chapterTitle}</span>
                        <span className="text-blue-600 tabular-nums">埋{ch.plantedCount}</span>
                        <span className="text-green-600 tabular-nums">收{ch.resolvedCount}</span>
                        <span className="text-purple-600 tabular-nums">推{ch.progressedCount}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ForeshadowingTimeline({ foreshadowingId, novelId, onChapterSelect }: { foreshadowingId: string; novelId: string; onChapterSelect?: (chapterId: string) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['foreshadowing-progress', foreshadowingId],
    queryFn: () => api.foreshadowing.getProgress(foreshadowingId),
    enabled: !!foreshadowingId,
  })

  if (isLoading) return <div className="px-4 py-2.5 text-[11px] text-muted-foreground">加载推进记录...</div>
  if (!data?.progresses?.length) return <div className="px-4 py-2.5 text-[11px] text-muted-foreground italic">暂无推进记录</div>

  return (
    <div className="border-t bg-muted/15">
      <div className="px-3 pt-2 pb-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">推进时间线 · {data.progresses.length} 次</div>
      <div className="px-3 pb-2.5 space-y-1">
        {data.progresses.map(prog => {
          const cfg = PROGRESS_CONFIG[prog.progressType]
          const Icon = cfg?.icon || ChevronRight
          return (
            <div key={prog.id} className="flex items-start gap-2 py-1.5 animate-in">
              <Icon className={`h-3 w-3 mt-0.5 shrink-0 ${cfg?.color || 'text-muted-foreground'}`} />
              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={`text-[9px] px-1 py-px rounded font-medium ${cfg?.badge || ''}`}>{cfg?.label || prog.progressType}</span>
                  <span
                    className="text-[11px] text-blue-600 cursor-pointer hover:underline"
                    onClick={() => onChapterSelect?.(prog.chapterId)}
                  >{prog.chapterTitle}</span>
                  <span className="text-[10px] text-muted-foreground ml-auto">{new Date(prog.createdAt * 1000).toLocaleDateString()}</span>
                </div>
                {prog.summary && <p className="text-[11px] text-muted-foreground/70 leading-relaxed">{prog.summary}</p>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const IMPORTANCE_OPTIONS = [
  { value: 'high', label: '重要' },
  { value: 'normal', label: '一般' },
  { value: 'low', label: '次要' },
]
