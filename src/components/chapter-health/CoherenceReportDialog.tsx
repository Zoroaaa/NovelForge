/**
 * @file CoherenceReportDialog.tsx
 * @description 连贯性检查报告对话框组件
 */
import {
  AlertDialog,
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
  ShieldAlert,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Loader2,
  Wand2,
  Check,
} from 'lucide-react'
import type { CoherenceCheckResult, RepairState } from './types'

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

interface CoherenceReportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  isChecking: boolean
  isFromCache: boolean
  cachedAt: number | null
  report: CoherenceCheckResult | null
  repairState: RepairState
  onRecheck: () => void
  onRepair: () => void
  onApplyRepair: () => void
}

export function CoherenceReportDialog({
  open,
  onOpenChange,
  isChecking,
  isFromCache,
  cachedAt,
  report,
  repairState,
  onRecheck,
  onRepair,
  onApplyRepair,
}: CoherenceReportDialogProps) {
  const { repairing, repairedContent, repairError, applyingRepair, applyRepairSuccess } = repairState

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
            <AlertDialogTitle className="text-lg font-semibold text-left">连贯性检查报告</AlertDialogTitle>
            {isFromCache && cachedAt && (
              <span className="text-xs text-muted-foreground">上次检查：{formatTimeAgo(cachedAt)}</span>
            )}
          </div>
        </AlertDialogHeader>
        <AlertDialogDescription asChild>
          <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0">
            <div className="text-left">
              {isChecking ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <span className="text-sm text-muted-foreground">正在执行连贯性检查...</span>
                </div>
              ) : report ? (
                <div className="space-y-5">
                  <div className="flex items-center justify-between p-4 bg-gradient-to-r from-muted/80 to-muted/40 rounded-xl border">
                    <div className="flex items-baseline gap-4">
                      <span className="text-sm font-medium text-muted-foreground">评分</span>
                      <span className={`text-3xl font-bold tabular-nums ${getScoreColor(report.score)}`}>
                        {report.score}
                      </span>
                      <span className="text-lg text-muted-foreground">/100</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {report.issues.length > 0 && (
                        <Button
                          variant="default"
                          size="sm"
                          className="gap-1.5 h-8"
                          disabled={repairing !== null}
                          onClick={onRepair}
                        >
                          {repairing === 'coherence'
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Wand2 className="h-3.5 w-3.5" />}
                          AI修复
                        </Button>
                      )}
                      <Button variant="secondary" size="sm" className="gap-2 h-8 shadow-sm" onClick={onRecheck}>
                        <RefreshCw className="h-4 w-4" />重新生成报告
                      </Button>
                    </div>
                  </div>

                  {repairing === null && (repairedContent || repairError || applyRepairSuccess) && (
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
                      {report.issues.length > 0 ? (
                        report.issues.map((issue, i) => (
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
          </div>
          </AlertDialogDescription>
        <AlertDialogFooter className="flex-shrink-0 px-6 py-4 border-t bg-muted/30 rounded-b-xl gap-3">
          <AlertDialogCancel className="h-9">关闭</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}