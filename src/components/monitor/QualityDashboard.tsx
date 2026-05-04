/**
 * @file QualityDashboard.tsx
 * @description 质量监控仪表盘 - 整合质量图表/列表/详情的统一入口面板
 * @date 2026-05-04
 */
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { QualityScoreCard } from './QualityScoreCard'
import { ChapterQualityList } from './ChapterQualityList'
import { QualityDetailModal } from './QualityDetailModal'
import { QualityChart } from './QualityChart'
import type { QualitySummary, QualityChapterData } from './types'
import { Activity, Loader2, RefreshCw } from 'lucide-react'

interface QualityDashboardProps {
  novelId: string
}

export function QualityDashboard({ novelId }: QualityDashboardProps) {
  const queryClient = useQueryClient()
  const [selectedChapter, setSelectedChapter] = useState<QualityChapterData | null>(null)
  const [isBatchChecking, setIsBatchChecking] = useState(false)

  const { data: qualityData, isLoading, refetch } = useQuery<QualitySummary>({
    queryKey: ['quality-summary', novelId],
    queryFn: () => api.quality.getSummary(novelId),
    enabled: !!novelId,
  })

  const handleBatchCheck = async (): Promise<void> => {
    if (!novelId) return

    setIsBatchChecking(true)
    toast.info('正在批量检查最新章节的质量...', { duration: 3000 })

    try {
      const result = await api.quality.batchCheck({
        novelId,
        chapterIds: [],
      })

      if (result.ok) {
        toast.success(result.message || `已完成 ${result.checked}/${result.total} 章的质量检查`)
        await refetch()
      }
    } catch (error: any) {
      toast.error(`批量检查失败：${error.message || '未知错误'}`)
    } finally {
      setIsBatchChecking(false)
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-64" />
          <div className="grid grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-32 bg-muted rounded" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (!qualityData) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Activity className="h-12 w-12 mx-auto mb-3 opacity-30" />
        <p className="text-lg font-medium">暂无质量数据</p>
        <p className="text-sm mt-1">点击"批量检查"按钮开始评估章节质量</p>
      </div>
    )
  }

  const totalIssues = qualityData.chapters.reduce((sum, ch) => sum + ch.issueCount, 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">质量概览</h3>
          <p className="text-sm text-muted-foreground">最近{qualityData.chapters.length}章的质量评分</p>
        </div>

        <div className="flex items-center gap-3">
          {totalIssues > 0 && (
            <Badge variant="destructive" className="animate-pulse">
              发现 {totalIssues} 个问题
            </Badge>
          )}

          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            刷新
          </Button>

          <Button
            size="sm"
            onClick={handleBatchCheck}
            disabled={isBatchChecking}
          >
            {isBatchChecking ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                检查中...
              </>
            ) : (
              <>
                <Activity className="w-4 h-4 mr-2" />
                批量检查
              </>
            )}
          </Button>
        </div>
      </div>

      <QualityScoreCard data={qualityData.averages} />

      <Card>
        <CardHeader>
          <CardTitle>章节详情</CardTitle>
          <CardDescription>点击查看完整诊断报告</CardDescription>
        </CardHeader>
        <CardContent>
          <ChapterQualityList
            chapters={qualityData.chapters}
            onViewDetail={(chapter) => setSelectedChapter(chapter)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>质量趋势</CardTitle>
          <CardDescription>各维度分数变化曲线</CardDescription>
        </CardHeader>
        <CardContent>
          <QualityChart chapters={qualityData.chapters} />
        </CardContent>
      </Card>

      {selectedChapter && (
        <QualityDetailModal
          chapter={selectedChapter}
          onClose={() => setSelectedChapter(null)}
        />
      )}
    </div>
  )
}
