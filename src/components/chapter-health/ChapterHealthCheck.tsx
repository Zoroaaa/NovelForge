/**
 * @file ChapterHealthCheck.tsx
 * @description 章节健康检查主入口组件，整合所有检查功能
 */
import { useState, useEffect, useCallback } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Loader2, Link, Shield, Target } from 'lucide-react'
import { api } from '@/lib/api'
import { CharacterConsistencyCheck } from './CharacterConsistencyCheck'
import { CombinedCheck } from './CombinedCheck'
import { VolumeProgressCheck } from './VolumeProgressCheck'
import { CheckSummary } from './CheckSummary'
import { CheckHistoryList } from './CheckHistoryList'
import { CombinedReportDialog } from './CombinedReportDialog'
import { CoherenceReportDialog } from './CoherenceReportDialog'
import { CharacterReportDialog } from './CharacterReportDialog'
import { VolumeReportDialog } from './VolumeReportDialog'
import { HistoryReportDialog } from './HistoryReportDialog'
import type { CheckLog, CombinedReport, RepairState } from './types'

interface ChapterHealthCheckProps {
  novelId: string
  chapterId: string | null
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
  const [latestCheckLog, setLatestCheckLog] = useState<CheckLog | null>(null)
  const [showCheckHistory, setShowCheckHistory] = useState(false)
  const [checkHistory, setCheckHistory] = useState<CheckLog[]>([])
  const [historyReportDialogOpen, setHistoryReportDialogOpen] = useState(false)
  const [selectedHistoryLog, setSelectedHistoryLog] = useState<CheckLog | null>(null)

  const [combinedReport, setCombinedReport] = useState<CombinedReport | null>(null)
  const [isChecking, setIsChecking] = useState(false)
  const [isFromCache, setIsFromCache] = useState(false)
  const [reportCachedAt, setReportCachedAt] = useState<number | null>(null)
  const [rewriteDialogOpen, setRewriteDialogOpen] = useState(false)
  const [coherenceResult, setCoherenceResult] = useState<{ score: number; issues: any[] } | null>(null)
  const [coherenceCheckFailed, setCoherenceCheckFailed] = useState(false)

  const [coherenceDialogOpen, setCoherenceDialogOpen] = useState(false)
  const [coherenceChecking, setCoherenceChecking] = useState(false)
  const [coherenceReport, setCoherenceReport] = useState<{ score: number; issues: any[] } | null>(null)
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

  const [repairing, setRepairing] = useState<string | null>(null)
  const [repairedContent, setRepairedContent] = useState<string | null>(null)
  const [repairError, setRepairError] = useState<string | null>(null)
  const [repairTarget, setRepairTarget] = useState<string | null>(null)
  const [applyingRepair, setApplyingRepair] = useState(false)
  const [applyRepairSuccess, setApplyRepairSuccess] = useState(false)

  const repairState: RepairState = {
    repairing,
    repairedContent,
    repairError,
    repairTarget,
    applyingRepair,
    applyRepairSuccess,
  }

  const loadLatestCheckLog = useCallback(async () => {
    try {
      const data = await api.generate.getCheckLogsLatest(chapterId!)
      if (data.log) {
        setLatestCheckLog(data.log as CheckLog)
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
      setCheckHistory((data.logs || []) as CheckLog[])
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
            characterCheck: cachedData.log.characterResult,
            coherenceCheck: cachedData.log.coherenceResult,
            volumeProgressCheck: cachedVolumeProgress,
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
            characterCheck: cachedData.log.characterResult,
            coherenceCheck: cachedData.log.coherenceResult,
            volumeProgressCheck: volumeProgressData.log.volumeProgressResult,
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
        novelId,
        characterIds: characters?.map(c => c.id) || [],
      })
      setCharacterReport(data)
      setCharacterFromCache(false)
      setCharacterCachedAt(null)
      loadLatestCheckLog()
    } catch (error) {
      console.error('角色一致性检查失败:', error)
      setCharacterReport({ conflicts: [], warnings: [`检查失败: ${(error as Error).message}`], score: 0 })
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
        novelId,
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

  const handleRepair = async (
    type: 'coherence' | 'character' | 'volume',
    target: string,
    report: any
  ) => {
    if (!chapterId) return
    setRepairTarget(target)
    setRepairing(type)
    setRepairedContent(null)
    setRepairError(null)
    setApplyRepairSuccess(false)

    try {
      let body: Parameters<typeof api.generate.repairChapter>[0] = { chapterId, novelId, repairType: type }

      if (type === 'coherence') {
        body.coherenceIssues = report.issues?.map((i: any) => ({
          severity: i.severity, message: i.message, suggestion: i.suggestion, category: i.category,
        })) || []
        body.coherenceScore = report.score
      } else if (type === 'character') {
        body.characterConflicts = report.conflicts?.map((c: any) => ({
          characterName: c.characterName,
          dimension: c.dimension || '角色一致性',
          issue: c.issue || c.conflict,
          excerpt: c.excerpt,
          suggestion: c.suggestion,
        })) || []
      } else if (type === 'volume') {
        body.wordCountIssues = report.wordCountIssues?.map((w: any) => ({
          chapterNumber: w.chapterNumber, chapterTitle: w.chapterTitle, message: w.message,
        })) || []
        body.rhythmIssues = report.rhythmIssues?.map((r: any) => ({
          chapterNumber: r.chapterNumber, chapterTitle: r.chapterTitle,
          dimension: r.dimension, deviation: r.deviation, suggestion: r.suggestion,
        })) || []
        body.volumeContext = `${report.diagnosis || ''}。${report.suggestion || ''}`
      }

      const data = await api.generate.repairChapter(body)
      if (data.ok && data.repairedContent) {
        setRepairedContent(data.repairedContent)
      } else {
        setRepairError(data.error || '修复失败')
      }
    } catch (error) {
      setRepairError((error as Error).message)
    } finally {
      setRepairing(null)
    }
  }

  const handleApplyRepair = async () => {
    if (!chapterId || !repairedContent) return
    setApplyingRepair(true)
    try {
      await api.chapters.update(chapterId, { content: repairedContent })
      setApplyRepairSuccess(true)
      setRepairedContent(null)
    } catch (error) {
      setRepairError(`应用失败: ${(error as Error).message}`)
    } finally {
      setApplyingRepair(false)
    }
  }

  const handleViewCombinedReport = (report: CombinedReport) => {
    setCombinedReport(report)
    setRewriteDialogOpen(true)
  }

  const handleSelectHistoryLog = (log: CheckLog) => {
    setSelectedHistoryLog(log)
    setHistoryReportDialogOpen(true)
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
      <CheckSummary
        latestCheckLog={latestCheckLog}
        chapterId={chapterId}
        novelId={novelId}
        onViewReport={handleViewCombinedReport}
        onLoadHistory={loadCheckHistory}
      />

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

      {showCheckHistory && (
        <CheckHistoryList
          checkHistory={checkHistory}
          latestCheckLog={latestCheckLog}
          onSelectLog={handleSelectHistoryLog}
        />
      )}

      <CombinedReportDialog
        open={rewriteDialogOpen}
        onOpenChange={setRewriteDialogOpen}
        isChecking={isChecking}
        isFromCache={isFromCache}
        reportCachedAt={reportCachedAt}
        combinedReport={combinedReport}
        repairState={repairState}
        onRecheck={handleRecheck}
        onRepair={(type, target) => combinedReport && handleRepair(type, target, type === 'coherence' ? combinedReport.coherenceCheck : type === 'character' ? combinedReport.characterCheck : combinedReport.volumeProgressCheck)}
        onApplyRepair={handleApplyRepair}
      />

      <CoherenceReportDialog
        open={coherenceDialogOpen}
        onOpenChange={setCoherenceDialogOpen}
        isChecking={coherenceChecking}
        isFromCache={coherenceFromCache}
        cachedAt={coherenceCachedAt}
        report={coherenceReport}
        repairState={repairState}
        onRecheck={handleCoherenceRecheck}
        onRepair={() => coherenceReport && handleRepair('coherence', 'coherence', coherenceReport)}
        onApplyRepair={handleApplyRepair}
      />

      <CharacterReportDialog
        open={characterDialogOpen}
        onOpenChange={setCharacterDialogOpen}
        isChecking={characterChecking}
        isFromCache={characterFromCache}
        cachedAt={characterCachedAt}
        report={characterReport}
        repairState={repairState}
        onRecheck={handleCharacterRecheck}
        onRepair={() => characterReport && handleRepair('character', 'character', characterReport)}
        onApplyRepair={handleApplyRepair}
      />

      <VolumeReportDialog
        open={volumeDialogOpen}
        onOpenChange={setVolumeDialogOpen}
        isChecking={volumeChecking}
        isFromCache={volumeFromCache}
        cachedAt={volumeCachedAt}
        report={volumeReport}
        repairState={repairState}
        onRecheck={handleVolumeRecheck}
        onRepair={() => volumeReport && handleRepair('volume', 'volume', volumeReport)}
        onApplyRepair={handleApplyRepair}
      />

      <HistoryReportDialog
        open={historyReportDialogOpen}
        onOpenChange={setHistoryReportDialogOpen}
        selectedLog={selectedHistoryLog}
        repairState={repairState}
        onRepair={handleRepair}
        onApplyRepair={handleApplyRepair}
      />
    </div>
  )
}