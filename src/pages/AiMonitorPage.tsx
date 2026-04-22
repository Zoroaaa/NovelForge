/**
 * @file AiMonitorPage.tsx
 * @description AI监控中心页面 - 向量索引管理、生成日志、上下文诊断、手动操作
 * @version 1.0.0
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { MainLayout } from '@/components/layout/MainLayout'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { GenerationLogs } from '@/components/generation/GenerationLogs'
import {
  Activity,
  Database,
  Search,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  BarChart3,
  FileText,
  Users,
  BookOpen,
  Layers,
  Eye,
  Trash2,
  Play,
} from 'lucide-react'

interface VectorStats {
  total: number
  byType: Record<string, number>
  lastIndexedAt: number | null
  unindexedCounts: {
    settings: number
    characters: number
    foreshadowing: number
  }
}

interface SearchResult {
  id: string
  score: number
  title: string
  sourceType: string
  preview: string
}

export default function AiMonitorPage() {
  const queryClient = useQueryClient()
  const [selectedNovelId, setSelectedNovelId] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [isReindexing, setIsReindexing] = useState(false)
  const [reindexProgress, setReindexProgress] = useState<string>('')
  const [contextNovelId, setContextNovelId] = useState<string>('')
  const [contextChapterId, setContextChapterId] = useState<string>('')

  const { data: novelsData } = useQuery({
    queryKey: ['novels'],
    queryFn: () => api.novels.list(),
  })

  const novels = novelsData?.data

  const { data: vectorStats, refetch: refetchVectorStats } = useQuery<VectorStats>({
    queryKey: ['vector-stats', selectedNovelId],
    queryFn: () => api.vectorize.getStats(selectedNovelId),
    enabled: !!selectedNovelId,
  })

  const reindexMutation = useMutation({
    mutationFn: (types?: string[]) =>
      api.vectorize.reindexAll({ novelId: selectedNovelId, types }),
    onSuccess: (data) => {
      toast.success(`索引重建完成：${data.indexed} 成功，${data.failed} 失败`)
      setIsReindexing(false)
      setReindexProgress('')
      queryClient.invalidateQueries({ queryKey: ['vector-stats'] })
    },
    onError: (error) => {
      toast.error(`索引重建失败：${error.message}`)
      setIsReindexing(false)
      setReindexProgress('')
    },
  })

  const handleSearch = async () => {
    if (!searchQuery.trim()) return

    setIsSearching(true)
    try {
      const results = await api.vectorize.search(searchQuery, selectedNovelId)
      setSearchResults(results.results || [])
    } catch (error) {
      toast.error('搜索失败')
      setSearchResults([])
    } finally {
      setIsSearching(false)
    }
  }

  const handleReindexAll = () => {
    if (!selectedNovelId) return
    setIsReindexing(true)
    setReindexProgress('正在重建索引...')
    reindexMutation.mutate(undefined)
  }

  const handleRebuildEntityIndex = async () => {
    if (!selectedNovelId) return
    try {
      await api.entities.rebuild({ novelId: selectedNovelId })
      toast.success('实体树重建成功')
      queryClient.invalidateQueries({ queryKey: ['vector-stats'] })
    } catch (error) {
      toast.error('实体树重建失败')
    }
  }

  const hasUnindexed =
    vectorStats &&
    (vectorStats.unindexedCounts.settings > 0 ||
      vectorStats.unindexedCounts.characters > 0 ||
      vectorStats.unindexedCounts.foreshadowing > 0)

  const maxTypeCount = vectorStats
    ? Math.max(...Object.values(vectorStats.byType), 1)
    : 1

  return (
    <MainLayout headerTitle="AI 监控中心" headerSubtitle="向量索引管理与诊断工具">
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Label htmlFor="novel-select">选择小说</Label>
          <Select value={selectedNovelId} onValueChange={setSelectedNovelId}>
            <SelectTrigger id="novel-select" className="w-[300px]">
              <SelectValue placeholder="请选择小说" />
            </SelectTrigger>
            <SelectContent>
              {novels?.map((novel: any) => (
                <SelectItem key={novel.id} value={novel.id}>
                  {novel.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetchVectorStats()}
            disabled={!selectedNovelId}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            刷新
          </Button>
        </div>

        {selectedNovelId && (
          <Tabs defaultValue="vectors" className="space-y-6">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="vectors" className="flex items-center gap-2">
                <Database className="w-4 h-4" />
                向量索引
              </TabsTrigger>
              <TabsTrigger value="logs" className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                生成日志
              </TabsTrigger>
              <TabsTrigger value="context" className="flex items-center gap-2">
                <Eye className="w-4 h-4" />
                上下文诊断
              </TabsTrigger>
              <TabsTrigger value="operations" className="flex items-center gap-2">
                <Activity className="w-4 h-4" />
                手动操作
              </TabsTrigger>
            </TabsList>

            <TabsContent value="vectors" className="space-y-6">
              {hasUnindexed && (
                <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-center gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0" />
                  <span className="text-sm text-red-800 dark:text-red-200">
                    还有{' '}
                    {vectorStats!.unindexedCounts.settings > 0 && (
                      <>{vectorStats!.unindexedCounts.settings} 条设定 </>
                    )}
                    {vectorStats!.unindexedCounts.characters > 0 && (
                      <>{vectorStats!.unindexedCounts.characters} 条角色 </>
                    )}
                    {vectorStats!.unindexedCounts.foreshadowing > 0 && (
                      <>{vectorStats!.unindexedCounts.foreshadowing} 条伏笔 </>
                    )}
                    未索引
                  </span>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-medium flex items-center gap-2">
                      <Database className="w-4 h-4 text-blue-600" />
                      总向量数
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{vectorStats?.total || 0}</div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-medium flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-green-600" />
                      设定已索引
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">
                      {vectorStats?.byType['setting'] || 0}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-medium flex items-center gap-2">
                      <Users className="w-4 h-4 text-purple-600" />
                      角色已索引
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">
                      {vectorStats?.byType['character'] || 0}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-medium flex items-center gap-2">
                      <Layers className="w-4 h-4 text-orange-600" />
                      摘要已索引
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">
                      {vectorStats?.byType['summary'] || 0}
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>类型分布</CardTitle>
                  <CardDescription>按内容类型统计的向量数量</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {Object.entries(vectorStats?.byType || {}).map(([type, count]) => (
                      <div key={type} className="flex items-center gap-4">
                        <span className="w-24 text-sm font-medium capitalize">{type}</span>
                        <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-6 overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all duration-500 flex items-center justify-end pr-2"
                            style={{ width: `${(count / maxTypeCount) * 100}%` }}
                          >
                            <span className="text-xs text-white font-medium">{count} 条</span>
                          </div>
                        </div>
                      </div>
                    ))}
                    {Object.keys(vectorStats?.byType || {}).length === 0 && (
                      <p className="text-gray-500 text-center py-8">暂无向量数据</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>向量搜索测试</CardTitle>
                  <CardDescription>输入关键词测试语义搜索功能</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-2 mb-4">
                    <Input
                      placeholder="输入搜索关键词..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                      className="flex-1"
                    />
                    <Button onClick={handleSearch} disabled={isSearching}>
                      {isSearching ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Search className="w-4 h-4" />
                      )}
                      搜索
                    </Button>
                  </div>

                  {searchResults.length > 0 && (
                    <div className="space-y-2 max-h-[400px] overflow-y-auto">
                      {searchResults.map((result) => (
                        <div
                          key={result.id}
                          className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-1"
                        >
                          <div className="flex items-center justify-between">
                            <Badge variant="secondary" className="capitalize">
                              {result.sourceType}
                            </Badge>
                            <span className="text-sm text-muted-foreground">
                              相关度: {(result.score * 100).toFixed(1)}%
                            </span>
                          </div>
                          <p className="font-medium text-sm">{result.title}</p>
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {result.preview}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="logs">
              <GenerationLogs />
            </TabsContent>

            <TabsContent value="context" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>上下文诊断</CardTitle>
                  <CardDescription>
                    选择章节查看生成时会注入的上下文信息，用于调试和优化
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>选择小说</Label>
                        <Select value={contextNovelId} onValueChange={setContextNovelId}>
                          <SelectTrigger>
                            <SelectValue placeholder="请选择小说" />
                          </SelectTrigger>
                          <SelectContent>
                            {novels?.map((novel: any) => (
                              <SelectItem key={novel.id} value={novel.id}>
                                {novel.title}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>选择章节</Label>
                        <Input
                          placeholder="输入章节ID"
                          value={contextChapterId}
                          onChange={(e) => setContextChapterId(e.target.value)}
                        />
                      </div>
                    </div>

                    <Button
                      onClick={async () => {
                        if (!contextNovelId || !contextChapterId) {
                          toast.error('请选择小说和章节')
                          return
                        }
                        try {
                          const result = await api.generate.previewContext(contextNovelId, contextChapterId)
                          console.log('Context preview:', result)
                          toast.success('上下文信息已输出到控制台')
                        } catch (error) {
                          toast.error('获取上下文失败')
                        }
                      }}
                      disabled={!contextNovelId || !contextChapterId}
                    >
                      <Eye className="w-4 h-4 mr-2" />
                      预览上下文
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="operations" className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <RefreshCw className="w-5 h-5" />
                      索引操作
                    </CardTitle>
                    <CardDescription>管理和重建向量索引</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Button
                      className="w-full"
                      onClick={handleReindexAll}
                      disabled={isReindexing || !selectedNovelId}
                    >
                      {isReindexing ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Database className="w-4 h-4 mr-2" />
                      )}
                      全量重建索引
                    </Button>
                    {isReindexing && (
                      <p className="text-sm text-muted-foreground text-center">
                        {reindexProgress}
                      </p>
                    )}

                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={handleRebuildEntityIndex}
                      disabled={!selectedNovelId}
                    >
                      <BarChart3 className="w-4 h-4 mr-2" />
                      重建实体树
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5" />
                      服务状态
                    </CardTitle>
                    <CardDescription>检查服务可用性</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <ServiceStatusCheck novelId={selectedNovelId} />
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        )}

        {!selectedNovelId && (
          <Card>
            <CardContent className="py-16 text-center">
              <Activity className="w-12 h-12 mx-auto text-gray-400 mb-4" />
              <p className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
                请选择一本小说
              </p>
              <p className="text-sm text-gray-500">
                选择小说后可查看向量索引状态、生成日志等信息
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </MainLayout>
  )
}

function ServiceStatusCheck({ novelId }: { novelId: string }) {
  const { data: status, isLoading, refetch } = useQuery({
    queryKey: ['vector-status', novelId],
    queryFn: () => api.vectorize.getStatus(),
    enabled: !!novelId,
  })

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        正在检查...
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <span className="font-medium">Vectorize 服务</span>
        <div className="flex items-center gap-2">
          <Badge
            variant={status?.status === 'ok' ? 'default' : 'destructive'}
            className={
              status?.status === 'ok' ? 'bg-green-600' : ''
            }
          >
            {status?.status === 'ok' ? (
              <>
                <CheckCircle2 className="w-3 h-3 mr-1" />
                正常
              </>
            ) : (
              <>
                <AlertTriangle className="w-3 h-3 mr-1" />
                异常
              </>
            )}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
          >
            <RefreshCw className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {status?.embeddingModel && (
        <div className="text-sm text-muted-foreground space-y-1 px-3">
          <p>模型: {status.embeddingModel}</p>
          <p>维度: {status.dimensions}</p>
        </div>
      )}

      {status?.status !== 'ok' && status?.message && (
        <p className="text-sm text-destructive px-3">{status.message}</p>
      )}
    </div>
  )
}
