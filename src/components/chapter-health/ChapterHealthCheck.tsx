/**
 * @file ChapterHealthCheck.tsx
 * @description 章节健康检查主入口组件，整合所有检查功能
 */
import { useState, useEffect, useCallback } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Shield,
  ShieldAlert,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Loader2,
  Link,
  Zap,
  BookOpen,
  Target,
  FileText,
  AlignLeft,
} from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { CharacterConsistencyCheck } from './CharacterConsistencyCheck'
import { ChapterCoherenceCheck } from './ChapterCoherenceCheck'
import { CombinedCheck } from './CombinedCheck'
import { VolumeProgressCheck } from './VolumeProgressCheck'
import { api, getToken } from '@/lib/api'

interface ChapterHealthCheckProps {
  novelId: string
  chapterId: string | null
}

interface CoherenceIssue {
  severity: 'error' | 'warning'
  category?: string
  message: string
  suggestion?: string
}

interface CoherenceCheckResult {
  score: number
  issues: CoherenceIssue[]
}

function formatTimeAgo(timestamp: number): string {
  const now = Date.now()
  let ts = timestamp
  if (ts < 10000000000) {
    ts = ts * 1000
  }
  const diff = now - ts
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}天前`
  if (hours > 0) return `${hours}小时前`
  if (minutes > 0) return `${minutes}分钟前`
  return '刚刚'
}

export function ChapterHealthCheck({ novelId, chapterId }: ChapterHealthCheckProps) {
  const [latestCheckLog, setLatestCheckLog] = useState<any>(null)
  const [showCheckHistory, setShowCheckHistory] = useState(false)
  const [checkHistory, setCheckHistory] = useState<any[]>([])
  const [historyReportDialogOpen, setHistoryReportDialogOpen] = useState(false)
  const [selectedHistoryLog, setSelectedHistoryLog] = useState<any>(null)

  const [combinedReport, setCombinedReport] = useState<any>(null)
  const [isChecking, setIsChecking] = useState(false)
  const [isFromCache, setIsFromCache] = useState(false)
  const [reportCachedAt, setReportCachedAt] = useState<number | null>(null)
  const [rewriteDialogOpen, setRewriteDialogOpen] = useState(false)
  const [coherenceResult, setCoherenceResult] = useState<CoherenceCheckResult | null>(null)
  const [coherenceCheckFailed, setCoherenceCheckFailed] = useState(false)

  const [coherenceDialogOpen, setCoherenceDialogOpen] = useState(false)
  const [coherenceChecking, setCoherenceChecking] = useState(false)
  const [coherenceReport, setCoherenceReport] = useState<CoherenceCheckResult | null>(null)
  const [coherenceFromCache, setCoherenceFromCache] = useState(false)
  const [coherenceCachedAt, setCoherenceCachedAt] = useState<number | null>(null)

  const [characterDialogOpen, setCharacterDialogOpen] = useState(false)
  const [characterChecking, setCharacterChecking] = useState(false)
  const [characterReport, setCharacterReport] = useState<any>(null)
  const [characterFromCache, setCharacterFromCache] = useState(false)
  const [characterCachedAt, setCharacterCachedAt] = useState<number | null>(null)

  const [volumeDialogOpen, setVolumeDialogOpen] = useState(false)
  const [volumeChecking, setVolumeChecking] = useState(false)
  const [volumeReport, setVolumeReport] = useState<any>(null)
  const [volumeFromCache, setVolumeFromCache] = useState(false)
  const [volumeCachedAt, setVolumeCachedAt] = useState<number | null>(null)

  const loadLatestCheckLog = useCallback(async () => {
    try {
      const data = await api.generate.getCheckLogsLatest(chapterId!)
      if (data.log) {
        setLatestCheckLog(data.log)
      }
    } catch (error) {
      console.error('加载最新检查日志失败:', error)
    }
  }, [chapterId])

  useEffect(() => {
    if (chapterId) {
      setLatestCheckLog(null)
      setCheckHistory([])
      setShowCheckHistory(false)
      loadLatestCheckLog()
    }
  }, [chapterId, loadLatestCheckLog])

  const loadCheckHistory = useCallback(async () => {
    try {
      const data = await api.generate.getCheckLogsHistory(chapterId!, 20)
      setCheckHistory(data.logs || [])
      setShowCheckHistory(true)
    } catch (error) {
      console.error('加载检查历史失败:', error)
    }
  }, [chapterId])

  const handleRewriteClick = async () => {
    setRewriteDialogOpen(true)
    setIsChecking(true)
    setCombinedReport(null)

    try {
      const cachedData = await api.generate.getCheckLogsLatest(chapterId!, 'combined')

      if (cachedData.log && cachedData.log.characterResult && cachedData.log.coherenceResult) {
        const cachedVolumeProgress = cachedData.log.volumeProgressResult
        const isVolumeProgressValid = cachedVolumeProgress &&
          cachedVolumeProgress.wordCountIssues !== undefined &&
          cachedVolumeProgress.rhythmIssues !== undefined

        if (isVolumeProgressValid) {
          setCombinedReport({
            characterResult: cachedData.log.characterResult,
            coherenceResult: cachedData.log.coherenceResult,
            volumeProgressResult: cachedVolumeProgress,
            score: cachedData.log.score ?? 100,
          })
          setIsFromCache(true)
          setReportCachedAt(cachedData.log.createdAt)
          setIsChecking(false)
          return
        }

        const volumeProgressData = await api.generate.getCheckLogsLatest(chapterId!, 'volume_progress')
        if (volumeProgressData.log && volumeProgressData.log.volumeProgressResult) {
          setCombinedReport({
            characterResult: cachedData.log.characterResult,
            coherenceResult: cachedData.log.coherenceResult,
            volumeProgressResult: volumeProgressData.log.volumeProgressResult,
            score: cachedData.log.score ?? 100,
          })
          setIsFromCache(true)
          setReportCachedAt(cachedData.log.createdAt)
          setIsChecking(false)
          return
        }
      }

      const checkData = await api.generate.combinedCheck({ chapterId: chapterId!, novelId })

      setCombinedReport({
        characterCheck: checkData.characterCheck,
        coherenceCheck: checkData.coherenceCheck,
        volumeProgressCheck: checkData.volumeProgressCheck,
        score: checkData.score,
      })
      setIsFromCache(false)
      setReportCachedAt(null)

      loadLatestCheckLog()
    } catch (error) {
      console.error('综合检查失败:', error)
      setCoherenceCheckFailed(true)
    } finally {
      setIsChecking(false)
    }
  }

  const handleRecheck = async () => {
    setIsChecking(true)
    setCombinedReport(null)

    try {
      const data = await api.generate.combinedCheck({ chapterId: chapterId!, novelId })

      setCombinedReport({
        characterCheck: data.characterCheck,
        coherenceCheck: data.coherenceCheck,
        volumeProgressCheck: data.volumeProgressCheck,
        score: data.score,
      })
      setIsFromCache(false)
      setReportCachedAt(null)

      loadLatestCheckLog()
    } catch (error) {
      console.error('重新检查失败:', error)
    } finally {
      setIsChecking(false)
    }
  }

  const handleCoherenceCheck = async () => {
    setCoherenceDialogOpen(true)
    setCoherenceChecking(true)
    setCoherenceReport(null)

    try {
      const cachedData = await api.generate.getCheckLogsLatest(chapterId!, 'chapter_coherence')
      if (cachedData.log && cachedData.log.coherenceResult) {
        setCoherenceReport({
          ...cachedData.log.coherenceResult,
          issues: cachedData.log.coherenceResult.issues.map((i: any) => ({
            ...i,
            severity: i.severity as 'error' | 'warning'
          }))
        })
        setCoherenceFromCache(true)
        setCoherenceCachedAt(cachedData.log.createdAt)
        setCoherenceChecking(false)
        return
      }

      const data = await api.generate.checkCoherence({ chapterId: chapterId!, novelId })
      setCoherenceReport({
        score: data.score ?? 100,
        issues: (data.issues ?? []).map((i: any) => ({
          ...i,
          severity: i.severity as 'error' | 'warning'
        }))
      })
      setCoherenceFromCache(false)
      setCoherenceCachedAt(null)
      loadLatestCheckLog()
    } catch (error) {
      console.error('连贯性检查失败:', error)
      setCoherenceReport({ score: 0, issues: [{ severity: 'error', message: `检查失败: ${(error as Error).message}` }] })
    } finally {
      setCoherenceChecking(false)
    }
  }

  const handleCoherenceRecheck = async () => {
    setCoherenceChecking(true)
    setCoherenceReport(null)

    try {
      const data = await api.generate.checkCoherence({ chapterId: chapterId!, novelId })
      setCoherenceReport({
        score: data.score ?? 100,
        issues: (data.issues ?? []).map((i: any) => ({
          ...i,
          severity: i.severity as 'error' | 'warning'
        }))
      })
      setCoherenceFromCache(false)
      setCoherenceCachedAt(null)
      loadLatestCheckLog()
    } catch (error) {
      console.error('连贯性检查失败:', error)
    } finally {
      setCoherenceChecking(false)
    }
  }

  const handleCharacterCheck = async () => {
    setCharacterDialogOpen(true)
    setCharacterChecking(true)
    setCharacterReport(null)

    try {
      const cachedData = await api.generate.getCheckLogsLatest(chapterId!, 'character_consistency')
      if (cachedData.log && cachedData.log.characterResult) {
        setCharacterReport(cachedData.log.characterResult)
        setCharacterFromCache(true)
        setCharacterCachedAt(cachedData.log.createdAt)
        setCharacterChecking(false)
        return
      }

      const characters = await api.characters.list(novelId)
      const data = await api.generate.checkCharacterConsistency({
        chapterId: chapterId!,
        characterIds: characters?.map(c => c.id) || [],
      })
      setCharacterReport(data)
      setCharacterFromCache(false)
      setCharacterCachedAt(null)
      loadLatestCheckLog()
    } catch (error) {
      console.error('角色一致性检查失败:', error)
      setCharacterReport({ conflicts: [], warnings: [`检查失败: ${(error as Error).message}`] })
    } finally {
      setCharacterChecking(false)
    }
  }

  const handleCharacterRecheck = async () => {
    setCharacterChecking(true)
    setCharacterReport(null)

    try {
      const characters = await api.characters.list(novelId)
      const data = await api.generate.checkCharacterConsistency({
        chapterId: chapterId!,
        characterIds: characters?.map(c => c.id) || [],
      })
      setCharacterReport(data)
      setCharacterFromCache(false)
      setCharacterCachedAt(null)
      loadLatestCheckLog()
    } catch (error) {
      console.error('角色一致性检查失败:', error)
    } finally {
      setCharacterChecking(false)
    }
  }

  const handleVolumeCheck = async () => {
    setVolumeDialogOpen(true)
    setVolumeChecking(true)
    setVolumeReport(null)

    try {
      const cachedData = await api.generate.getCheckLogsLatest(chapterId!, 'volume_progress')
      if (cachedData.log && cachedData.log.volumeProgressResult) {
        setVolumeReport(cachedData.log.volumeProgressResult)
        setVolumeFromCache(true)
        setVolumeCachedAt(cachedData.log.createdAt)
        setVolumeChecking(false)
        return
      }

      const data = await api.generate.checkVolumeProgress({ chapterId: chapterId!, novelId })
      setVolumeReport(data)
      setVolumeFromCache(false)
      setVolumeCachedAt(null)
      loadLatestCheckLog()
    } catch (error) {
      console.error('卷进度检查失败:', error)
    } finally {
      setVolumeChecking(false)
    }
  }

  const handleVolumeRecheck = async () => {
    setVolumeChecking(true)
    setVolumeReport(null)

    try {
      const data = await api.generate.checkVolumeProgress({ chapterId: chapterId!, novelId })
      setVolumeReport(data)
      setVolumeFromCache(false)
      setVolumeCachedAt(null)
      loadLatestCheckLog()
    } catch (error) {
      console.error('卷进度检查失败:', error)
    } finally {
      setVolumeChecking(false)
    }
  }

  if (!chapterId) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        请先选择一个章节
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* 最新检查结果摘要 */}
      {latestCheckLog && (
        <div className="flex items-center justify-between p-2.5 bg-muted/40 rounded-lg text-xs group hover:bg-muted/60 transition-colors">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Badge variant="outline" className="text-[10px] shrink-0">
              {latestCheckLog.checkType === 'character_consistency' && '角色'}
              {latestCheckLog.checkType === 'chapter_coherence' && '连贯性'}
              {latestCheckLog.checkType === 'combined' && '综合'}
              {latestCheckLog.checkType === 'volume_progress' && '卷进度'}
            </Badge>
            <span className={`font-semibold ${
              latestCheckLog.score >= 80 ? 'text-green-600' :
              latestCheckLog.score >= 60 ? 'text-amber-600' :
              'text-red-600'
            }`}>
              {latestCheckLog.score}分
            </span>
            <span className="text-muted-foreground truncate ml-1">
              {latestCheckLog.issuesCount > 0 ? `${latestCheckLog.issuesCount}个问题` : '✓ 通过'}
            </span>
          </div>

          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[10px] px-1.5"
              onClick={() => loadCheckHistory()}
            >
              历史
            </Button>
            {(latestCheckLog.checkType === 'chapter_coherence' || latestCheckLog.checkType === 'combined') &&
             latestCheckLog.coherenceResult?.issues?.length > 0 && (
              <Button
                variant="default"
                size="sm"
                className="h-6 text-[10px] px-2 bg-blue-600 hover:bg-blue-700"
                onClick={() => {
                  if (latestCheckLog.coherenceResult) {
                    setCombinedReport({
                    characterCheck: latestCheckLog.characterResult || { conflicts: [], warnings: [] },
                    coherenceCheck: latestCheckLog.coherenceResult,
                    volumeProgressCheck: latestCheckLog.volumeProgressResult || null,
                    score: latestCheckLog.score,
                  })
                    setCoherenceResult({
                      score: latestCheckLog.coherenceResult.score,
                      issues: latestCheckLog.coherenceResult.issues,
                    })
                    setIsFromCache(true)
                    setReportCachedAt(latestCheckLog.createdAt)
                    setRewriteDialogOpen(true)
                  }
                }}
              >
                查看报告
              </Button>
            )}
          </div>
        </div>
      )}

      {/* 主标签页 */}
      <Tabs defaultValue="coherence" className="w-full">
        <TabsList className="grid w-full grid-cols-4 h-9">
          <TabsTrigger value="coherence" className="text-xs">连贯性</TabsTrigger>
          <TabsTrigger value="character" className="text-xs">角色一致性</TabsTrigger>
          <TabsTrigger value="volume" className="text-xs">卷进度</TabsTrigger>
          <TabsTrigger value="combined" className="text-xs">综合检查</TabsTrigger>
        </TabsList>

        <TabsContent value="coherence" className="mt-4">
          <div className="space-y-3">
            <div className="flex justify-end">
              <Button
                variant="default"
                size="sm"
                className="gap-2"
                onClick={handleCoherenceCheck}
                disabled={coherenceChecking}
              >
                {coherenceChecking ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    检查中...
                  </>
                ) : (
                  <>
                    <Link className="h-4 w-4" />
                    执行连贯性检查
                  </>
                )}
              </Button>
            </div>
            <ChapterCoherenceCheck novelId={novelId} chapterId={chapterId} onCheckComplete={(result) => {
              setCoherenceResult(result)
              loadLatestCheckLog()
            }} />
          </div>
        </TabsContent>

        <TabsContent value="character" className="mt-4">
          <div className="space-y-3">
            <div className="flex justify-end">
              <Button
                variant="default"
                size="sm"
                className="gap-2"
                onClick={handleCharacterCheck}
                disabled={characterChecking}
              >
                {characterChecking ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    检查中...
                  </>
                ) : (
                  <>
                    <Shield className="h-4 w-4" />
                    执行角色一致性检查
                  </>
                )}
              </Button>
            </div>
            <CharacterConsistencyCheck novelId={novelId} chapterId={chapterId} />
          </div>
        </TabsContent>

        <TabsContent value="volume" className="mt-4">
          <div className="space-y-3">
            <div className="flex justify-end">
              <Button
                variant="default"
                size="sm"
                className="gap-2"
                onClick={handleVolumeCheck}
                disabled={volumeChecking}
              >
                {volumeChecking ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    检查中...
                  </>
                ) : (
                  <>
                    <Target className="h-4 w-4" />
                    执行卷进度检查
                  </>
                )}
              </Button>
            </div>
            <VolumeProgressCheck novelId={novelId} chapterId={chapterId} />
          </div>
        </TabsContent>

        <TabsContent value="combined" className="mt-4">
          <div className="space-y-3">
            <div className="flex justify-end">
              <Button
                variant="default"
                size="sm"
                className="gap-2"
                onClick={handleRewriteClick}
                disabled={isChecking}
              >
                {isChecking ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    检查中...
                  </>
                ) : (
                  <>
                    <Shield className="h-4 w-4" />
                    <Link className="h-4 w-4" />
                    <Target className="h-4 w-4" />
                    执行综合检查
                  </>
                )}
              </Button>
            </div>
            <CombinedCheck
              novelId={novelId}
              chapterId={chapterId}
              combinedReport={combinedReport}
              onCheckComplete={(result) => {
                if (result.coherenceCheck.issues.length > 0) {
                  setCoherenceResult({
                    score: result.coherenceCheck.score,
                    issues: result.coherenceCheck.issues,
                  })
                }
                setCombinedReport({
                  characterCheck: result.characterCheck,
                  coherenceCheck: result.coherenceCheck,
                  volumeProgressCheck: result.volumeProgressCheck,
                  score: result.score,
                })
                loadLatestCheckLog()
              }}
            />
          </div>
        </TabsContent>
      </Tabs>

      {/* 检查历史列表 */}
      {showCheckHistory && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground uppercase tracking-wider">
            检查历史
          </h4>
          <ScrollArea className="max-h-40 rounded-lg border bg-muted/20">
            <div className="p-2 space-y-1">
              {checkHistory.map((log) => (
                <button
                  key={log.id}
                  className={`w-full flex items-center justify-between p-2 rounded text-xs text-left transition-colors hover:bg-background ${
                    log.id === latestCheckLog?.id ? 'bg-primary/5 ring-1 ring-primary/20' : ''
                  }`}
                  onClick={() => {
                    setSelectedHistoryLog(log)
                    setHistoryReportDialogOpen(true)
                  }}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Badge variant="outline" className="text-[9px] shrink-0">
                      {log.checkType === 'character_consistency' && '角色'}
                      {log.checkType === 'chapter_coherence' && '连贯'}
                      {log.checkType === 'combined' && '综合'}
                      {log.checkType === 'volume_progress' && '卷进度'}
                    </Badge>
                    <span className={`font-medium ${
                      log.score >= 80 ? 'text-green-600' :
                      log.score >= 60 ? 'text-amber-600' : 'text-red-600'
                    }`}>
                      {log.score}分
                    </span>
                  </div>
                  <span className="text-muted-foreground text-[10px] shrink-0 ml-2">
                    {new Date(log.createdAt * 1000).toLocaleTimeString('zh-CN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* 综合检查报告对话框 */}
      <AlertDialog open={rewriteDialogOpen} onOpenChange={setRewriteDialogOpen}>
        <AlertDialogContent className="w-[90vw] max-w-3xl max-h-[85vh] flex flex-col rounded-xl shadow-2xl">
          <AlertDialogHeader className="flex-shrink-0 px-6 pt-6 pb-4 border-b space-y-0 gap-0">
            <div className="flex items-center justify-between">
              <AlertDialogTitle className="text-lg font-semibold text-left">质量检查报告</AlertDialogTitle>
              {isFromCache && reportCachedAt && (
                <span className="text-xs text-muted-foreground">上次检查：{formatTimeAgo(reportCachedAt)}</span>
              )}
            </div>
            <AlertDialogDescription asChild>
              <div className="text-left mt-3 overflow-y-auto max-h-[60vh] pr-2">
                {isChecking ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-3">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <span className="text-sm text-muted-foreground">正在执行综合质量检查...</span>
                  </div>
                ) : coherenceCheckFailed ? (
                  <div className="flex flex-col items-center py-8 gap-4">
                    <AlertTriangle className="h-10 w-10 text-amber-500" />
                    <div className="text-center space-y-2">
                      <p className="text-base font-medium text-amber-600 dark:text-amber-400">质量检查失败</p>
                      <p className="text-xs text-muted-foreground">请检查网络连接后重试</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={handleRecheck} className="gap-2">
                      <RefreshCw className="h-4 w-4" />重新检查
                    </Button>
                  </div>
                ) : combinedReport ? (
                  <div className="space-y-5">
                    <div className="flex items-center justify-between p-4 bg-gradient-to-r from-muted/80 to-muted/40 rounded-xl border">
                      <div className="flex items-baseline gap-4">
                        <span className="text-sm font-medium text-muted-foreground">综合评分</span>
                        <span className={`text-3xl font-bold tabular-nums ${
                          combinedReport.score >= 80 ? 'text-green-600' :
                          combinedReport.score >= 60 ? 'text-amber-600' : 'text-red-600'
                        }`}>
                          {combinedReport.score}
                        </span>
                        <span className="text-lg text-muted-foreground">/100</span>
                      </div>
                      <Button variant="secondary" size="sm" className="gap-2 h-9 shadow-sm hover:shadow-md transition-shadow" onClick={handleRecheck}>
                        <RefreshCw className="h-4 w-4" />重新生成报告
                      </Button>
                    </div>

                    <div className="overflow-y-auto max-h-[45vh] pr-2 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent rounded-lg">
                      <div className="space-y-5 pb-2">
                        {/* 角色一致性部分 */}
                        {(combinedReport.characterCheck?.conflicts?.length > 0 || combinedReport.characterCheck?.warnings?.length > 0) && (
                          <section className="space-y-3">
                            <header className="flex items-center gap-2.5 pb-2 border-b border-red-200/50 dark:border-red-800/30">
                              <Shield className="h-4 w-4 text-destructive" />
                              <h3 className="text-sm font-semibold uppercase tracking-wide">角色一致性检查</h3>
                              <Badge variant="destructive" className="ml-auto text-[11px] h-5">
                                {combinedReport.characterCheck.conflicts.length > 0
                                  ? `${combinedReport.characterCheck.conflicts.length} 个冲突` 
                                  : '通过'}
                              </Badge>
                            </header>

                            <div className="space-y-2 pl-1">
                              {combinedReport.characterCheck.conflicts.map((conflict: any, i: number) => (
                                <article key={`char-c-${i}`} className="group p-3.5 bg-gradient-to-br from-red-50 to-white dark:from-red-950/60 dark:to-transparent border border-red-200/70 dark:border-red-800/40 rounded-lg hover:shadow-md transition-shadow">
                                  <header className="flex items-center gap-2 mb-2">
                                    <ShieldAlert className="h-4 w-4 text-red-500 shrink-0" />
                                    <strong className="text-sm text-red-700 dark:text-red-300">{conflict.characterName}</strong>
                                  </header>
                                  <p className="text-[13px] leading-relaxed text-red-600/90 dark:text-red-400/90 ml-6">{conflict.conflict}</p>
                                  {conflict.excerpt && (
                                    <blockquote className="mt-2 ml-6 py-2.5 px-3 bg-red-100/50 dark:bg-red-900/20 rounded border-l-2 border-red-400 italic text-xs text-muted-foreground leading-relaxed">
                                      "{conflict.excerpt}"
                                    </blockquote>
                                  )}
                                </article>
                              ))}

                              {combinedReport.characterCheck.warnings?.filter((w: string) => !w.includes('失败')).map((warning: string, i: number) => (
                                <div key={`char-w-${i}`} className="flex items-start gap-3 p-3 bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-800/30 rounded-lg text-[13px] text-amber-800 dark:text-amber-200 leading-relaxed">
                                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
                                  <span>{warning}</span>
                                </div>
                              ))}
                            </div>
                          </section>
                        )}

                        {/* 章节连贯性部分 */}
                        {combinedReport.coherenceCheck?.issues?.length > 0 && (
                          <section className="space-y-3">
                            <header className="flex items-center gap-2.5 pb-2 border-b border-amber-200/50 dark:border-amber-800/30">
                              <Link className="h-4 w-4 text-amber-600" />
                              <h3 className="text-sm font-semibold uppercase tracking-wide">章节连贯性检查</h3>
                              <Badge variant="outline" className="ml-auto text-[11px] h-5">
                                {combinedReport.coherenceCheck.score}分 · {combinedReport.coherenceCheck.issues.length}个问题
                              </Badge>
                            </header>

                            <div className="space-y-2 pl-1">
                              {combinedReport.coherenceCheck.issues.map((issue: any, i: number) => (
                                <article key={`coh-${i}`} className={`p-3.5 rounded-lg border hover:shadow-md transition-shadow ${
                                  issue.severity === 'error'
                                    ? 'bg-gradient-to-br from-red-50 to-white dark:from-red-950/60 dark:to-transparent border-red-200/70 dark:border-red-800/40'
                                    : 'bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/30 dark:to-transparent border-amber-200/60 dark:border-amber-800/30'
                                }`}>
                                  <header className="flex items-center gap-2 mb-1.5">
                                    {issue.severity === 'error' ? (
                                      <>
                                        <ShieldAlert className="h-4 w-4 text-red-500 shrink-0" />
                                        <strong className="text-sm text-red-700 dark:text-red-300">错误 {i + 1}</strong>
                                      </>
                                    ) : (
                                      <>
                                        <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                                        <strong className="text-sm text-amber-700 dark:text-amber-300">警告 {i + 1}</strong>
                                      </>
                                    )}
                                    <Badge variant="secondary" className="text-[10px] ml-auto h-5">{issue.category || '其他'}</Badge>
                                  </header>
                                  <p className={`text-[13px] leading-relaxed ${
                                    issue.severity === 'error'
                                      ? 'text-red-600/90 dark:text-red-400/90'
                                      : 'text-amber-700/90 dark:text-amber-300/90'
                                  }`}>{issue.message}</p>
                                  {issue.suggestion && (
                                    <footer className="mt-2 ml-4 text-xs text-muted-foreground flex items-start gap-1.5">
                                      <span>💡 建议：</span>
                                      <span>{issue.suggestion}</span>
                                    </footer>
                                  )}
                                </article>
                              ))}
                            </div>
                          </section>
                        )}

                        {/* 卷完成度部分 */}
                        {combinedReport.volumeProgressResult && (combinedReport.volumeProgressResult.wordCountIssues.length > 0 || combinedReport.volumeProgressResult.rhythmIssues.length > 0) && (
                          <section className="space-y-3">
                            <header className="flex items-center gap-2.5 pb-2 border-b border-blue-200/50 dark:border-blue-800/30">
                              <Target className="h-4 w-4 text-blue-600" />
                              <h3 className="text-sm font-semibold uppercase tracking-wide">卷完成度检查</h3>
                              <Badge className={`ml-auto text-[11px] h-5 ${
                                combinedReport.volumeProgressResult.score >= 80
                                  ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                                  : combinedReport.volumeProgressResult.score >= 60
                                  ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'
                                  : 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
                              }`}>
                                {combinedReport.volumeProgressResult.score}分 · 字数{combinedReport.volumeProgressResult.wordCountScore} · 节奏{combinedReport.volumeProgressResult.rhythmScore}
                              </Badge>
                            </header>

                            <div className="space-y-2 pl-1">
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                <div className="p-2 bg-muted/30 rounded">
                                  <span className="text-muted-foreground">当前章节：</span>
                                  <span className="font-medium ml-1">第 {combinedReport.volumeProgressResult.currentChapter || '-'} 章</span>
                                </div>
                                <div className="p-2 bg-muted/30 rounded">
                                  <span className="text-muted-foreground">目标章节：</span>
                                  <span className="font-medium ml-1">{combinedReport.volumeProgressResult.targetChapter ? `${combinedReport.volumeProgressResult.targetChapter} 章` : '未设定'}</span>
                                </div>
                                <div className="p-2 bg-muted/30 rounded">
                                  <span className="text-muted-foreground">当前字数：</span>
                                  <span className="font-medium ml-1">{combinedReport.volumeProgressResult.currentWordCount ? `${(combinedReport.volumeProgressResult.currentWordCount / 10000).toFixed(1)} 万` : '-'}</span>
                                </div>
                                <div className="p-2 bg-muted/30 rounded">
                                  <span className="text-muted-foreground">目标字数：</span>
                                  <span className="font-medium ml-1">{combinedReport.volumeProgressResult.targetWordCount ? `${(combinedReport.volumeProgressResult.targetWordCount / 10000).toFixed(0)} 万` : '未设定'}</span>
                                </div>
                              </div>
                              {combinedReport.volumeProgressResult.diagnosis && (
                                <div className="p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg text-xs">
                                  <span className="text-blue-700 dark:text-blue-300 font-medium">诊断：</span>
                                  <span className="text-blue-600 dark:text-blue-400 ml-1">{combinedReport.volumeProgressResult.diagnosis}</span>
                                </div>
                              )}
                              {combinedReport.volumeProgressResult.suggestion && (
                                <div className="p-3 bg-muted/30 rounded-lg text-xs">
                                  <span className="text-muted-foreground">AI 建议：</span>
                                  <p className="mt-1 text-foreground">{combinedReport.volumeProgressResult.suggestion}</p>
                                </div>
                              )}
                            </div>
                          </section>
                        )}

                        {/* 无问题提示 */}
                        {!combinedReport.characterCheck?.conflicts?.length &&
                         !combinedReport.characterCheck?.warnings?.filter((w: string) => !w.includes('失败'))?.length &&
                         !combinedReport.coherenceCheck?.issues?.length &&
                         (!combinedReport.volumeProgressResult || (combinedReport.volumeProgressResult.wordCountIssues.length === 0 && combinedReport.volumeProgressResult.rhythmIssues.length === 0)) && (
                          <div className="flex flex-col items-center gap-3 p-8 bg-gradient-to-br from-green-50 via-emerald-50/30 to-transparent dark:from-green-950/40 dark:via-emerald-950/10 dark:to-transparent border border-green-200/60 dark:border-green-800/30 rounded-xl">
                            <CheckCircle className="h-12 w-12 text-green-500" />
                            <div className="text-center space-y-1">
                              <p className="text-base font-medium text-green-700 dark:text-green-300">质量检查全部通过 ✨</p>
                              <p className="text-sm text-green-600/80 dark:text-green-400/80">角色一致性、章节连贯性和卷完成度均未发现问题。</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {(combinedReport.characterCheck?.conflicts?.length > 0 ||
                     combinedReport.coherenceCheck?.issues?.some((i: any) => i.severity === 'error') ||
                     (combinedReport.volumeProgressResult && combinedReport.volumeProgressResult.score < 60)) && (
                      <aside className="pt-3 border-t text-center">
                        <p className="text-xs text-muted-foreground flex items-center justify-center gap-1.5">
                          <Zap className="h-3.5 w-3.5 text-blue-500" />
                          发现以上问题，建议根据报告进行优化
                        </p>
                      </aside>
                    )}
                  </div>
                ) : (
                  <div className="py-16 text-center">
                    <p className="text-sm text-muted-foreground">暂无报告数据</p>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-shrink-0 px-6 py-4 border-t bg-muted/30 rounded-b-xl gap-3">
            <AlertDialogCancel className="h-9">关闭</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 连贯性检查报告对话框 */}
      <AlertDialog open={coherenceDialogOpen} onOpenChange={setCoherenceDialogOpen}>
        <AlertDialogContent className="w-[90vw] max-w-3xl max-h-[85vh] flex flex-col rounded-xl shadow-2xl">
          <AlertDialogHeader className="flex-shrink-0 px-6 pt-6 pb-4 border-b space-y-0 gap-0">
            <div className="flex items-center justify-between">
              <AlertDialogTitle className="text-lg font-semibold text-left">连贯性检查报告</AlertDialogTitle>
              {coherenceFromCache && coherenceCachedAt && (
                <span className="text-xs text-muted-foreground">上次检查：{formatTimeAgo(coherenceCachedAt)}</span>
              )}
            </div>
            <AlertDialogDescription asChild>
              <div className="text-left mt-3 overflow-y-auto max-h-[60vh] pr-2">
                {coherenceChecking ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-3">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <span className="text-sm text-muted-foreground">正在执行连贯性检查...</span>
                  </div>
                ) : coherenceReport ? (
                  <div className="space-y-5">
                    <div className="flex items-center justify-between p-4 bg-gradient-to-r from-muted/80 to-muted/40 rounded-xl border">
                      <div className="flex items-baseline gap-4">
                        <span className="text-sm font-medium text-muted-foreground">评分</span>
                        <span className={`text-3xl font-bold tabular-nums ${
                          coherenceReport.score >= 80 ? 'text-green-600' :
                          coherenceReport.score >= 60 ? 'text-amber-600' : 'text-red-600'
                        }`}>
                          {coherenceReport.score}
                        </span>
                        <span className="text-lg text-muted-foreground">/100</span>
                      </div>
                      <Button variant="secondary" size="sm" className="gap-2 h-9 shadow-sm hover:shadow-md transition-shadow" onClick={handleCoherenceRecheck}>
                        <RefreshCw className="h-4 w-4" />重新生成报告
                      </Button>
                    </div>

                    <div className="overflow-y-auto max-h-[45vh] pr-2 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent rounded-lg">
                      <div className="space-y-5 pb-2">
                        {coherenceReport.issues.length > 0 ? (
                          coherenceReport.issues.map((issue: any, i: number) => (
                            <article key={`coh-report-${i}`} className={`p-3.5 rounded-lg border ${
                              issue.severity === 'error'
                                ? 'bg-gradient-to-br from-red-50 to-white dark:from-red-950/60 dark:to-transparent border-red-200/70 dark:border-red-800/40'
                                : 'bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/30 dark:to-transparent border-amber-200/60 dark:border-amber-800/30'
                            }`}>
                              <header className="flex items-center gap-2 mb-1.5">
                                {issue.severity === 'error' ? (
                                  <>
                                    <ShieldAlert className="h-4 w-4 text-red-500 shrink-0" />
                                    <strong className="text-sm text-red-700 dark:text-red-300">错误 {i + 1}</strong>
                                  </>
                                ) : (
                                  <>
                                    <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                                    <strong className="text-sm text-amber-700 dark:text-amber-300">警告 {i + 1}</strong>
                                  </>
                                )}
                                <Badge variant="secondary" className="text-[10px] ml-auto h-5">{issue.category || '其他'}</Badge>
                              </header>
                              <p className={`text-[13px] leading-relaxed ${
                                issue.severity === 'error'
                                  ? 'text-red-600/90 dark:text-red-400/90'
                                  : 'text-amber-700/90 dark:text-amber-300/90'
                              }`}>{issue.message}</p>
                              {issue.suggestion && (
                                <footer className="mt-2 ml-4 text-xs text-muted-foreground flex items-start gap-1.5">
                                  <span>💡 建议：</span>
                                  <span>{issue.suggestion}</span>
                                </footer>
                              )}
                            </article>
                          ))
                        ) : (
                          <div className="flex flex-col items-center gap-3 p-8 bg-gradient-to-br from-green-50 via-emerald-50/30 to-transparent dark:from-green-950/40 dark:via-emerald-950/10 dark:to-transparent border border-green-200/60 dark:border-green-800/30 rounded-xl">
                            <CheckCircle className="h-12 w-12 text-green-500" />
                            <div className="text-center space-y-1">
                              <p className="text-base font-medium text-green-700 dark:text-green-300">连贯性检查通过 ✨</p>
                              <p className="text-sm text-green-600/80 dark:text-green-400/80">章节连贯性未发现问题。</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="py-16 text-center">
                    <p className="text-sm text-muted-foreground">暂无报告数据</p>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-shrink-0 px-6 py-4 border-t bg-muted/30 rounded-b-xl gap-3">
            <AlertDialogCancel className="h-9">关闭</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 角色一致性检查报告对话框 */}
      <AlertDialog open={characterDialogOpen} onOpenChange={setCharacterDialogOpen}>
        <AlertDialogContent className="w-[90vw] max-w-3xl max-h-[85vh] flex flex-col rounded-xl shadow-2xl">
          <AlertDialogHeader className="flex-shrink-0 px-6 pt-6 pb-4 border-b space-y-0 gap-0">
            <div className="flex items-center justify-between">
              <AlertDialogTitle className="text-lg font-semibold text-left">角色一致性检查报告</AlertDialogTitle>
              {characterFromCache && characterCachedAt && (
                <span className="text-xs text-muted-foreground">上次检查：{formatTimeAgo(characterCachedAt)}</span>
              )}
            </div>
            <AlertDialogDescription asChild>
              <div className="text-left mt-3 overflow-y-auto max-h-[60vh] pr-2">
                {characterChecking ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-3">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <span className="text-sm text-muted-foreground">正在执行角色一致性检查...</span>
                  </div>
                ) : characterReport ? (
                  <div className="space-y-5">
                    <div className="flex items-center justify-between p-4 bg-gradient-to-r from-muted/80 to-muted/40 rounded-xl border">
                      <div className="flex items-baseline gap-4">
                        <span className="text-sm font-medium text-muted-foreground">冲突</span>
                        <span className={`text-3xl font-bold tabular-nums ${
                          (characterReport.conflicts?.length || 0) === 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {characterReport.conflicts?.length || 0}
                        </span>
                        <span className="text-lg text-muted-foreground">个</span>
                      </div>
                      <Button variant="secondary" size="sm" className="gap-2 h-9 shadow-sm hover:shadow-md transition-shadow" onClick={handleCharacterRecheck}>
                        <RefreshCw className="h-4 w-4" />重新生成报告
                      </Button>
                    </div>

                    <div className="overflow-y-auto max-h-[45vh] pr-2 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent rounded-lg">
                      <div className="space-y-5 pb-2">
                        {(characterReport.conflicts?.length > 0 || characterReport.warnings?.filter((w: string) => !w.includes('失败')).length > 0) ? (
                          <>
                            {characterReport.conflicts?.map((conflict: any, i: number) => (
                              <article key={`char-report-c-${i}`} className="group p-3.5 bg-gradient-to-br from-red-50 to-white dark:from-red-950/60 dark:to-transparent border border-red-200/70 dark:border-red-800/40 rounded-lg hover:shadow-md transition-shadow">
                                <header className="flex items-center gap-2 mb-2">
                                  <ShieldAlert className="h-4 w-4 text-red-500 shrink-0" />
                                  <strong className="text-sm text-red-700 dark:text-red-300">{conflict.characterName}</strong>
                                </header>
                                <p className="text-[13px] leading-relaxed text-red-600/90 dark:text-red-400/90 ml-6">{conflict.conflict}</p>
                                {conflict.excerpt && (
                                  <blockquote className="mt-2 ml-6 py-2.5 px-3 bg-red-100/50 dark:bg-red-900/20 rounded border-l-2 border-red-400 italic text-xs text-muted-foreground leading-relaxed">
                                    "{conflict.excerpt}"
                                  </blockquote>
                                )}
                              </article>
                            ))}
                            {characterReport.warnings?.filter((w: string) => !w.includes('失败')).map((warning: string, i: number) => (
                              <div key={`char-report-w-${i}`} className="flex items-start gap-3 p-3 bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-800/30 rounded-lg text-[13px] text-amber-800 dark:text-amber-200 leading-relaxed">
                                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
                                <span>{warning}</span>
                              </div>
                            ))}
                          </>
                        ) : (
                          <div className="flex flex-col items-center gap-3 p-8 bg-gradient-to-br from-green-50 via-emerald-50/30 to-transparent dark:from-green-950/40 dark:via-emerald-950/10 dark:to-transparent border border-green-200/60 dark:border-green-800/30 rounded-xl">
                            <CheckCircle className="h-12 w-12 text-green-500" />
                            <div className="text-center space-y-1">
                              <p className="text-base font-medium text-green-700 dark:text-green-300">角色一致性检查通过 ✨</p>
                              <p className="text-sm text-green-600/80 dark:text-green-400/80">角色设定与章节内容一致。</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="py-16 text-center">
                    <p className="text-sm text-muted-foreground">暂无报告数据</p>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-shrink-0 px-6 py-4 border-t bg-muted/30 rounded-b-xl gap-3">
            <AlertDialogCancel className="h-9">关闭</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 卷进度检查报告对话框 */}
      <AlertDialog open={volumeDialogOpen} onOpenChange={setVolumeDialogOpen}>
        <AlertDialogContent className="w-[90vw] max-w-3xl max-h-[85vh] flex flex-col rounded-xl shadow-2xl">
          <AlertDialogHeader className="flex-shrink-0 px-6 pt-6 pb-4 border-b space-y-0 gap-0">
            <div className="flex items-center justify-between">
              <AlertDialogTitle className="text-lg font-semibold text-left">卷进度检查报告</AlertDialogTitle>
              {volumeFromCache && volumeCachedAt && (
                <span className="text-xs text-muted-foreground">上次检查：{formatTimeAgo(volumeCachedAt)}</span>
              )}
            </div>
            <AlertDialogDescription asChild>
              <div className="text-left mt-3 overflow-y-auto max-h-[45vh] pr-2 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent rounded-lg">
                {volumeChecking ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-3">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <span className="text-sm text-muted-foreground">正在执行卷进度检查...</span>
                  </div>
                ) : volumeReport ? (
                  <div className="space-y-5 pb-2">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-4 bg-gradient-to-br from-muted/80 to-muted/40 rounded-xl border">
                        <div className="text-xs text-muted-foreground mb-1">当前章节</div>
                        <div className="text-2xl font-bold">第 {volumeReport.currentChapter || '-'} 章</div>
                      </div>
                      <div className="p-4 bg-gradient-to-br from-muted/80 to-muted/40 rounded-xl border">
                        <div className="text-xs text-muted-foreground mb-1">目标章节</div>
                        <div className="text-2xl font-bold">{volumeReport.targetChapter ? `${volumeReport.targetChapter} 章` : '未设定'}</div>
                      </div>
                      <div className="p-4 bg-gradient-to-br from-muted/80 to-muted/40 rounded-xl border">
                        <div className="text-xs text-muted-foreground mb-1">当前字数</div>
                        <div className="text-2xl font-bold">{volumeReport.currentWordCount ? `${(volumeReport.currentWordCount / 10000).toFixed(1)} 万` : '-'}</div>
                      </div>
                      <div className="p-4 bg-gradient-to-br from-muted/80 to-muted/40 rounded-xl border">
                        <div className="text-xs text-muted-foreground mb-1">目标字数</div>
                        <div className="text-2xl font-bold">{volumeReport.targetWordCount ? `${(volumeReport.targetWordCount / 10000).toFixed(0)} 万` : '未设定'}</div>
                      </div>
                    </div>

                    {(volumeReport.targetChapter || volumeReport.targetWordCount) && (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="p-3 bg-muted/50 rounded-lg">
                          <div className="text-xs text-muted-foreground mb-1">章节进度</div>
                          <div className="text-lg font-semibold">{volumeReport.chapterProgress?.toFixed(1) || '0'}%</div>
                          <div className="mt-1 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full transition-all"
                              style={{ width: `${Math.min(volumeReport.chapterProgress || 0, 100)}%` }}
                            />
                          </div>
                        </div>
                        <div className="p-3 bg-muted/50 rounded-lg">
                          <div className="text-xs text-muted-foreground mb-1">字数进度</div>
                          <div className="text-lg font-semibold">{volumeReport.wordProgress?.toFixed(1) || '0'}%</div>
                          <div className="mt-1 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full transition-all"
                              style={{ width: `${Math.min(volumeReport.wordProgress || 0, 100)}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 双评分区 */}
                    <div className="flex gap-3">
                      <div className="flex-1 p-4 bg-blue-50 dark:bg-blue-950/30 rounded-xl border border-blue-200 dark:border-blue-800 text-center">
                        <div className="text-[11px] text-muted-foreground mb-1">字数健康度</div>
                        <div className={`text-2xl font-bold ${volumeReport.wordCountScore >= 80 ? 'text-green-600' : volumeReport.wordCountScore >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                          {volumeReport.wordCountScore}
                        </div>
                        <div className="text-[10px] text-muted-foreground">/100</div>
                        {volumeReport.wordCountIssues.length > 0 && (
                          <div className="text-[10px] text-muted-foreground mt-1">
                            {volumeReport.wordCountIssues.filter((i: any) => i.severity === 'error').length}个严重，{volumeReport.wordCountIssues.filter((i: any) => i.severity === 'warning').length}个轻微
                          </div>
                        )}
                      </div>
                      <div className="flex-1 p-4 bg-purple-50 dark:bg-purple-950/30 rounded-xl border border-purple-200 dark:border-purple-800 text-center">
                        <div className="text-[11px] text-muted-foreground mb-1">节奏健康度</div>
                        <div className={`text-2xl font-bold ${volumeReport.rhythmScore >= 80 ? 'text-green-600' : volumeReport.rhythmScore >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                          {volumeReport.rhythmScore}
                        </div>
                        <div className="text-[10px] text-muted-foreground">/100</div>
                        {volumeReport.rhythmIssues.length > 0 && (
                          <div className="text-[10px] text-muted-foreground mt-1">
                            {volumeReport.rhythmIssues.filter((i: any) => i.severity === 'error').length}个严重，{volumeReport.rhythmIssues.filter((i: any) => i.severity === 'warning').length}个轻微
                          </div>
                        )}
                      </div>
                      <div className="flex-1 p-4 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/50 dark:to-indigo-950/30 rounded-xl border border-blue-300 dark:border-blue-700 text-center">
                        <div className="text-[11px] text-muted-foreground mb-1">综合评分</div>
                        <div className={`text-2xl font-bold ${volumeReport.score >= 80 ? 'text-green-600' : volumeReport.score >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                          {volumeReport.score}
                        </div>
                        <div className="text-[10px] text-muted-foreground">/100</div>
                      </div>
                    </div>

                    {/* 字数风险列表 */}
                    {volumeReport.wordCountIssues.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-blue-600 flex items-center gap-1">
                          <FileText className="h-3.5 w-3.5" />
                          字数风险 ({volumeReport.wordCountIssues.length})
                        </p>
                        {volumeReport.wordCountIssues.map((issue: any, i: number) => (
                          <div key={`wc-${i}`} className={`p-3 rounded-lg border text-xs ${issue.severity === 'error' ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800' : 'bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-800'}`}>
                            <div className="flex items-center gap-2 mb-1">
                              <AlertTriangle className={`h-4 w-4 shrink-0 ${issue.severity === 'error' ? 'text-red-500' : 'text-yellow-500'}`} />
                              <span className="font-medium">第{issue.chapterNumber}章「{issue.chapterTitle}」</span>
                              <Badge variant="outline" className={`ml-auto text-[10px] h-4 ${issue.severity === 'error' ? 'border-red-300 text-red-600' : 'border-yellow-300 text-yellow-600'}`}>
                                {issue.severity === 'error' ? '严重' : '轻微'}
                              </Badge>
                            </div>
                            <p className="text-muted-foreground pl-6">{issue.message}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* 节奏风险列表 */}
                    {volumeReport.rhythmIssues.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-purple-600 flex items-center gap-1">
                          <AlignLeft className="h-3.5 w-3.5" />
                          节奏风险 ({volumeReport.rhythmIssues.length})
                        </p>
                        {volumeReport.rhythmIssues.map((issue: any, i: number) => (
                          <div key={`rh-${i}`} className={`p-3 rounded-lg border text-xs ${issue.severity === 'error' ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800' : 'bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-800'}`}>
                            <div className="flex items-center gap-2 mb-1">
                              <AlertTriangle className={`h-4 w-4 shrink-0 ${issue.severity === 'error' ? 'text-red-500' : 'text-yellow-500'}`} />
                              <span className="font-medium">第{issue.chapterNumber}章「{issue.chapterTitle}」</span>
                              <Badge className={`ml-auto text-[10px] h-4 ${issue.severity === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'}`}>
                                {issue.dimension}
                              </Badge>
                            </div>
                            <p className="text-muted-foreground pl-6">{issue.deviation}</p>
                            {issue.suggestion && (
                              <p className="text-blue-600 dark:text-blue-400 pl-6 mt-1">调整建议：{issue.suggestion}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {volumeReport.diagnosis && (
                      <div className="p-4 bg-muted/30 rounded-lg text-sm">
                        <div className="text-xs text-muted-foreground mb-1">诊断：</div>
                        <p className="text-foreground">{volumeReport.diagnosis}</p>
                      </div>
                    )}

                    {volumeReport.suggestion && (
                      <div className="p-4 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg text-sm">
                        <div className="text-blue-700 dark:text-blue-300 font-medium mb-1">建议：</div>
                        <p className="text-blue-600 dark:text-blue-400">{volumeReport.suggestion}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="py-16 text-center">
                    <p className="text-sm text-muted-foreground">暂无报告数据</p>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-shrink-0 px-6 py-4 border-t bg-muted/30 rounded-b-xl gap-3">
            <Button variant="secondary" size="sm" className="gap-2 h-9 shadow-sm hover:shadow-md transition-shadow" onClick={handleVolumeRecheck}>
              <RefreshCw className="h-4 w-4" />重新检查
            </Button>
            <AlertDialogCancel className="h-9">关闭</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 历史报告详情对话框 */}
      <AlertDialog open={historyReportDialogOpen} onOpenChange={setHistoryReportDialogOpen}>
        <AlertDialogContent className="w-[90vw] max-w-3xl max-h-[85vh] flex flex-col rounded-xl shadow-2xl">
          <AlertDialogHeader className="flex-shrink-0 px-6 pt-6 pb-4 border-b space-y-0 gap-0">
            <div className="flex items-center justify-between">
              <AlertDialogTitle className="text-lg font-semibold text-left">
                检查报告详情
                <Badge variant="outline" className="ml-2 text-[10px]">
                  {selectedHistoryLog?.checkType === 'character_consistency' && '角色一致性'}
                  {selectedHistoryLog?.checkType === 'chapter_coherence' && '章节连贯性'}
                  {selectedHistoryLog?.checkType === 'combined' && '综合检查'}
                  {selectedHistoryLog?.checkType === 'volume_progress' && '卷完成程度'}
                </Badge>
              </AlertDialogTitle>
              {selectedHistoryLog?.createdAt && (
                <span className="text-xs text-muted-foreground">
                  检查时间：{new Date(selectedHistoryLog.createdAt * 1000).toLocaleString('zh-CN')}
                </span>
              )}
            </div>
            <AlertDialogDescription asChild>
              <div className="text-left mt-3 overflow-y-auto max-h-[60vh] pr-2">
                {selectedHistoryLog ? (
                  <div className="space-y-5">
                    <div className="flex items-center justify-between p-4 bg-gradient-to-r from-muted/80 to-muted/40 rounded-xl border">
                      <div className="flex items-baseline gap-4">
                        <span className="text-sm font-medium text-muted-foreground">评分</span>
                        <span className={`text-3xl font-bold tabular-nums ${
                          selectedHistoryLog.score >= 80 ? 'text-green-600' :
                          selectedHistoryLog.score >= 60 ? 'text-amber-600' : 'text-red-600'
                        }`}>
                          {selectedHistoryLog.score}
                        </span>
                        <span className="text-lg text-muted-foreground">/100</span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {selectedHistoryLog.issuesCount > 0 ? `${selectedHistoryLog.issuesCount}个问题` : '✓ 通过'}
                      </span>
                    </div>

                    <div className="overflow-y-auto max-h-[45vh] pr-2 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent rounded-lg">
                      <div className="space-y-5 pb-2">
                        {selectedHistoryLog.checkType === 'character_consistency' && selectedHistoryLog.characterResult && (
                          <section className="space-y-3">
                            <header className="flex items-center gap-2.5 pb-2 border-b border-red-200/50 dark:border-red-800/30">
                              <Shield className="h-4 w-4 text-destructive" />
                              <h3 className="text-sm font-semibold uppercase tracking-wide">角色一致性检查</h3>
                            </header>
                            <div className="space-y-2 pl-1">
                              {selectedHistoryLog.characterResult.conflicts?.length > 0 ? (
                                selectedHistoryLog.characterResult.conflicts.map((conflict: any, i: number) => (
                                  <article key={`hist-char-c-${i}`} className="group p-3.5 bg-gradient-to-br from-red-50 to-white dark:from-red-950/60 dark:to-transparent border border-red-200/70 dark:border-red-800/40 rounded-lg hover:shadow-md transition-shadow">
                                    <header className="flex items-center gap-2 mb-2">
                                      <ShieldAlert className="h-4 w-4 text-red-500 shrink-0" />
                                      <strong className="text-sm text-red-700 dark:text-red-300">{conflict.characterName}</strong>
                                    </header>
                                    <p className="text-[13px] leading-relaxed text-red-600/90 dark:text-red-400/90 ml-6">{conflict.conflict}</p>
                                    {conflict.excerpt && (
                                      <blockquote className="mt-2 ml-6 py-2.5 px-3 bg-red-100/50 dark:bg-red-900/20 rounded border-l-2 border-red-400 italic text-xs text-muted-foreground leading-relaxed">
                                        "{conflict.excerpt}"
                                      </blockquote>
                                    )}
                                  </article>
                                ))
                              ) : (
                                <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded">
                                  <CheckCircle className="h-4 w-4 text-green-600" />
                                  <span className="text-xs text-green-700 dark:text-green-300">角色一致性检查通过</span>
                                </div>
                              )}
                              {selectedHistoryLog.characterResult.warnings?.filter((w: string) => !w.includes('失败')).map((warning: string, i: number) => (
                                <div key={`hist-char-w-${i}`} className="flex items-start gap-3 p-3 bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-800/30 rounded-lg text-[13px] text-amber-800 dark:text-amber-200 leading-relaxed">
                                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
                                  <span>{warning}</span>
                                </div>
                              ))}
                            </div>
                          </section>
                        )}

                        {selectedHistoryLog.checkType === 'chapter_coherence' && selectedHistoryLog.coherenceResult && (
                          <section className="space-y-3">
                            <header className="flex items-center gap-2.5 pb-2 border-b border-amber-200/50 dark:border-amber-800/30">
                              <Link className="h-4 w-4 text-amber-600" />
                              <h3 className="text-sm font-semibold uppercase tracking-wide">章节连贯性检查</h3>
                              <Badge variant="outline" className="ml-auto text-[11px] h-5">
                                {selectedHistoryLog.coherenceResult.score}分 · {selectedHistoryLog.coherenceResult.issues?.length || 0}个问题
                              </Badge>
                            </header>
                            <div className="space-y-2 pl-1">
                              {selectedHistoryLog.coherenceResult.issues?.length > 0 ? (
                                selectedHistoryLog.coherenceResult.issues.map((issue: any, i: number) => (
                                  <article key={`hist-coh-${i}`} className={`p-3.5 rounded-lg border ${
                                    issue.severity === 'error'
                                      ? 'bg-gradient-to-br from-red-50 to-white dark:from-red-950/60 dark:to-transparent border-red-200/70 dark:border-red-800/40'
                                      : 'bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/30 dark:to-transparent border-amber-200/60 dark:border-amber-800/30'
                                  }`}>
                                    <header className="flex items-center gap-2 mb-1.5">
                                      {issue.severity === 'error' ? (
                                        <>
                                          <ShieldAlert className="h-4 w-4 text-red-500 shrink-0" />
                                          <strong className="text-sm text-red-700 dark:text-red-300">错误 {i + 1}</strong>
                                        </>
                                      ) : (
                                        <>
                                          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                                          <strong className="text-sm text-amber-700 dark:text-amber-300">警告 {i + 1}</strong>
                                        </>
                                      )}
                                      <Badge variant="secondary" className="text-[10px] ml-auto h-5">{issue.category || '其他'}</Badge>
                                    </header>
                                    <p className={`text-[13px] leading-relaxed ${
                                      issue.severity === 'error'
                                        ? 'text-red-600/90 dark:text-red-400/90'
                                        : 'text-amber-700/90 dark:text-amber-300/90'
                                    }`}>{issue.message}</p>
                                    {issue.suggestion && (
                                      <footer className="mt-2 ml-4 text-xs text-muted-foreground flex items-start gap-1.5">
                                        <span>💡 建议：</span>
                                        <span>{issue.suggestion}</span>
                                      </footer>
                                    )}
                                  </article>
                                ))
                              ) : (
                                <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded">
                                  <CheckCircle className="h-4 w-4 text-green-600" />
                                  <span className="text-xs text-green-700 dark:text-green-300">章节连贯性检查通过</span>
                                </div>
                              )}
                            </div>
                          </section>
                        )}

                        {selectedHistoryLog.checkType === 'combined' && selectedHistoryLog.characterResult && selectedHistoryLog.coherenceResult && (
                          <>
                            <section className="space-y-3">
                              <header className="flex items-center gap-2.5 pb-2 border-b border-red-200/50 dark:border-red-800/30">
                                <Shield className="h-4 w-4 text-destructive" />
                                <h3 className="text-sm font-semibold uppercase tracking-wide">角色一致性检查</h3>
                                <Badge variant="destructive" className="ml-auto text-[11px] h-5">
                                  {selectedHistoryLog.characterResult.conflicts?.length > 0
                                    ? `${selectedHistoryLog.characterResult.conflicts.length} 个冲突`
                                    : '通过'}
                                </Badge>
                              </header>
                              <div className="space-y-2 pl-1">
                                {selectedHistoryLog.characterResult.conflicts?.map((conflict: any, i: number) => (
                                  <article key={`hist-comb-char-${i}`} className="group p-3.5 bg-gradient-to-br from-red-50 to-white dark:from-red-950/60 dark:to-transparent border border-red-200/70 dark:border-red-800/40 rounded-lg hover:shadow-md transition-shadow">
                                    <header className="flex items-center gap-2 mb-2">
                                      <ShieldAlert className="h-4 w-4 text-red-500 shrink-0" />
                                      <strong className="text-sm text-red-700 dark:text-red-300">{conflict.characterName}</strong>
                                    </header>
                                    <p className="text-[13px] leading-relaxed text-red-600/90 dark:text-red-400/90 ml-6">{conflict.conflict}</p>
                                    {conflict.excerpt && (
                                      <blockquote className="mt-2 ml-6 py-2.5 px-3 bg-red-100/50 dark:bg-red-900/20 rounded border-l-2 border-red-400 italic text-xs text-muted-foreground leading-relaxed">
                                        "{conflict.excerpt}"
                                      </blockquote>
                                    )}
                                  </article>
                                ))}
                                {selectedHistoryLog.characterResult.warnings?.filter((w: string) => !w.includes('失败')).map((warning: string, i: number) => (
                                  <div key={`hist-comb-char-w-${i}`} className="flex items-start gap-3 p-3 bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-800/30 rounded-lg text-[13px] text-amber-800 dark:text-amber-200 leading-relaxed">
                                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
                                    <span>{warning}</span>
                                  </div>
                                ))}
                                {!selectedHistoryLog.characterResult.conflicts?.length &&
                                 !selectedHistoryLog.characterResult.warnings?.filter((w: string) => !w.includes('失败')).length && (
                                  <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded">
                                    <CheckCircle className="h-4 w-4 text-green-600" />
                                    <span className="text-xs text-green-700 dark:text-green-300">角色一致性检查通过</span>
                                  </div>
                                )}
                              </div>
                            </section>

                            <section className="space-y-3">
                              <header className="flex items-center gap-2.5 pb-2 border-b border-amber-200/50 dark:border-amber-800/30">
                                <Link className="h-4 w-4 text-amber-600" />
                                <h3 className="text-sm font-semibold uppercase tracking-wide">章节连贯性检查</h3>
                                <Badge variant="outline" className="ml-auto text-[11px] h-5">
                                  {selectedHistoryLog.coherenceResult.score}分 · {selectedHistoryLog.coherenceResult.issues?.length || 0}个问题
                                </Badge>
                              </header>
                              <div className="space-y-2 pl-1">
                                {selectedHistoryLog.coherenceResult.issues?.map((issue: any, i: number) => (
                                  <article key={`hist-comb-coh-${i}`} className={`p-3.5 rounded-lg border ${
                                    issue.severity === 'error'
                                      ? 'bg-gradient-to-br from-red-50 to-white dark:from-red-950/60 dark:to-transparent border-red-200/70 dark:border-red-800/40'
                                      : 'bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/30 dark:to-transparent border-amber-200/60 dark:border-amber-800/30'
                                  }`}>
                                    <header className="flex items-center gap-2 mb-1.5">
                                      {issue.severity === 'error' ? (
                                        <>
                                          <ShieldAlert className="h-4 w-4 text-red-500 shrink-0" />
                                          <strong className="text-sm text-red-700 dark:text-red-300">错误 {i + 1}</strong>
                                        </>
                                      ) : (
                                        <>
                                          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                                          <strong className="text-sm text-amber-700 dark:text-amber-300">警告 {i + 1}</strong>
                                        </>
                                      )}
                                      <Badge variant="secondary" className="text-[10px] ml-auto h-5">{issue.category || '其他'}</Badge>
                                    </header>
                                    <p className={`text-[13px] leading-relaxed ${
                                      issue.severity === 'error'
                                        ? 'text-red-600/90 dark:text-red-400/90'
                                        : 'text-amber-700/90 dark:text-amber-300/90'
                                    }`}>{issue.message}</p>
                                    {issue.suggestion && (
                                      <footer className="mt-2 ml-4 text-xs text-muted-foreground flex items-start gap-1.5">
                                        <span>💡 建议：</span>
                                        <span>{issue.suggestion}</span>
                                      </footer>
                                    )}
                                  </article>
                                ))}
                                {!selectedHistoryLog.coherenceResult.issues?.length && (
                                  <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded">
                                    <CheckCircle className="h-4 w-4 text-green-600" />
                                    <span className="text-xs text-green-700 dark:text-green-300">章节连贯性检查通过</span>
                                  </div>
                                )}
                              </div>
                            </section>

                            {selectedHistoryLog.volumeProgressResult && (
                              <section className="space-y-3">
                                <header className="flex items-center gap-2.5 pb-2 border-b border-blue-200/50 dark:border-blue-800/30">
                                  <Target className="h-4 w-4 text-blue-600" />
                                  <h3 className="text-sm font-semibold uppercase tracking-wide">卷完成度检查</h3>
                                  <Badge className={`ml-auto text-[11px] h-5 ${
                                    selectedHistoryLog.volumeProgressResult.score >= 80
                                      ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                                      : selectedHistoryLog.volumeProgressResult.score >= 60
                                      ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'
                                      : 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
                                  }`}>
                                    {selectedHistoryLog.volumeProgressResult.score}分
                                  </Badge>
                                </header>
                                <div className="space-y-2 pl-1">
                                  <div className="grid grid-cols-2 gap-2 text-xs">
                                    <div className="p-2 bg-muted/30 rounded">
                                      <span className="text-muted-foreground">当前章节：</span>
                                      <span className="font-medium ml-1">第 {selectedHistoryLog.volumeProgressResult.currentChapter || '-'} 章</span>
                                    </div>
                                    <div className="p-2 bg-muted/30 rounded">
                                      <span className="text-muted-foreground">目标章节：</span>
                                      <span className="font-medium ml-1">{selectedHistoryLog.volumeProgressResult.targetChapter ? `${selectedHistoryLog.volumeProgressResult.targetChapter} 章` : '未设定'}</span>
                                    </div>
                                  </div>
                                  <div className="flex gap-2">
                                    <div className="flex-1 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800 text-center">
                                      <div className="text-[10px] text-muted-foreground">字数健康度</div>
                                      <div className={`text-lg font-bold ${selectedHistoryLog.volumeProgressResult.wordCountScore >= 80 ? 'text-green-600' : selectedHistoryLog.volumeProgressResult.wordCountScore >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                                        {selectedHistoryLog.volumeProgressResult.wordCountScore}
                                      </div>
                                    </div>
                                    <div className="flex-1 p-3 bg-purple-50 dark:bg-purple-950/30 rounded-lg border border-purple-200 dark:border-purple-800 text-center">
                                      <div className="text-[10px] text-muted-foreground">节奏健康度</div>
                                      <div className={`text-lg font-bold ${selectedHistoryLog.volumeProgressResult.rhythmScore >= 80 ? 'text-green-600' : selectedHistoryLog.volumeProgressResult.rhythmScore >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                                        {selectedHistoryLog.volumeProgressResult.rhythmScore}
                                      </div>
                                    </div>
                                    <div className="flex-1 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-300 dark:border-blue-700 text-center">
                                      <div className="text-[10px] text-muted-foreground">综合</div>
                                      <div className={`text-lg font-bold ${selectedHistoryLog.volumeProgressResult.score >= 80 ? 'text-green-600' : selectedHistoryLog.volumeProgressResult.score >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                                        {selectedHistoryLog.volumeProgressResult.score}
                                      </div>
                                    </div>
                                  </div>
                                  {selectedHistoryLog.volumeProgressResult.wordCountIssues?.length > 0 && (
                                    <div className="space-y-1">
                                      <p className="text-xs font-medium text-blue-600">字数风险 ({selectedHistoryLog.volumeProgressResult.wordCountIssues.length})</p>
                                      {selectedHistoryLog.volumeProgressResult.wordCountIssues.map((issue: any, i: number) => (
                                        <div key={`hist-wc-${i}`} className={`p-2 rounded border text-xs ${issue.severity === 'error' ? 'bg-red-50 dark:bg-red-950/30 border-red-200' : 'bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200'}`}>
                                          <span className="font-medium">{issue.chapterTitle}</span>
                                          <span className="text-muted-foreground ml-2">{issue.message}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {selectedHistoryLog.volumeProgressResult.rhythmIssues?.length > 0 && (
                                    <div className="space-y-1">
                                      <p className="text-xs font-medium text-purple-600">节奏风险 ({selectedHistoryLog.volumeProgressResult.rhythmIssues.length})</p>
                                      {selectedHistoryLog.volumeProgressResult.rhythmIssues.map((issue: any, i: number) => (
                                        <div key={`hist-rh-${i}`} className={`p-2 rounded border text-xs ${issue.severity === 'error' ? 'bg-red-50 dark:bg-red-950/30 border-red-200' : 'bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200'}`}>
                                          <span className="font-medium">{issue.chapterTitle}</span>
                                          <Badge className={`ml-1 text-[10px] h-4 ${issue.severity === 'error' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>{issue.dimension}</Badge>
                                          <span className="text-muted-foreground ml-2">{issue.deviation}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {selectedHistoryLog.volumeProgressResult.diagnosis && (
                                    <div className="p-2.5 bg-muted/30 rounded text-xs">
                                      <span className="text-muted-foreground">诊断：</span>{selectedHistoryLog.volumeProgressResult.diagnosis}
                                    </div>
                                  )}
                                  {selectedHistoryLog.volumeProgressResult.suggestion && (
                                    <div className="p-2.5 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded text-xs text-blue-700 dark:text-blue-300">
                                      <span className="font-medium">建议：</span>{selectedHistoryLog.volumeProgressResult.suggestion}
                                    </div>
                                  )}
                                </div>
                              </section>
                            )}
                          </>
                        )}

                        {selectedHistoryLog.checkType === 'volume_progress' && selectedHistoryLog.volumeProgressResult && (
                          <section className="space-y-3">
                            <header className="flex items-center gap-2.5 pb-2 border-b border-blue-200/50 dark:border-blue-800/30">
                              <CheckCircle className="h-4 w-4 text-blue-600" />
                              <h3 className="text-sm font-semibold uppercase tracking-wide">卷完成程度检查</h3>
                            </header>
                            <div className="space-y-2 pl-1">
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                <div className="p-2 bg-muted/30 rounded">
                                  <span className="text-muted-foreground">当前章节：</span>
                                  <span className="font-medium ml-1">第 {selectedHistoryLog.volumeProgressResult.currentChapter || '-'} 章</span>
                                </div>
                                <div className="p-2 bg-muted/30 rounded">
                                  <span className="text-muted-foreground">目标章节：</span>
                                  <span className="font-medium ml-1">{selectedHistoryLog.volumeProgressResult.targetChapter ? `${selectedHistoryLog.volumeProgressResult.targetChapter} 章` : '未设定'}</span>
                                </div>
                                <div className="p-2 bg-muted/30 rounded">
                                  <span className="text-muted-foreground">当前字数：</span>
                                  <span className="font-medium ml-1">{selectedHistoryLog.volumeProgressResult.currentWordCount ? `${(selectedHistoryLog.volumeProgressResult.currentWordCount / 10000).toFixed(1)} 万` : '-'}</span>
                                </div>
                                <div className="p-2 bg-muted/30 rounded">
                                  <span className="text-muted-foreground">目标字数：</span>
                                  <span className="font-medium ml-1">{selectedHistoryLog.volumeProgressResult.targetWordCount ? `${(selectedHistoryLog.volumeProgressResult.targetWordCount / 10000).toFixed(0)} 万` : '未设定'}</span>
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <div className="flex-1 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800 text-center">
                                  <div className="text-[10px] text-muted-foreground">字数健康度</div>
                                  <div className={`text-lg font-bold ${selectedHistoryLog.volumeProgressResult.wordCountScore >= 80 ? 'text-green-600' : selectedHistoryLog.volumeProgressResult.wordCountScore >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                                    {selectedHistoryLog.volumeProgressResult.wordCountScore}
                                  </div>
                                </div>
                                <div className="flex-1 p-3 bg-purple-50 dark:bg-purple-950/30 rounded-lg border border-purple-200 dark:border-purple-800 text-center">
                                  <div className="text-[10px] text-muted-foreground">节奏健康度</div>
                                  <div className={`text-lg font-bold ${selectedHistoryLog.volumeProgressResult.rhythmScore >= 80 ? 'text-green-600' : selectedHistoryLog.volumeProgressResult.rhythmScore >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                                    {selectedHistoryLog.volumeProgressResult.rhythmScore}
                                  </div>
                                </div>
                                <div className="flex-1 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-300 dark:border-blue-700 text-center">
                                  <div className="text-[10px] text-muted-foreground">综合评分</div>
                                  <div className={`text-lg font-bold ${selectedHistoryLog.volumeProgressResult.score >= 80 ? 'text-green-600' : selectedHistoryLog.volumeProgressResult.score >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                                    {selectedHistoryLog.volumeProgressResult.score}
                                  </div>
                                </div>
                              </div>
                              {selectedHistoryLog.volumeProgressResult.wordCountIssues?.length > 0 && (
                                <div className="space-y-1.5">
                                  <p className="text-xs font-medium text-blue-600">字数风险 ({selectedHistoryLog.volumeProgressResult.wordCountIssues.length})</p>
                                  {selectedHistoryLog.volumeProgressResult.wordCountIssues.map((issue: any, i: number) => (
                                    <div key={`wc-${i}`} className={`p-2 rounded border text-xs ${issue.severity === 'error' ? 'bg-red-50 dark:bg-red-950/30 border-red-200' : 'bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200'}`}>
                                      <span className="font-medium">第{issue.chapterNumber}章「{issue.chapterTitle}」</span>
                                      <span className="text-muted-foreground ml-2">{issue.message}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {selectedHistoryLog.volumeProgressResult.rhythmIssues?.length > 0 && (
                                <div className="space-y-1.5">
                                  <p className="text-xs font-medium text-purple-600">节奏风险 ({selectedHistoryLog.volumeProgressResult.rhythmIssues.length})</p>
                                  {selectedHistoryLog.volumeProgressResult.rhythmIssues.map((issue: any, i: number) => (
                                    <div key={`rh-${i}`} className={`p-2 rounded border text-xs ${issue.severity === 'error' ? 'bg-red-50 dark:bg-red-950/30 border-red-200' : 'bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200'}`}>
                                      <span className="font-medium">第{issue.chapterNumber}章「{issue.chapterTitle}」</span>
                                      <Badge className={`ml-1 text-[10px] h-4 ${issue.severity === 'error' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>{issue.dimension}</Badge>
                                      <span className="text-muted-foreground ml-2">{issue.deviation}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {selectedHistoryLog.volumeProgressResult.diagnosis && (
                                <div className="p-3 bg-muted/30 rounded text-xs">
                                  <span className="text-muted-foreground">诊断：</span>{selectedHistoryLog.volumeProgressResult.diagnosis}
                                </div>
                              )}
                              {selectedHistoryLog.volumeProgressResult.suggestion && (
                                <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded text-xs text-blue-700 dark:text-blue-300">
                                  <span className="font-medium">建议：</span>{selectedHistoryLog.volumeProgressResult.suggestion}
                                </div>
                              )}
                            </div>
                          </section>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="py-16 text-center">
                    <p className="text-sm text-muted-foreground">暂无报告数据</p>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-shrink-0 px-6 py-4 border-t bg-muted/30 rounded-b-xl gap-3">
            <AlertDialogCancel className="h-9">关闭</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
