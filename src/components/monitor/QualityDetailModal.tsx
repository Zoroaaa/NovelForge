import { X, AlertTriangle, AlertCircle, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { QualityChapterData } from './types'

interface QualityDetailModalProps {
  chapter: QualityChapterData
  onClose: () => void
}

export function QualityDetailModal({ chapter, onClose }: QualityDetailModalProps) {
  const getSeverityIcon = (severity: 'error' | 'warning') => {
    return severity === 'error'
      ? <AlertCircle className="w-4 h-4 text-red-600" />
      : <AlertTriangle className="w-4 h-4 text-yellow-600" />
  }

  const getSeverityColor = (severity: 'error' | 'warning') => {
    return severity === 'error'
      ? 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950'
      : 'border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950'
  }

  const getScoreDisplay = (score: number | null, label: string): React.ReactNode => {
    if (score === null) {
      return (
        <div className="text-center p-3 bg-muted/30 rounded">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-lg font-bold text-muted-foreground mt-1">未检查</p>
        </div>
      )
    }

    const getColor = (s: number) => {
      if (s >= 80) return 'text-green-600'
      if (s >= 60) return 'text-yellow-600'
      return 'text-red-600'
    }

    return (
      <div className={`text-center p-3 rounded ${score >= 80 ? 'bg-green-50 dark:bg-green-950' : score >= 60 ? 'bg-yellow-50 dark:bg-yellow-950' : 'bg-red-50 dark:bg-red-950'}`}>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className={`text-2xl font-bold mt-1 ${getColor(score)}`}>{Math.round(score)}</p>
        <p className="text-xs text-muted-foreground mt-1">/ 100</p>
      </div>
    )
  }

  return (
    <Dialog open={true} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span>第{chapter.chapterNumber}章 质量诊断报告</span>
            {chapter.title && (
              <Badge variant="outline" className="font-normal">
                {chapter.title}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* 分数概览 */}
          <div className="grid grid-cols-3 gap-4">
            {getScoreDisplay(chapter.coherenceScore, '连贯性')}
            {getScoreDisplay(chapter.characterScore, '角色一致性')}
            {getScoreDisplay(chapter.progressScore, '进度符合度')}
          </div>

          {/* 综合评分 */}
          {chapter.overallScore !== null && (
            <div className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-950 dark:to-purple-950 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">综合质量评分</p>
                  <p className="text-3xl font-bold mt-1">{Math.round(chapter.overallScore)}</p>
                </div>
                <div className="text-right">
                  {chapter.overallScore >= 90 && (
                    <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto" />
                  )}
                  {chapter.overallScore >= 80 && chapter.overallScore < 90 && (
                    <CheckCircle2 className="w-12 h-12 text-blue-500 mx-auto" />
                  )}
                  {chapter.overallScore >= 60 && chapter.overallScore < 80 && (
                    <AlertTriangle className="w-12 h-12 text-yellow-500 mx-auto" />
                  )}
                  {chapter.overallScore < 60 && (
                    <AlertCircle className="w-12 h-12 text-red-500 mx-auto" />
                  )}
                  <p className="text-sm font-medium mt-2">
                    {chapter.overallScore >= 90 ? '优秀' :
                     chapter.overallScore >= 80 ? '良好' :
                     chapter.overallScore >= 60 ? '一般' : '需改进'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* 问题列表 */}
          {chapter.issues.length > 0 && (
            <div>
              <h4 className="font-semibold mb-3 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-orange-600" />
                发现的问题 ({chapter.issues.length})
              </h4>

              <div className="space-y-2">
                {chapter.issues.map((issue, index) => (
                  <div
                    key={index}
                    className={`p-3 rounded-lg border ${getSeverityColor(issue.severity)}`}
                  >
                    <div className="flex items-start gap-3">
                      {getSeverityIcon(issue.severity)}
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-xs">
                            {issue.category}
                          </Badge>
                          <Badge
                            variant={issue.severity === 'error' ? 'destructive' : 'secondary'}
                            className="text-xs"
                          >
                            {issue.severity === 'error' ? '错误' : '警告'}
                          </Badge>
                        </div>
                        <p className="text-sm">{issue.message}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 无问题提示 */}
          {chapter.issues.length === 0 && chapter.lastCheckedAt && (
            <div className="text-center py-8 text-green-600">
              <CheckCircle2 className="w-16 h-16 mx-auto mb-3 opacity-70" />
              <p className="text-lg font-semibold">✨ 未发现问题</p>
              <p className="text-sm text-muted-foreground mt-1">该章节质量良好，继续保持！</p>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex justify-end pt-4 border-t">
            <Button variant="outline" onClick={onClose}>
              关闭
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
