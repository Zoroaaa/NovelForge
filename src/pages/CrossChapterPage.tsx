/**
 * @file CrossChapterPage.tsx
 * @description 跨章一致性管理页面 — 展示内联实体、实体碰撞、角色成长、关系网络
 */
import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowLeft, AlertTriangle,
  Database, TrendingUp, Network, Trash2, CheckCircle2,
  RefreshCw, Loader2,
} from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

const ENTITY_TYPE_LABELS: Record<string, string> = {
  character: '角色', artifact: '法宝', technique: '功法',
  location: '地点', item: '道具', faction: '势力',
}

const GROWTH_DIMENSION_LABELS: Record<string, string> = {
  ability: '能力', social: '社交', knowledge: '知识',
  emotion: '情感', combat: '战斗', possession: '物品', growth: '成长性',
}

const SEVERITY_COLORS: Record<string, string> = {
  error: 'bg-red-100 text-red-800',
  warning: 'bg-yellow-100 text-yellow-800',
  info: 'bg-blue-100 text-blue-800',
}

export default function CrossChapterPage() {
  const { id: novelId } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState('entities')
  const [entityTypeFilter, setEntityTypeFilter] = useState<string>('')
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [selectedChapterId, setSelectedChapterId] = useState<string>('')

  const { data: stats } = useQuery({
    queryKey: ['crossChapterStats', novelId],
    queryFn: () => api.crossChapter.getStats(novelId!),
    enabled: !!novelId,
  })

  const { data: chapters = [] } = useQuery({
    queryKey: ['chapters', novelId],
    queryFn: () => api.chapters.list(novelId!),
    enabled: !!novelId,
  })

  const chaptersMap = chapters.reduce((acc, ch) => {
    acc[ch.sortOrder] = ch.title || '未命名'
    return acc
  }, {} as Record<number, string>)

  const { data: entities = [], isLoading: entitiesLoading } = useQuery({
    queryKey: ['inlineEntities', novelId, entityTypeFilter],
    queryFn: () => api.crossChapter.getInlineEntities(novelId!, {
      ...(entityTypeFilter !== '' && { entityType: entityTypeFilter }),
    }),
    enabled: !!novelId && activeTab === 'entities',
  })

  const { data: conflicts = [], isLoading: conflictsLoading } = useQuery({
    queryKey: ['entityConflicts', novelId],
    queryFn: () => api.crossChapter.getEntityConflicts(novelId!),
    enabled: !!novelId && activeTab === 'conflicts',
  })

  const { data: growthRecords = [], isLoading: growthLoading } = useQuery({
    queryKey: ['characterGrowth', novelId],
    queryFn: () => api.crossChapter.getCharacterGrowth(novelId!),
    enabled: !!novelId && activeTab === 'growth',
  })

  const { data: relationships = [], isLoading: relationshipsLoading } = useQuery({
    queryKey: ['relationships', novelId],
    queryFn: () => api.crossChapter.getRelationships(novelId!),
    enabled: !!novelId && activeTab === 'relationships',
  })

  const deleteEntityMutation = useMutation({
    mutationFn: (id: string) => api.crossChapter.deleteInlineEntity(id),
    onSuccess: () => {
      toast.success('实体已删除')
      queryClient.invalidateQueries({ queryKey: ['inlineEntities', novelId] })
      queryClient.invalidateQueries({ queryKey: ['crossChapterStats', novelId] })
      setDeleteTargetId(null)
    },
    onError: (error: Error) => toast.error(`删除失败: ${error.message}`),
  })

  const resolveConflictMutation = useMutation({
    mutationFn: ({ id, resolution }: { id: string; resolution: string }) =>
      api.crossChapter.resolveConflict(id, resolution),
    onSuccess: () => {
      toast.success('矛盾已标记为已知设定/已修复')
      queryClient.invalidateQueries({ queryKey: ['entityConflicts', novelId] })
      queryClient.invalidateQueries({ queryKey: ['crossChapterStats', novelId] })
    },
    onError: (error: Error) => toast.error(`操作失败: ${error.message}`),
  })

  const extractEntitiesMutation = useMutation({
    mutationFn: ({ chapterId, novelId }: { chapterId: string; novelId: string }) =>
      api.crossChapter.extractEntities(chapterId, novelId),
    onSuccess: (result) => {
      if (result.success) {
        toast.success(
          `提取完成：新增 ${result.entityCount} 个实体，` +
          `${result.stateChangeCount} 条状态记录，` +
          `${result.growthCount} 条成长记录，` +
          `${result.conflictCount} 个碰撞检测`
        )
        queryClient.invalidateQueries({ queryKey: ['inlineEntities', novelId] })
        queryClient.invalidateQueries({ queryKey: ['crossChapterStats', novelId] })
        queryClient.invalidateQueries({ queryKey: ['characterGrowth', novelId] })
        queryClient.invalidateQueries({ queryKey: ['entityConflicts', novelId] })
      } else {
        toast.error(`提取失败: ${result.error}`)
      }
    },
    onError: (error: Error) => toast.error(`提取失败: ${error.message}`),
  })

  const headerActions = (
    <div className="flex items-center gap-3">
      <Link to={`/novels/${novelId}`}>
        <Button variant="ghost" size="sm" className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> 返回工作台
        </Button>
      </Link>
    </div>
  )

  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="h-14 border-b bg-card/50 backdrop-blur-sm flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">跨章一致性管理</h1>
          <p className="text-sm text-muted-foreground">
            内联实体 {stats?.inlineEntityCount ?? 0} · 待处理矛盾 {stats?.pendingConflictCount ?? 0} · 成长记录 {stats?.growthRecordCount ?? 0} · 关系 {stats?.relationshipCount ?? 0}
          </p>
        </div>
        {headerActions}
      </header>

      <main className="flex-1 overflow-y-auto">
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="entities">
                <Database className="h-4 w-4 mr-1" /> 内联实体
              </TabsTrigger>
              <TabsTrigger value="conflicts">
                <AlertTriangle className="h-4 w-4 mr-1" /> 实体碰撞
                {stats?.pendingConflictCount ? (
                  <Badge variant="destructive" className="ml-1 h-5 px-1.5">{stats.pendingConflictCount}</Badge>
                ) : null}
              </TabsTrigger>
              <TabsTrigger value="growth">
                <TrendingUp className="h-4 w-4 mr-1" /> 角色成长
              </TabsTrigger>
              <TabsTrigger value="relationships">
                <Network className="h-4 w-4 mr-1" /> 关系网络
              </TabsTrigger>
              <TabsTrigger value="extract">
                <RefreshCw className="h-4 w-4 mr-1" /> 手动提取
              </TabsTrigger>
            </TabsList>

            <TabsContent value="entities" className="space-y-4">
              <div className="flex gap-2 flex-wrap">
                <Button
                  size="sm" variant={entityTypeFilter === '' ? 'default' : 'outline'}
                  onClick={() => setEntityTypeFilter('')}
                >全部</Button>
                {Object.entries(ENTITY_TYPE_LABELS).map(([key, label]) => (
                  <Button
                    key={key} size="sm"
                    variant={entityTypeFilter === key ? 'default' : 'outline'}
                    onClick={() => setEntityTypeFilter(key)}
                  >{label}</Button>
                ))}
              </div>

              {entitiesLoading ? (
                <div className="text-center py-8 text-muted-foreground">加载中...</div>
              ) : entities.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Database className="h-12 w-12 mx-auto mb-2 opacity-30" />
                  <p>暂无内联实体数据</p>
                  <p className="text-xs mt-1">生成新章节后，系统会自动提取实体信息</p>
                </div>
              ) : (
                <div className="grid gap-3">
                  {entities.map(entity => (
                    <div key={entity.id} className="border rounded-lg p-4 space-y-2">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{entity.name}</span>
                          <Badge variant="outline">{ENTITY_TYPE_LABELS[entity.entityType] || entity.entityType}</Badge>
                          {entity.isGrowable === 1 && <Badge variant="secondary">可成长</Badge>}
                        </div>
                        <Button
                          size="sm" variant="ghost"
                          onClick={() => setDeleteTargetId(entity.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <p className="text-sm text-muted-foreground">{entity.description}</p>
                      {entity.aliases && (
                        <p className="text-xs text-muted-foreground">别名：{entity.aliases}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        首次出现：{chaptersMap[entity.firstChapterOrder] || `第${entity.firstChapterOrder}章`}
                        {entity.lastChapterOrder !== null && entity.lastChapterOrder !== undefined && ` · 最后出现：${chaptersMap[entity.lastChapterOrder] || `第${entity.lastChapterOrder}章`}`}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="conflicts" className="space-y-4">
              {conflictsLoading ? (
                <div className="text-center py-8 text-muted-foreground">加载中...</div>
              ) : conflicts.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckCircle2 className="h-12 w-12 mx-auto mb-2 opacity-30 text-green-500" />
                  <p>暂无实体碰撞记录</p>
                  <p className="text-xs mt-1">系统会在章节后处理中自动检测矛盾</p>
                </div>
              ) : (
                <div className="grid gap-3">
                  {conflicts.map(conflict => (
                    <div key={conflict.id} className="border rounded-lg p-4 space-y-2">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{conflict.entityName}</span>
                          <Badge variant="outline">{ENTITY_TYPE_LABELS[conflict.entityType] || conflict.entityType}</Badge>
                          <Badge className={SEVERITY_COLORS[conflict.severity] || ''}>{conflict.severity}</Badge>
                          {conflict.resolution ? (
                            <Badge variant="secondary">已解决</Badge>
                          ) : (
                            <Badge variant="destructive">待处理</Badge>
                          )}
                        </div>
                        {!conflict.resolution && (
                          <div className="flex gap-1">
                            <Button
                              size="sm" variant="outline"
                              onClick={() => resolveConflictMutation.mutate({ id: conflict.id, resolution: 'known_setting' })}
                            >标记为已知设定</Button>
                            <Button
                              size="sm" variant="outline"
                              onClick={() => resolveConflictMutation.mutate({ id: conflict.id, resolution: 'fixed' })}
                            >标记已修复</Button>
                          </div>
                        )}
                      </div>
                      <p className="text-sm">{conflict.description}</p>
                      <div className="text-sm bg-muted/50 rounded p-2 mt-1 space-y-1">
                        {conflict.currentChapterExcerpt && (
                          <p><span className="font-medium">第{conflict.detectedChapterOrder}章原文：</span><span className="text-muted-foreground">{conflict.currentChapterExcerpt}</span></p>
                        )}
                        {conflict.historicalRecord && (
                          <p><span className="font-medium">第{conflict.historicalChapterOrder ?? '?'}章记录：</span><span className="text-muted-foreground">{conflict.historicalRecord}</span></p>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        第{conflict.detectedChapterOrder}章 ↔ 第{conflict.historicalChapterOrder ?? '?'}章 · 类型：{conflict.conflictType}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="growth" className="space-y-4">
              {growthLoading ? (
                <div className="text-center py-8 text-muted-foreground">加载中...</div>
              ) : growthRecords.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <TrendingUp className="h-12 w-12 mx-auto mb-2 opacity-30" />
                  <p>暂无角色成长记录</p>
                </div>
              ) : (
                <div className="grid gap-3">
                  {growthRecords.map(record => (
                    <div key={record.id} className="border rounded-lg p-4 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{record.characterName}</span>
                        <Badge variant="outline">
                          {GROWTH_DIMENSION_LABELS[record.growthDimension] || record.growthDimension}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{chaptersMap[record.chapterOrder] || `第${record.chapterOrder}章`}</span>
                      </div>
                      <div className="text-sm">
                        {record.prevState && <span className="text-muted-foreground">{record.prevState} → </span>}
                        <span>{record.currState}</span>
                      </div>
                      {record.detail && <p className="text-xs text-muted-foreground">{record.detail}</p>}
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="relationships" className="space-y-4">
              {relationshipsLoading ? (
                <div className="text-center py-8 text-muted-foreground">加载中...</div>
              ) : relationships.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Network className="h-12 w-12 mx-auto mb-2 opacity-30" />
                  <p>暂无关系网络数据</p>
                </div>
              ) : (
                <div className="grid gap-3">
                  {relationships.map(rel => (
                    <div key={rel.id} className="border rounded-lg p-4 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{rel.characterNameA}</span>
                        <span className="text-muted-foreground">→</span>
                        <span className="font-medium">{rel.characterNameB}</span>
                        <Badge variant="outline">{rel.relationType}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{rel.relationDesc}</p>
                      <p className="text-xs text-muted-foreground">
                        最后更新：第{rel.lastUpdatedChapterOrder}章
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="extract" className="space-y-4">
              <div className="border rounded-lg p-6 space-y-4">
                <div>
                  <h3 className="text-lg font-medium mb-2">手动提取章节实体</h3>
                  <p className="text-sm text-muted-foreground">
                    当自动提取因网络问题失败时，可使用此功能手动选择章节进行实体提取。
                    该功能会调用 LLM 分析章节内容，提取新出现的实体和状态变化。
                  </p>
                </div>

                <div className="flex items-center gap-4">
                  <div className="w-64 space-y-2">
                    <label className="text-sm font-medium">选择章节</label>
                    <Select value={selectedChapterId} onValueChange={setSelectedChapterId}>
                      <SelectTrigger>
                        <SelectValue placeholder="请选择章节..." />
                      </SelectTrigger>
                      <SelectContent>
                        {chapters.length === 0 ? (
                          <SelectItem value="empty" disabled>暂无可用章节</SelectItem>
                        ) : (
                          chapters
                            .filter(ch => ch.status === 'generated' || ch.status === 'draft')
                            .sort((a, b) => a.sortOrder - b.sortOrder)
                            .map(ch => (
                              <SelectItem key={ch.id} value={ch.id}>
                                {ch.title || '未命名'}
                              </SelectItem>
                            ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="pt-6">
                    <Button
                      onClick={() => {
                        if (selectedChapterId && novelId) {
                          extractEntitiesMutation.mutate({ chapterId: selectedChapterId, novelId })
                        }
                      }}
                      disabled={!selectedChapterId || extractEntitiesMutation.isPending}
                    >
                      {extractEntitiesMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          提取中...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2" />
                          开始提取
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                {extractEntitiesMutation.isError && (
                  <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
                    <p className="text-sm text-destructive">
                      提取失败：请检查网络连接和 analysis 模型配置
                    </p>
                  </div>
                )}

                <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                  <h4 className="text-sm font-medium">常见问题</h4>
                  <ul className="text-xs text-muted-foreground space-y-1">
                    <li>• 524 错误通常是由于 LLM API 响应超时导致</li>
                    <li>• 请检查 "analysis" 模型的 API 配置是否正确</li>
                    <li>• 建议使用响应更快的模型服务</li>
                    <li>• 已生成章节的内容越多，提取耗时可能越长</li>
                  </ul>
                </div>
              </div>
            </TabsContent>
          </Tabs>
      </div>
      </main>

      <AlertDialog open={!!deleteTargetId} onOpenChange={() => setDeleteTargetId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              删除后该内联实体将不再出现在上下文注入中。此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteTargetId && deleteEntityMutation.mutate(deleteTargetId)}>
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
