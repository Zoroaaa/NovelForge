/**
 * @file VolumeProgressCheck.tsx
 * @description 卷完成程度检查组件（字数风险 + 节奏风险）
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { VolumeProgressResult } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Loader2, AlertTriangle, CheckCircle, Target,
  ChevronDown, ChevronUp, FileText, AlignLeft, Wand2, Check
} from 'lucide-react'

interface VolumeProgressCheckProps {
  novelId: string
  chapterId: string | null
}

export function VolumeProgressCheck({ novelId, chapterId }: VolumeProgressCheckProps) {
  const queryClient = useQueryClient()
  const [result, setResult] = useState<VolumeProgressResult | null>(null)
  const [expandedWordCount, setExpandedWordCount] = useState(true)
  const [expandedRhythm, setExpandedRhythm] = useState(true)
  const [showRepaired, setShowRepaired] = useState(false)
  const [repairing, setRepairing] = useState(false)
  const [repairedContent, setRepairedContent] = useState<string | null>(null)
  const [repairError, setRepairError] = useState<string | null>(null)

  const checkMutation = useMutation({
    mutationFn: () => api.generate.checkVolumeProgress({ chapterId: chapterId!, novelId }),
    onSuccess: (data) => {
      setResult(data)
      setRepairedContent(null)
      setRepairError(null)
      setShowRepaired(false)
      queryClient.invalidateQueries({ queryKey: ['check-logs'] })
      toast.success('卷完成度检查完成')
    },
    onError: (err) => toast.error(`检查失败: ${(err as Error).message}`),
  })

  const handleRepair = async () => {
    if (!chapterId || !result) return
    const hasIssues = result.wordCountIssues.length > 0 || result.rhythmIssues.length > 0
    if (!hasIssues) return
    setRepairing(true)
    setRepairedContent(null)
    setRepairError(null)

    try {
      const data = await api.generate.repairChapter({
        chapterId, novelId, repairType: 'volume',
        wordCountIssues: result.wordCountIssues.map(w => ({
          chapterNumber: w.chapterNumber, chapterTitle: w.chapterTitle, message: w.message,
        })),
        rhythmIssues: result.rhythmIssues.map(r => ({
          chapterNumber: r.chapterNumber, chapterTitle: r.chapterTitle,
          dimension: r.dimension, deviation: r.deviation, suggestion: r.suggestion,
        })),
        volumeContext: `${result.diagnosis}。${result.suggestion}`,
      })
      if (data.ok && data.repairedContent) {
        setRepairedContent(data.repairedContent)
      } else {
        setRepairError(data.error || '修复失败')
      }
    } catch (error) {
      setRepairError((error as Error).message)
    } finally {
      setRepairing(false)
    }
  }

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600'
    if (score >= 60) return 'text-amber-600'
    return 'text-red-600'
  }

  if (!chapterId) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground text-sm">
            请先选择一个章节
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Target className="h-4 w-4" />
          卷完成程度检查
        </CardTitle>
      </CardHeader>

      <CardContent>
        {!result && !checkMutation.isPending && (
          <div className="text-center text-muted-foreground text-sm py-8">
            请选择章节后点击上方"执行卷进度检查"
          </div>
        )}

        {checkMutation.isPending && (
          <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在分析卷的完成程度...
          </div>
        )}

        {result && !checkMutation.isPending && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <StatItem label="当前章节" value={`第 ${result.currentChapter} 章`} />
              <StatItem label="目标章节" value={result.targetChapter ? `${result.targetChapter} 章` : '未设定'} />
              <StatItem label="当前字数" value={`${(result.currentWordCount / 10000).toFixed(1)} 万字`} />
              <StatItem label="目标字数" value={result.targetWordCount ? `${(result.targetWordCount / 10000).toFixed(0)} 万字` : '未设定'} />
            </div>

            {result.perChapterEstimate && (
              <div className="p-2.5 bg-muted/30 rounded-lg text-xs text-center text-muted-foreground">
                预估每章字数：约 {result.perChapterEstimate.toLocaleString()} 字（±15% 内为健康范围）
              </div>
            )}

            <div className="flex gap-3">
              <div className="flex-1 p-3 bg-muted/30 rounded-lg border text-center">
                <div className="text-[11px] text-muted-foreground mb-1 flex items-center justify-center gap-1">
                  <FileText className="h-3 w-3" /> 字数健康度
                </div>
                <div className={`text-xl font-bold ${getScoreColor(result.wordCountScore)}`}>
                  {result.wordCountScore}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">/100</div>
                {result.wordCountIssues.length > 0 && (
                  <Badge variant="outline" className="mt-1 text-[10px] h-4 px-1.5">
                    {result.wordCountIssues.filter(i => i.severity === 'error').length}个严重，{result.wordCountIssues.filter(i => i.severity === 'warning').length}个轻微
                  </Badge>
                )}
              </div>
              <div className="flex-1 p-3 bg-muted/30 rounded-lg border text-center">
                <div className="text-[11px] text-muted-foreground mb-1 flex items-center justify-center gap-1">
                  <AlignLeft className="h-3 w-3" /> 节奏健康度
                </div>
                <div className={`text-xl font-bold ${getScoreColor(result.rhythmScore)}`}>
                  {result.rhythmScore}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">/100</div>
                {result.rhythmIssues.length > 0 && (
                  <Badge variant="outline" className="mt-1 text-[10px] h-4 px-1.5">
                    {result.rhythmIssues.filter(i => i.severity === 'error').length}个严重，{result.rhythmIssues.filter(i => i.severity === 'warning').length}个轻微
                  </Badge>
                )}
              </div>
              <div className="flex-1 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800 text-center">
                <div className="text-[11px] text-muted-foreground mb-1">综合评分</div>
                <div className={`text-xl font-bold ${getScoreColor(result.score)}`}>
                  {result.score}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">/100</div>
              </div>
            </div>

            {/* 字数风险列表 */}
            <div className="border rounded-lg overflow-hidden">
              <button
                onClick={() => setExpandedWordCount(!expandedWordCount)}
                className="w-full flex items-center justify-between p-3 hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-blue-600" />
                  <span className="text-sm font-medium">字数风险</span>
                  {result.wordCountIssues.length > 0 ? (
                    <Badge variant="destructive" className="text-[10px] h-4 px-1.5">
                      {result.wordCountIssues.length}
                    </Badge>
                  ) : (
                    <Badge className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 text-[10px] h-4 px-1.5">
                      无
                    </Badge>
                  )}
                </div>
                {expandedWordCount ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {expandedWordCount && (
                <div className="border-t">
                  {result.wordCountIssues.length === 0 ? (
                    <div className="p-3 text-xs text-muted-foreground flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      各章字数均在健康范围内
                    </div>
                  ) : (
                    <ScrollArea className="max-h-48">
                      <div className="divide-y">
                        {result.wordCountIssues.map((issue, i) => (
                          <div key={`wc-${i}`} className="p-3 text-xs">
                            <div className="flex items-center gap-2 mb-1">
                              <AlertTriangle className={`h-4 w-4 shrink-0 ${issue.severity === 'error' ? 'text-red-500' : 'text-yellow-500'}`} />
                              <span className="font-medium">
                                第{issue.chapterNumber}章「{issue.chapterTitle}」
                              </span>
                              <Badge variant="outline" className={`ml-auto text-[10px] h-4 ${issue.severity === 'error' ? 'border-red-300 text-red-600' : 'border-yellow-300 text-yellow-600'}`}>
                                {issue.severity === 'error' ? '严重' : '轻微'}
                              </Badge>
                            </div>
                            <p className="text-muted-foreground pl-6">{issue.message}</p>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </div>
              )}
            </div>

            {/* 节奏风险列表 */}
            <div className="border rounded-lg overflow-hidden">
              <button
                onClick={() => setExpandedRhythm(!expandedRhythm)}
                className="w-full flex items-center justify-center justify-between p-3 hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <AlignLeft className="h-4 w-4 text-purple-600" />
                  <span className="text-sm font-medium">节奏风险</span>
                  {result.rhythmIssues.length > 0 ? (
                    <Badge variant="destructive" className="text-[10px] h-4 px-1.5">
                      {result.rhythmIssues.length}
                    </Badge>
                  ) : (
                    <Badge className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 text-[10px] h-4 px-1.5">
                      无
                    </Badge>
                  )}
                </div>
                {expandedRhythm ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {expandedRhythm && (
                <div className="border-t">
                  {result.rhythmIssues.length === 0 ? (
                    <div className="p-3 text-xs text-muted-foreground flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      情节走向与卷纲吻合，节奏良好
                    </div>
                  ) : (
                    <ScrollArea className="max-h-48">
                      <div className="divide-y">
                        {result.rhythmIssues.map((issue, i) => (
                          <div key={`rh-${i}`} className="p-3 text-xs">
                            <div className="flex items-center gap-2 mb-1">
                              <AlertTriangle className={`h-4 w-4 shrink-0 ${issue.severity === 'error' ? 'text-red-500' : 'text-yellow-500'}`} />
                              <span className="font-medium">
                                第{issue.chapterNumber}章「{issue.chapterTitle}」
                              </span>
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
                    </ScrollArea>
                  )}
                </div>
              )}
            </div>

            {/* 诊断和建议 */}
            {result.diagnosis && (
              <div className="p-3 bg-muted/30 rounded-lg text-xs">
                <div className="text-muted-foreground mb-1">诊断：</div>
                <p className="text-foreground">{result.diagnosis}</p>
              </div>
            )}

            {result.suggestion && (
              <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg text-xs">
                <div className="text-blue-700 dark:text-blue-300 font-medium mb-1">建议：</div>
                <p className="text-blue-600 dark:text-blue-400">{result.suggestion}</p>
              </div>
            )}

            {(result.wordCountIssues.length > 0 || result.rhythmIssues.length > 0) && (
              <div className="pt-2 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2"
                  disabled={repairing}
                  onClick={handleRepair}
                >
                  {repairing ? (
                    <><Loader2 className="h-4 w-4 animate-spin" />修复中...</>
                  ) : (
                    <><Wand2 className="h-4 w-4" />根据报告修复章节</>
                  )}
                </Button>
              </div>
            )}

            {repairError && (
              <div className="p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-600 dark:text-red-400">
                修复失败：{repairError}
              </div>
            )}

            {repairedContent && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 p-2 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg">
                  <Check className="h-4 w-4 text-green-600 shrink-0" />
                  <span className="text-xs text-green-700 dark:text-green-300 font-medium">修复完成</span>
                </div>
                <div className="border rounded-lg overflow-hidden">
                  <button
                    onClick={() => setShowRepaired(!showRepaired)}
                    className="w-full flex items-center justify-between p-2 text-left hover:bg-muted/30 transition-colors"
                  >
                    <span className="text-xs font-medium">查看修复后正文</span>
                    {showRepaired ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                  {showRepaired && (
                    <ScrollArea className="max-h-64 border-t">
                      <div className="p-3 text-xs leading-relaxed whitespace-pre-wrap">
                        {repairedContent}
                      </div>
                    </ScrollArea>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-2 bg-muted/30 rounded-lg text-center">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-medium mt-0.5">{value}</div>
    </div>
  )
}
