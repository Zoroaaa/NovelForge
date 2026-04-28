/**
 * @file VolumeReportDialog.tsx
 * @description 卷进度检查报告对话框组件
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
  RefreshCw,
  Loader2,
  AlertTriangle,
  FileText,
  AlignLeft,
  Wand2,
  Check,
} from 'lucide-react'
import type { VolumeProgressResult, RepairState } from './types'

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

interface VolumeReportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  isChecking: boolean
  isFromCache: boolean
  cachedAt: number | null
  report: any
  repairState: RepairState
  onRecheck: () => void
  onRepair: () => void
  onApplyRepair: () => void
}

export function VolumeReportDialog({
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
}: VolumeReportDialogProps) {
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
            <AlertDialogTitle className="text-lg font-semibold text-left">卷进度检查报告</AlertDialogTitle>
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
                  <span className="text-sm text-muted-foreground">正在执行卷进度检查...</span>
                </div>
              ) : report ? (
                <div className="space-y-5 pb-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-4 bg-gradient-to-br from-muted/80 to-muted/40 rounded-xl border">
                      <div className="text-xs text-muted-foreground mb-1">当前章节</div>
                      <div className="text-2xl font-bold">第 {report.currentChapter || '-'} 章</div>
                    </div>
                    <div className="p-4 bg-gradient-to-br from-muted/80 to-muted/40 rounded-xl border">
                      <div className="text-xs text-muted-foreground mb-1">目标章节</div>
                      <div className="text-2xl font-bold">{report.targetChapter ? `${report.targetChapter} 章` : '未设定'}</div>
                    </div>
                    <div className="p-4 bg-gradient-to-br from-muted/80 to-muted/40 rounded-xl border">
                      <div className="text-xs text-muted-foreground mb-1">当前字数</div>
                      <div className="text-2xl font-bold">{report.currentWordCount ? `${(report.currentWordCount / 10000).toFixed(1)} 万` : '-'}</div>
                    </div>
                    <div className="p-4 bg-gradient-to-br from-muted/80 to-muted/40 rounded-xl border">
                      <div className="text-xs text-muted-foreground mb-1">目标字数</div>
                      <div className="text-2xl font-bold">{report.targetWordCount ? `${(report.targetWordCount / 10000).toFixed(0)} 万` : '未设定'}</div>
                    </div>
                  </div>

                  {(report.targetChapter || report.targetWordCount) && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 bg-muted/50 rounded-lg">
                        <div className="text-xs text-muted-foreground mb-1">章节进度</div>
                        <div className="text-lg font-semibold">{report.chapterProgress?.toFixed(1) || '0'}%</div>
                        <div className="mt-1 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${Math.min(report.chapterProgress || 0, 100)}%` }}
                          />
                        </div>
                      </div>
                      <div className="p-3 bg-muted/50 rounded-lg">
                        <div className="text-xs text-muted-foreground mb-1">字数进度</div>
                        <div className="text-lg font-semibold">{report.wordProgress?.toFixed(1) || '0'}%</div>
                        <div className="mt-1 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${Math.min(report.wordProgress || 0, 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex gap-3">
                    <div className="flex-1 p-4 bg-blue-50 dark:bg-blue-950/30 rounded-xl border border-blue-200 dark:border-blue-800 text-center">
                      <div className="text-[11px] text-muted-foreground mb-1">字数健康度</div>
                      <div className={`text-2xl font-bold ${getScoreColor(report.wordCountScore)}`}>
                        {report.wordCountScore}
                      </div>
                      <div className="text-[10px] text-muted-foreground">/100</div>
                      {report.wordCountIssues.length > 0 && (
                        <div className="text-[10px] text-muted-foreground mt-1">
                          {report.wordCountIssues.filter((i: any) => i.severity === 'error').length}个严重，{report.wordCountIssues.filter((i: any) => i.severity === 'warning').length}个轻微
                        </div>
                      )}
                    </div>
                    <div className="flex-1 p-4 bg-purple-50 dark:bg-purple-950/30 rounded-xl border border-purple-200 dark:border-purple-800 text-center">
                      <div className="text-[11px] text-muted-foreground mb-1">节奏健康度</div>
                      <div className={`text-2xl font-bold ${getScoreColor(report.rhythmScore)}`}>
                        {report.rhythmScore}
                      </div>
                      <div className="text-[10px] text-muted-foreground">/100</div>
                      {report.rhythmIssues.length > 0 && (
                        <div className="text-[10px] text-muted-foreground mt-1">
                          {report.rhythmIssues.filter((i: any) => i.severity === 'error').length}个严重，{report.rhythmIssues.filter((i: any) => i.severity === 'warning').length}个轻微
                        </div>
                      )}
                    </div>
                    <div className="flex-1 p-4 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/50 dark:to-indigo-950/30 rounded-xl border border-blue-300 dark:border-blue-700 text-center">
                      <div className="text-[11px] text-muted-foreground mb-1">综合评分</div>
                      <div className={`text-2xl font-bold ${getScoreColor(report.score)}`}>
                        {report.score}
                      </div>
                      <div className="text-[10px] text-muted-foreground">/100</div>
                    </div>
                  </div>

                  {(report.wordCountIssues.length > 0 || report.rhythmIssues.length > 0) && (
                    <div className="flex justify-end">
                      <Button
                        variant="default"
                        size="sm"
                        className="gap-1.5 h-8"
                        disabled={repairing !== null}
                        onClick={onRepair}
                      >
                        {repairing === 'volume'
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Wand2 className="h-3.5 w-3.5" />}
                        AI修复当前章节
                      </Button>
                    </div>
                  )}

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

                  {report.wordCountIssues.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-blue-600 flex items-center gap-1">
                        <FileText className="h-3.5 w-3.5" />
                        字数风险 ({report.wordCountIssues.length})
                      </p>
                      {report.wordCountIssues.map((issue: any, i: number) => (
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

                  {report.rhythmIssues.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-purple-600 flex items-center gap-1">
                        <AlignLeft className="h-3.5 w-3.5" />
                        节奏风险 ({report.rhythmIssues.length})
                      </p>
                      {report.rhythmIssues.map((issue: any, i: number) => (
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

                  {report.diagnosis && (
                    <div className="p-4 bg-muted/30 rounded-lg text-sm">
                      <div className="text-xs text-muted-foreground mb-1">诊断：</div>
                      <p className="text-foreground">{report.diagnosis}</p>
                    </div>
                  )}

                  {report.suggestion && (
                    <div className="p-4 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg text-sm">
                      <div className="text-blue-700 dark:text-blue-300 font-medium mb-1">建议：</div>
                      <p className="text-blue-600 dark:text-blue-400">{report.suggestion}</p>
                    </div>
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
          <Button variant="secondary" size="sm" className="gap-2 h-9 shadow-sm hover:shadow-md transition-shadow" onClick={onRecheck}>
            <RefreshCw className="h-4 w-4" />重新检查
          </Button>
          <AlertDialogCancel className="h-9">关闭</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}