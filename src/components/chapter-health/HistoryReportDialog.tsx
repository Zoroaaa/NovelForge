/**
 * @file HistoryReportDialog.tsx
 * @description 历史检查报告详情对话框组件
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
  Shield,
  ShieldAlert,
  Link,
  Target,
  AlertTriangle,
  CheckCircle,
  Loader2,
  Wand2,
  Check,
} from 'lucide-react'
import type { CheckLog, RepairState } from './types'

interface HistoryReportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedLog: CheckLog | null
  repairState: RepairState
  onRepair: (type: 'coherence' | 'character' | 'volume', target: string, report?: any) => void
  onApplyRepair: () => void
}

export function HistoryReportDialog({
  open,
  onOpenChange,
  selectedLog,
  repairState,
  onRepair,
  onApplyRepair,
}: HistoryReportDialogProps) {
  const { repairing, repairedContent, repairError, repairTarget, applyingRepair, applyRepairSuccess } = repairState

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600'
    if (score >= 60) return 'text-amber-600'
    return 'text-red-600'
  }

  const getCheckTypeLabel = (checkType: string) => {
    switch (checkType) {
      case 'character_consistency':
        return '角色一致性'
      case 'chapter_coherence':
        return '章节连贯性'
      case 'combined':
        return '综合检查'
      case 'volume_progress':
        return '卷完成程度'
      default:
        return checkType
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="w-[90vw] max-w-3xl max-h-[85vh] flex flex-col rounded-xl shadow-2xl">
        <AlertDialogHeader className="flex-shrink-0 px-6 pt-6 pb-4 border-b space-y-0 gap-0">
          <div className="flex items-center justify-between">
            <AlertDialogTitle className="text-lg font-semibold text-left">
              检查报告详情
              <Badge variant="outline" className="ml-2 text-[10px]">
                {selectedLog && getCheckTypeLabel(selectedLog.checkType)}
              </Badge>
            </AlertDialogTitle>
            {selectedLog?.createdAt && (
              <span className="text-xs text-muted-foreground">
                检查时间：{new Date(selectedLog.createdAt * 1000).toLocaleString('zh-CN')}
              </span>
            )}
          </div>
        </AlertDialogHeader>
        <AlertDialogDescription asChild>
          <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0">
            <div className="text-left">
              {selectedLog ? (
                <div className="space-y-5">
                  <div className="flex items-center justify-between p-4 bg-gradient-to-r from-muted/80 to-muted/40 rounded-xl border">
                    <div className="flex items-baseline gap-4">
                      <span className="text-sm font-medium text-muted-foreground">评分</span>
                      <span className={`text-3xl font-bold tabular-nums ${getScoreColor(selectedLog.score)}`}>
                        {selectedLog.score}
                      </span>
                      <span className="text-lg text-muted-foreground">/100</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {selectedLog.checkType === 'character_consistency' && (selectedLog.characterResult?.conflicts?.length ?? 0) > 0 && (
                        <Button
                          variant="default"
                          size="sm"
                          className="gap-1.5 h-8"
                          disabled={repairing !== null}
                          onClick={() => onRepair('character', 'history_character')}
                        >
                          {repairing === 'character' && repairTarget === 'history_character'
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Wand2 className="h-3.5 w-3.5" />}
                          AI修复
                        </Button>
                      )}
                      {selectedLog.checkType === 'chapter_coherence' && (selectedLog.coherenceResult?.issues?.length ?? 0) > 0 && (
                        <Button
                          variant="default"
                          size="sm"
                          className="gap-1.5 h-8"
                          disabled={repairing !== null}
                          onClick={() => onRepair('coherence', 'history_coherence')}
                        >
                          {repairing === 'coherence' && repairTarget === 'history_coherence'
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Wand2 className="h-3.5 w-3.5" />}
                          AI修复
                        </Button>
                      )}
                      {selectedLog.checkType === 'combined' && (
                        <>
                          {(selectedLog.characterResult?.conflicts?.length ?? 0) > 0 && (
                            <Button
                              variant="default"
                              size="sm"
                              className="gap-1.5 h-8"
                              disabled={repairing !== null}
                              onClick={() => onRepair('character', 'history_character')}
                            >
                              {repairing === 'character' && repairTarget === 'history_character'
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <Wand2 className="h-3.5 w-3.5" />}
                              修复角色
                            </Button>
                          )}
                          {(selectedLog.coherenceResult?.issues?.length ?? 0) > 0 && (
                            <Button
                              variant="default"
                              size="sm"
                              className="gap-1.5 h-8"
                              disabled={repairing !== null}
                              onClick={() => onRepair('coherence', 'history_coherence')}
                            >
                              {repairing === 'coherence' && repairTarget === 'history_coherence'
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <Wand2 className="h-3.5 w-3.5" />}
                              修复连贯
                            </Button>
                          )}
                          {(selectedLog.volumeProgressResult?.wordCountIssues?.length ?? 0) > 0 || (selectedLog.volumeProgressResult?.rhythmIssues?.length ?? 0) > 0 ? (
                            <Button
                              variant="default"
                              size="sm"
                              className="gap-1.5 h-8"
                              disabled={repairing !== null}
                              onClick={() => onRepair('volume', 'history_volume')}
                            >
                              {repairing === 'volume' && repairTarget === 'history_volume'
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <Wand2 className="h-3.5 w-3.5" />}
                              修复卷进度
                            </Button>
                          ) : null}
                        </>
                      )}
                      {selectedLog.checkType === 'volume_progress' && ((selectedLog.volumeProgressResult?.wordCountIssues?.length ?? 0) > 0 || (selectedLog.volumeProgressResult?.rhythmIssues?.length ?? 0) > 0) && (
                        <Button
                          variant="default"
                          size="sm"
                          className="gap-1.5 h-8"
                          disabled={repairing !== null}
                          onClick={() => onRepair('volume', 'history_volume')}
                        >
                          {repairing === 'volume' && repairTarget === 'history_volume'
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Wand2 className="h-3.5 w-3.5" />}
                          AI修复
                        </Button>
                      )}
                    </div>
                  </div>

                  {repairTarget?.startsWith('history_') && (repairedContent || repairError || applyRepairSuccess) && (
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
                      {selectedLog.checkType === 'character_consistency' && selectedLog.characterResult && (
                        <section className="space-y-3">
                          <header className="flex items-center gap-2.5 pb-2 border-b border-red-200/50 dark:border-red-800/30">
                            <Shield className="h-4 w-4 text-destructive" />
                            <h3 className="text-sm font-semibold uppercase tracking-wide">角色一致性检查</h3>
                          </header>
                          <div className="space-y-2 pl-1">
                            {selectedLog.characterResult?.conflicts?.length && selectedLog.characterResult.conflicts.length > 0 ? (
                              selectedLog.characterResult?.conflicts?.map((conflict: any, i: number) => (
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
                            {selectedLog.characterResult.warnings?.filter((w: string) => !w.includes('失败'))?.map((warning: string, i: number) => (
                              <div key={`hist-char-w-${i}`} className="flex items-start gap-3 p-3 bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-800/30 rounded-lg text-[13px] text-amber-800 dark:text-amber-200 leading-relaxed">
                                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
                                <span>{warning}</span>
                              </div>
                            ))}
                          </div>
                        </section>
                      )}

                      {selectedLog.checkType === 'chapter_coherence' && selectedLog.coherenceResult && (
                        <section className="space-y-3">
                          <header className="flex items-center gap-2.5 pb-2 border-b border-amber-200/50 dark:border-amber-800/30">
                            <Link className="h-4 w-4 text-amber-600" />
                            <h3 className="text-sm font-semibold uppercase tracking-wide">章节连贯性检查</h3>
                            <Badge variant="outline" className="ml-auto text-[11px] h-5">
                              {selectedLog.coherenceResult.score}分 · {selectedLog.coherenceResult.issues?.length || 0}个问题
                            </Badge>
                          </header>
                          <div className="space-y-2 pl-1">
                            {selectedLog.coherenceResult.issues?.length > 0 ? (
                              selectedLog.coherenceResult.issues?.map((issue: any, i: number) => (
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

                      {selectedLog.checkType === 'combined' && selectedLog.characterResult && selectedLog.coherenceResult && (
                        <>
                          <section className="space-y-3">
                            <header className="flex items-center gap-2.5 pb-2 border-b border-red-200/50 dark:border-red-800/30">
                              <Shield className="h-4 w-4 text-destructive" />
                              <h3 className="text-sm font-semibold uppercase tracking-wide">角色一致性检查</h3>
                              <Badge variant="destructive" className="ml-auto text-[11px] h-5">
                                {selectedLog.characterResult?.conflicts?.length && selectedLog.characterResult.conflicts.length > 0
                                  ? `${selectedLog.characterResult.conflicts.length} 个冲突`
                                  : '通过'}
                              </Badge>
                            </header>
                            <div className="space-y-2 pl-1">
                              {selectedLog.characterResult.conflicts?.map((conflict: any, i: number) => (
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
                              {selectedLog.characterResult.warnings?.filter((w: string) => !w.includes('失败'))?.map((warning: string, i: number) => (
                                <div key={`hist-comb-char-w-${i}`} className="flex items-start gap-3 p-3 bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-800/30 rounded-lg text-[13px] text-amber-800 dark:text-amber-200 leading-relaxed">
                                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
                                  <span>{warning}</span>
                                </div>
                              ))}
                              {!selectedLog.characterResult.conflicts?.length &&
                               !selectedLog.characterResult.warnings?.filter((w: string) => !w.includes('失败')).length && (
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
                                {selectedLog.coherenceResult.score}分 · {selectedLog.coherenceResult.issues?.length || 0}个问题
                              </Badge>
                            </header>
                            <div className="space-y-2 pl-1">
                              {selectedLog.coherenceResult.issues?.map((issue: any, i: number) => (
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
                              {!selectedLog.coherenceResult.issues?.length && (
                                <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded">
                                  <CheckCircle className="h-4 w-4 text-green-600" />
                                  <span className="text-xs text-green-700 dark:text-green-300">章节连贯性检查通过</span>
                                </div>
                              )}
                            </div>
                          </section>

                          {selectedLog.volumeProgressResult && (
                            <section className="space-y-3">
                              <header className="flex items-center gap-2.5 pb-2 border-b border-blue-200/50 dark:border-blue-800/30">
                                <Target className="h-4 w-4 text-blue-600" />
                                <h3 className="text-sm font-semibold uppercase tracking-wide">卷完成度检查</h3>
                                <Badge className={`ml-auto text-[11px] h-5 ${
                                  selectedLog.volumeProgressResult.score >= 80
                                    ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                                    : selectedLog.volumeProgressResult.score >= 60
                                    ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'
                                    : 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
                                }`}>
                                  {selectedLog.volumeProgressResult.score}分
                                </Badge>
                              </header>
                              <div className="space-y-2 pl-1">
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                  <div className="p-2 bg-muted/30 rounded">
                                    <span className="text-muted-foreground">当前章节：</span>
                                    <span className="font-medium ml-1">第 {selectedLog.volumeProgressResult.currentChapter || '-'} 章</span>
                                  </div>
                                  <div className="p-2 bg-muted/30 rounded">
                                    <span className="text-muted-foreground">目标章节：</span>
                                    <span className="font-medium ml-1">{selectedLog.volumeProgressResult.targetChapter ? `${selectedLog.volumeProgressResult.targetChapter} 章` : '未设定'}</span>
                                  </div>
                                </div>
                                <div className="flex gap-2">
                                  <div className="flex-1 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800 text-center">
                                    <div className="text-[10px] text-muted-foreground">字数健康度</div>
                                    <div className={`text-lg font-bold ${selectedLog.volumeProgressResult.wordCountScore >= 80 ? 'text-green-600' : selectedLog.volumeProgressResult.wordCountScore >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                                      {selectedLog.volumeProgressResult.wordCountScore}
                                    </div>
                                  </div>
                                  <div className="flex-1 p-3 bg-purple-50 dark:bg-purple-950/30 rounded-lg border border-purple-200 dark:border-purple-800 text-center">
                                    <div className="text-[10px] text-muted-foreground">节奏健康度</div>
                                    <div className={`text-lg font-bold ${selectedLog.volumeProgressResult.rhythmScore >= 80 ? 'text-green-600' : selectedLog.volumeProgressResult.rhythmScore >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                                      {selectedLog.volumeProgressResult.rhythmScore}
                                    </div>
                                  </div>
                                  <div className="flex-1 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-300 dark:border-blue-700 text-center">
                                    <div className="text-[10px] text-muted-foreground">综合</div>
                                    <div className={`text-lg font-bold ${selectedLog.volumeProgressResult.score >= 80 ? 'text-green-600' : selectedLog.volumeProgressResult.score >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                                      {selectedLog.volumeProgressResult.score}
                                    </div>
                                  </div>
                                </div>
                                {selectedLog.volumeProgressResult.wordCountIssues?.length > 0 && (
                                  <div className="space-y-1">
                                    <p className="text-xs font-medium text-blue-600">字数风险 ({selectedLog.volumeProgressResult.wordCountIssues.length})</p>
                                    {selectedLog.volumeProgressResult.wordCountIssues?.map((issue: any, i: number) => (
                                      <div key={`hist-wc-${i}`} className={`p-2 rounded border text-xs ${issue.severity === 'error' ? 'bg-red-50 dark:bg-red-950/30 border-red-200' : 'bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200'}`}>
                                        <span className="font-medium">{issue.chapterTitle}</span>
                                        <span className="text-muted-foreground ml-2">{issue.message}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {selectedLog.volumeProgressResult.rhythmIssues?.length > 0 && (
                                  <div className="space-y-1">
                                    <p className="text-xs font-medium text-purple-600">节奏风险 ({selectedLog.volumeProgressResult.rhythmIssues.length})</p>
                                    {selectedLog.volumeProgressResult.rhythmIssues?.map((issue: any, i: number) => (
                                      <div key={`hist-rh-${i}`} className={`p-2 rounded border text-xs ${issue.severity === 'error' ? 'bg-red-50 dark:bg-red-950/30 border-red-200' : 'bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200'}`}>
                                        <span className="font-medium">{issue.chapterTitle}</span>
                                        <Badge className={`ml-1 text-[10px] h-4 ${issue.severity === 'error' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>{issue.dimension}</Badge>
                                        <span className="text-muted-foreground ml-2">{issue.deviation}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {selectedLog.volumeProgressResult.diagnosis && (
                                  <div className="p-2.5 bg-muted/30 rounded text-xs">
                                    <span className="text-muted-foreground">诊断：</span>{selectedLog.volumeProgressResult.diagnosis}
                                  </div>
                                )}
                                {selectedLog.volumeProgressResult.suggestion && (
                                  <div className="p-2.5 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded text-xs text-blue-700 dark:text-blue-300">
                                    <span className="font-medium">建议：</span>{selectedLog.volumeProgressResult.suggestion}
                                  </div>
                                )}
                              </div>
                            </section>
                          )}
                        </>
                      )}

                      {selectedLog.checkType === 'volume_progress' && selectedLog.volumeProgressResult && (
                        <section className="space-y-3">
                          <header className="flex items-center gap-2.5 pb-2 border-b border-blue-200/50 dark:border-blue-800/30">
                            <CheckCircle className="h-4 w-4 text-blue-600" />
                            <h3 className="text-sm font-semibold uppercase tracking-wide">卷完成程度检查</h3>
                          </header>
                          <div className="space-y-2 pl-1">
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div className="p-2 bg-muted/30 rounded">
                                <span className="text-muted-foreground">当前章节：</span>
                                <span className="font-medium ml-1">第 {selectedLog.volumeProgressResult.currentChapter || '-'} 章</span>
                              </div>
                              <div className="p-2 bg-muted/30 rounded">
                                <span className="text-muted-foreground">目标章节：</span>
                                <span className="font-medium ml-1">{selectedLog.volumeProgressResult.targetChapter ? `${selectedLog.volumeProgressResult.targetChapter} 章` : '未设定'}</span>
                              </div>
                              <div className="p-2 bg-muted/30 rounded">
                                <span className="text-muted-foreground">当前字数：</span>
                                <span className="font-medium ml-1">{selectedLog.volumeProgressResult.currentWordCount ? `${(selectedLog.volumeProgressResult.currentWordCount / 10000).toFixed(1)} 万` : '-'}</span>
                              </div>
                              <div className="p-2 bg-muted/30 rounded">
                                <span className="text-muted-foreground">目标字数：</span>
                                <span className="font-medium ml-1">{selectedLog.volumeProgressResult.targetWordCount ? `${(selectedLog.volumeProgressResult.targetWordCount / 10000).toFixed(0)} 万` : '未设定'}</span>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <div className="flex-1 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800 text-center">
                                <div className="text-[10px] text-muted-foreground">字数健康度</div>
                                <div className={`text-lg font-bold ${selectedLog.volumeProgressResult.wordCountScore >= 80 ? 'text-green-600' : selectedLog.volumeProgressResult.wordCountScore >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                                  {selectedLog.volumeProgressResult.wordCountScore}
                                </div>
                              </div>
                              <div className="flex-1 p-3 bg-purple-50 dark:bg-purple-950/30 rounded-lg border border-purple-200 dark:border-purple-800 text-center">
                                <div className="text-[10px] text-muted-foreground">节奏健康度</div>
                                <div className={`text-lg font-bold ${selectedLog.volumeProgressResult.rhythmScore >= 80 ? 'text-green-600' : selectedLog.volumeProgressResult.rhythmScore >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                                  {selectedLog.volumeProgressResult.rhythmScore}
                                </div>
                              </div>
                              <div className="flex-1 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-300 dark:border-blue-700 text-center">
                                <div className="text-[10px] text-muted-foreground">综合评分</div>
                                <div className={`text-lg font-bold ${selectedLog.volumeProgressResult.score >= 80 ? 'text-green-600' : selectedLog.volumeProgressResult.score >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                                  {selectedLog.volumeProgressResult.score}
                                </div>
                              </div>
                            </div>
                            {selectedLog.volumeProgressResult.wordCountIssues?.length > 0 && (
                              <div className="space-y-1.5">
                                <p className="text-xs font-medium text-blue-600">字数风险 ({selectedLog.volumeProgressResult.wordCountIssues.length})</p>
                                {selectedLog.volumeProgressResult.wordCountIssues?.map((issue: any, i: number) => (
                                  <div key={`wc-${i}`} className={`p-2 rounded border text-xs ${issue.severity === 'error' ? 'bg-red-50 dark:bg-red-950/30 border-red-200' : 'bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200'}`}>
                                    <span className="font-medium">第{issue.chapterNumber}章「{issue.chapterTitle}」</span>
                                    <span className="text-muted-foreground ml-2">{issue.message}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {selectedLog.volumeProgressResult.rhythmIssues?.length > 0 && (
                              <div className="space-y-1.5">
                                <p className="text-xs font-medium text-purple-600">节奏风险 ({selectedLog.volumeProgressResult.rhythmIssues.length})</p>
                                {selectedLog.volumeProgressResult.rhythmIssues?.map((issue: any, i: number) => (
                                  <div key={`rh-${i}`} className={`p-2 rounded border text-xs ${issue.severity === 'error' ? 'bg-red-50 dark:bg-red-950/30 border-red-200' : 'bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200'}`}>
                                    <span className="font-medium">第{issue.chapterNumber}章「{issue.chapterTitle}」</span>
                                    <Badge className={`ml-1 text-[10px] h-4 ${issue.severity === 'error' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>{issue.dimension}</Badge>
                                    <span className="text-muted-foreground ml-2">{issue.deviation}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {selectedLog.volumeProgressResult.diagnosis && (
                              <div className="p-3 bg-muted/30 rounded text-xs">
                                <span className="text-muted-foreground">诊断：</span>{selectedLog.volumeProgressResult.diagnosis}
                              </div>
                            )}
                            {selectedLog.volumeProgressResult.suggestion && (
                              <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded text-xs text-blue-700 dark:text-blue-300">
                                <span className="font-medium">建议：</span>{selectedLog.volumeProgressResult.suggestion}
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
          </div>
          </AlertDialogDescription>
        <AlertDialogFooter className="flex-shrink-0 px-6 py-4 border-t bg-muted/30 rounded-b-xl gap-3">
          <AlertDialogCancel className="h-9">关闭</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}