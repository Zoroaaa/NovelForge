/**
 * @file CombinedReportDialog.tsx
 * @description 综合检查报告对话框组件
 */
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
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Shield,
  ShieldAlert,
  Link,
  Target,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Loader2,
  Zap,
  Wand2,
  Check,
} from 'lucide-react'
import type { CombinedReport, RepairState } from './types'

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

interface CombinedReportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  isChecking: boolean
  isFromCache: boolean
  reportCachedAt: number | null
  combinedReport: any
  repairState: RepairState
  onRecheck: () => void
  onRepair: (type: 'coherence' | 'character' | 'volume', target: string) => void
  onApplyRepair: () => void
}

export function CombinedReportDialog({
  open,
  onOpenChange,
  isChecking,
  isFromCache,
  reportCachedAt,
  combinedReport,
  repairState,
  onRecheck,
  onRepair,
  onApplyRepair,
}: CombinedReportDialogProps) {
  const { repairing, repairedContent, repairError, repairTarget, applyingRepair, applyRepairSuccess } = repairState

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600'
    if (score >= 60) return 'text-amber-600'
    return 'text-red-600'
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="w-[90vw] max-w-3xl max-h-[85vh] flex flex-col rounded-xl shadow-2xl">
        <AlertDialogHeader className="flex-shrink-0 px-6 pt-6 pb-4 border-b space-y-0 gap-0">
          <div className="flex items-center justify-between">
            <AlertDialogTitle className="text-lg font-semibold text-left">质量检查报告</AlertDialogTitle>
            {isFromCache && reportCachedAt && (
              <span className="text-xs text-muted-foreground">上次检查：{formatTimeAgo(reportCachedAt)}</span>
            )}
          </div>
        </AlertDialogHeader>
        <AlertDialogDescription asChild>
          <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0">
            <div className="text-left">
              {isChecking ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <span className="text-sm text-muted-foreground">正在执行综合质量检查...</span>
                </div>
              ) : combinedReport ? (
                <div className="space-y-5">
                  <div className="flex items-center justify-between p-4 bg-gradient-to-r from-muted/80 to-muted/40 rounded-xl border">
                    <div className="flex items-baseline gap-4">
                      <span className="text-sm font-medium text-muted-foreground">综合评分</span>
                      <span className={`text-3xl font-bold tabular-nums ${getScoreColor(combinedReport.score)}`}>
                        {combinedReport.score}
                      </span>
                      <span className="text-lg text-muted-foreground">/100</span>
                    </div>
                    <Button variant="secondary" size="sm" className="gap-2 h-9 shadow-sm hover:shadow-md transition-shadow" onClick={onRecheck}>
                      <RefreshCw className="h-4 w-4" />重新生成报告
                    </Button>
                  </div>

                  {(combinedReport.characterCheck?.conflicts?.length > 0 ||
                    combinedReport.coherenceCheck?.issues?.length > 0 ||
                    (combinedReport.volumeProgressCheck?.wordCountIssues?.length > 0 || combinedReport.volumeProgressCheck?.rhythmIssues?.length > 0)) && (
                    <div className="flex flex-wrap gap-2 p-3 bg-muted/20 rounded-lg border">
                      <span className="text-xs text-muted-foreground self-center mr-1">AI修复：</span>
                      {combinedReport.characterCheck?.conflicts?.length > 0 && (
                        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" disabled={repairing !== null}
                          onClick={() => onRepair('character', 'combined_character')}>
                          {repairing === 'character' && repairTarget === 'combined_character'
                            ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                          角色一致性
                        </Button>
                      )}
                      {combinedReport.coherenceCheck?.issues?.length > 0 && (
                        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" disabled={repairing !== null}
                          onClick={() => onRepair('coherence', 'combined_coherence')}>
                          {repairing === 'coherence' && repairTarget === 'combined_coherence'
                            ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                          章节连贯性
                        </Button>
                      )}
                      {(combinedReport.volumeProgressCheck?.wordCountIssues?.length > 0 || combinedReport.volumeProgressCheck?.rhythmIssues?.length > 0) && (
                        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" disabled={repairing !== null}
                          onClick={() => onRepair('volume', 'combined_volume')}>
                          {repairing === 'volume' && repairTarget === 'combined_volume'
                            ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                          卷进度
                        </Button>
                      )}
                    </div>
                  )}

                  {repairTarget?.startsWith('combined_') && (repairedContent || repairError || applyRepairSuccess) && (
                    <div className="space-y-2">
                      {applyRepairSuccess && (
                        <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg">
                          <Check className="h-4 w-4 text-green-600 shrink-0" />
                          <span className="text-sm text-green-700 dark:text-green-300 font-medium">已成功应用到章节</span>
                        </div>
                      )}
                      {repairError && (
                        <div className="p-3 bg-red-50 dark:bg-red-950 border border-red-200 rounded-lg text-xs text-red-600">{repairError}</div>
                      )}
                      {repairedContent && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg">
                            <div className="flex items-center gap-2">
                              <Check className="h-4 w-4 text-blue-600 shrink-0" />
                              <span className="text-sm text-blue-700 dark:text-blue-300 font-medium">修复完成，共 {repairedContent.length} 字</span>
                            </div>
                            <Button size="sm" className="h-7 gap-1.5" disabled={applyingRepair} onClick={onApplyRepair}>
                              {applyingRepair ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                              应用到章节
                            </Button>
                          </div>
                          <details className="border rounded-lg overflow-hidden">
                            <summary className="px-3 py-2 text-xs cursor-pointer hover:bg-muted/30 text-muted-foreground">查看修复后正文</summary>
                            <div className="p-3 text-xs leading-relaxed whitespace-pre-wrap text-foreground border-t max-h-48 overflow-y-auto">{repairedContent}</div>
                          </details>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="pr-2">
                    <div className="space-y-5 pb-2">
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

                            {combinedReport.characterCheck.warnings?.filter((w: string) => !w.includes('失败'))?.map((warning: string, i: number) => (
                              <div key={`char-w-${i}`} className="flex items-start gap-3 p-3 bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-800/30 rounded-lg text-[13px] text-amber-800 dark:text-amber-200 leading-relaxed">
                                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
                                <span>{warning}</span>
                              </div>
                            ))}
                          </div>
                        </section>
                      )}

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

                      {combinedReport.volumeProgressCheck && (combinedReport.volumeProgressCheck.wordCountIssues.length > 0 || combinedReport.volumeProgressCheck.rhythmIssues.length > 0) && (
                        <section className="space-y-3">
                          <header className="flex items-center gap-2.5 pb-2 border-b border-blue-200/50 dark:border-blue-800/30">
                            <Target className="h-4 w-4 text-blue-600" />
                            <h3 className="text-sm font-semibold uppercase tracking-wide">卷完成度检查</h3>
                            <Badge className={`ml-auto text-[11px] h-5 ${
                              combinedReport.volumeProgressCheck.score >= 80
                                ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                                : combinedReport.volumeProgressCheck.score >= 60
                                ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'
                                : 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
                            }`}>
                              {combinedReport.volumeProgressCheck.score}分 · 字数{combinedReport.volumeProgressCheck.wordCountScore} · 节奏{combinedReport.volumeProgressCheck.rhythmScore}
                            </Badge>
                          </header>

                          <div className="space-y-2 pl-1">
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div className="p-2 bg-muted/30 rounded">
                                <span className="text-muted-foreground">当前章节：</span>
                                <span className="font-medium ml-1">第 {combinedReport.volumeProgressCheck.currentChapter || '-'} 章</span>
                              </div>
                              <div className="p-2 bg-muted/30 rounded">
                                <span className="text-muted-foreground">目标章节：</span>
                                <span className="font-medium ml-1">{combinedReport.volumeProgressCheck.targetChapter ? `${combinedReport.volumeProgressCheck.targetChapter} 章` : '未设定'}</span>
                              </div>
                              <div className="p-2 bg-muted/30 rounded">
                                <span className="text-muted-foreground">当前字数：</span>
                                <span className="font-medium ml-1">{combinedReport.volumeProgressCheck.currentWordCount ? `${(combinedReport.volumeProgressCheck.currentWordCount / 10000).toFixed(1)} 万` : '-'}</span>
                              </div>
                              <div className="p-2 bg-muted/30 rounded">
                                <span className="text-muted-foreground">目标字数：</span>
                                <span className="font-medium ml-1">{combinedReport.volumeProgressCheck.targetWordCount ? `${(combinedReport.volumeProgressCheck.targetWordCount / 10000).toFixed(0)} 万` : '未设定'}</span>
                              </div>
                            </div>
                            {combinedReport.volumeProgressCheck.diagnosis && (
                              <div className="p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg text-xs">
                                <span className="text-blue-700 dark:text-blue-300 font-medium">诊断：</span>
                                <span className="text-blue-600 dark:text-blue-400 ml-1">{combinedReport.volumeProgressCheck.diagnosis}</span>
                              </div>
                            )}
                            {combinedReport.volumeProgressCheck.suggestion && (
                              <div className="p-3 bg-muted/30 rounded-lg text-xs">
                                <span className="text-muted-foreground">AI 建议：</span>
                                <p className="mt-1 text-foreground">{combinedReport.volumeProgressCheck.suggestion}</p>
                              </div>
                            )}
                          </div>
                        </section>
                      )}

                      {!combinedReport.characterCheck?.conflicts?.length &&
                       !combinedReport.characterCheck?.warnings?.filter((w: string) => !w.includes('失败'))?.length &&
                       !combinedReport.coherenceCheck?.issues?.length &&
                       (!combinedReport.volumeProgressCheck || (combinedReport.volumeProgressCheck.wordCountIssues.length === 0 && combinedReport.volumeProgressCheck.rhythmIssues.length === 0)) && (
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
                   (combinedReport.volumeProgressCheck && combinedReport.volumeProgressCheck.score < 60)) && (
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
          </div>
          </AlertDialogDescription>
        <AlertDialogFooter className="flex-shrink-0 px-6 py-4 border-t bg-muted/30 rounded-b-xl gap-3">
          <AlertDialogCancel className="h-9">关闭</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}