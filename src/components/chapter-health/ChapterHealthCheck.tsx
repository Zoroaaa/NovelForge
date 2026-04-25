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

  const [combinedReport, setCombinedReport] = useState<{
    characterResult: any
    coherenceResult: any
    score: number
  } | null>(null)
  const [isChecking, setIsChecking] = useState(false)
  const [isFromCache, setIsFromCache] = useState(false)
  const [reportCachedAt, setReportCachedAt] = useState<number | null>(null)
  const [rewriteDialogOpen, setRewriteDialogOpen] = useState(false)
  const [coherenceResult, setCoherenceResult] = useState<CoherenceCheckResult | null>(null)
  const [coherenceCheckFailed, setCoherenceCheckFailed] = useState(false)

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
        setCombinedReport({
          characterResult: cachedData.log.characterResult,
          coherenceResult: cachedData.log.coherenceResult,
          score: cachedData.log.score,
        })
        setIsFromCache(true)
        setReportCachedAt(cachedData.log.createdAt)
        setIsChecking(false)
        return
      }

      const checkData = await api.generate.combinedCheck({ chapterId: chapterId!, novelId })

      setCombinedReport({
        characterResult: checkData.characterCheck,
        coherenceResult: checkData.coherenceCheck,
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
        characterResult: data.characterCheck,
        coherenceResult: data.coherenceCheck,
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
                    setCoherenceResult({
                      score: latestCheckLog.coherenceResult.score,
                      issues: latestCheckLog.coherenceResult.issues,
                    })
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
          <TabsTrigger value="combined" className="text-xs">综合检查</TabsTrigger>
          <TabsTrigger value="volume" className="text-xs">卷进度</TabsTrigger>
        </TabsList>

        <TabsContent value="coherence" className="mt-4">
          <ChapterCoherenceCheck novelId={novelId} chapterId={chapterId} onCheckComplete={(result) => {
            setCoherenceResult(result)
            loadLatestCheckLog()
          }} />
        </TabsContent>

        <TabsContent value="character" className="mt-4">
          <CharacterConsistencyCheck novelId={novelId} chapterId={chapterId} />
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
                    执行综合检查
                  </>
                )}
              </Button>
            </div>
            <CombinedCheck novelId={novelId} chapterId={chapterId} onCheckComplete={(result) => {
              if (result.coherenceCheck.issues.length > 0) {
                setCoherenceResult({
                  score: result.coherenceCheck.score,
                  issues: result.coherenceCheck.issues,
                })
              }
              setCombinedReport({
                characterResult: result.characterCheck,
                coherenceResult: result.coherenceCheck,
                score: result.score,
              })
              loadLatestCheckLog()
            }} />
          </div>
        </TabsContent>

        <TabsContent value="volume" className="mt-4">
          <VolumeProgressCheck novelId={novelId} chapterId={chapterId} />
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
              <div className="text-left mt-3">
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
                        {(combinedReport.characterResult?.conflicts?.length > 0 || combinedReport.characterResult?.warnings?.length > 0) && (
                          <section className="space-y-3">
                            <header className="flex items-center gap-2.5 pb-2 border-b border-red-200/50 dark:border-red-800/30">
                              <Shield className="h-4 w-4 text-destructive" />
                              <h3 className="text-sm font-semibold uppercase tracking-wide">角色一致性检查</h3>
                              <Badge variant="destructive" className="ml-auto text-[11px] h-5">
                                {combinedReport.characterResult.conflicts.length > 0 
                                  ? `${combinedReport.characterResult.conflicts.length} 个冲突` 
                                  : '通过'}
                              </Badge>
                            </header>

                            <div className="space-y-2 pl-1">
                              {combinedReport.characterResult.conflicts.map((conflict: any, i: number) => (
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

                              {combinedReport.characterResult.warnings?.filter((w: string) => !w.includes('失败')).map((warning: string, i: number) => (
                                <div key={`char-w-${i}`} className="flex items-start gap-3 p-3 bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-800/30 rounded-lg text-[13px] text-amber-800 dark:text-amber-200 leading-relaxed">
                                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
                                  <span>{warning}</span>
                                </div>
                              ))}
                            </div>
                          </section>
                        )}

                        {/* 章节连贯性部分 */}
                        {combinedReport.coherenceResult?.issues?.length > 0 && (
                          <section className="space-y-3">
                            <header className="flex items-center gap-2.5 pb-2 border-b border-amber-200/50 dark:border-amber-800/30">
                              <Link className="h-4 w-4 text-amber-600" />
                              <h3 className="text-sm font-semibold uppercase tracking-wide">章节连贯性检查</h3>
                              <Badge variant="outline" className="ml-auto text-[11px] h-5">
                                {combinedReport.coherenceResult.score}分 · {combinedReport.coherenceResult.issues.length}个问题
                              </Badge>
                            </header>

                            <div className="space-y-2 pl-1">
                              {combinedReport.coherenceResult.issues.map((issue: any, i: number) => (
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

                        {/* 无问题提示 */}
                        {!combinedReport.characterResult?.conflicts?.length &&
                         !combinedReport.characterResult?.warnings?.filter((w: string) => !w.includes('失败'))?.length &&
                         !combinedReport.coherenceResult?.issues?.length && (
                          <div className="flex flex-col items-center gap-3 p-8 bg-gradient-to-br from-green-50 via-emerald-50/30 to-transparent dark:from-green-950/40 dark:via-emerald-950/10 dark:to-transparent border border-green-200/60 dark:border-green-800/30 rounded-xl">
                            <CheckCircle className="h-12 w-12 text-green-500" />
                            <div className="text-center space-y-1">
                              <p className="text-base font-medium text-green-700 dark:text-green-300">质量检查全部通过 ✨</p>
                              <p className="text-sm text-green-600/80 dark:text-green-400/80">角色一致性和章节连贯性均未发现问题。</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {(combinedReport.characterResult?.conflicts?.length > 0 ||
                     combinedReport.coherenceResult?.issues?.some((i: any) => i.severity === 'error')) && (
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
              <div className="text-left mt-3">
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
                          </>
                        )}

                        {selectedHistoryLog.checkType === 'volume_progress' && (
                          <section className="space-y-3">
                            <header className="flex items-center gap-2.5 pb-2 border-b border-blue-200/50 dark:border-blue-800/30">
                              <CheckCircle className="h-4 w-4 text-blue-600" />
                              <h3 className="text-sm font-semibold uppercase tracking-wide">卷完成程度检查</h3>
                            </header>
                            <div className="space-y-2 pl-1">
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                <div className="p-2 bg-muted/30 rounded">
                                  <span className="text-muted-foreground">当前章节：</span>
                                  <span className="font-medium ml-1">第 {selectedHistoryLog.coherenceResult?.currentChapter || '-'} 章</span>
                                </div>
                                <div className="p-2 bg-muted/30 rounded">
                                  <span className="text-muted-foreground">目标章节：</span>
                                  <span className="font-medium ml-1">{selectedHistoryLog.coherenceResult?.targetChapter || '未设定'} 章</span>
                                </div>
                                <div className="p-2 bg-muted/30 rounded">
                                  <span className="text-muted-foreground">当前字数：</span>
                                  <span className="font-medium ml-1">{selectedHistoryLog.coherenceResult?.currentWordCount ? `${(selectedHistoryLog.coherenceResult.currentWordCount / 10000).toFixed(1)} 万` : '-'}</span>
                                </div>
                                <div className="p-2 bg-muted/30 rounded">
                                  <span className="text-muted-foreground">目标字数：</span>
                                  <span className="font-medium ml-1">{selectedHistoryLog.coherenceResult?.targetWordCount ? `${(selectedHistoryLog.coherenceResult.targetWordCount / 10000).toFixed(0)} 万` : '未设定'}</span>
                                </div>
                              </div>
                              {selectedHistoryLog.coherenceResult?.suggestion && (
                                <div className="p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded text-xs">
                                  <div className="text-xs text-muted-foreground mb-1">AI 建议：</div>
                                  {selectedHistoryLog.coherenceResult.suggestion}
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
