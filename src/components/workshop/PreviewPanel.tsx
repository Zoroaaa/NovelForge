/**
 * @file PreviewPanel.tsx
 * @description Workshop创作工作台 - 实时数据预览面板
 *   展示AI提取的结构化小说数据（基本信息/写作规则/世界设定/角色/卷纲/章节）
 *   支持重新提取功能以修复不完整的数据
 * @date 2026-05-04
 */
import { useState } from 'react'
import { BookOpen, FileText, AlertTriangle, RefreshCw } from 'lucide-react'
import { api } from '../../lib/api'
import type { ExtractedData } from './types'
import { PreviewBasicInfo } from './PreviewBasicInfo'
import { PreviewWritingRules } from './PreviewWritingRules'
import { PreviewWorldSettings } from './PreviewWorldSettings'
import { PreviewCharacters } from './PreviewCharacters'
import { PreviewVolumes } from './PreviewVolumes'
import { PreviewChapters } from './PreviewChapters'

interface PreviewPanelProps {
  extractedData: ExtractedData
  stage?: string
  isGenerating?: boolean
  sessionId?: string
  onReExtractSuccess?: (data: ExtractedData) => void
}

export function PreviewPanel({ extractedData, stage, isGenerating, sessionId, onReExtractSuccess }: PreviewPanelProps) {
  const hasData = Object.keys(extractedData).length > 0
  const isVolumeStage = stage === 'volume_outline'
  const volumeDataMissing = isVolumeStage && hasData && (!extractedData.volumes || extractedData.volumes.length === 0)
  const [isReExtracting, setIsReExtracting] = useState(false)

  const handleReExtract = async () => {
    if (!sessionId || isReExtracting) return
    setIsReExtracting(true)
    try {
      const res = await api.workshop.reExtract(sessionId)
      if (res.ok && res.extractedData) {
        onReExtractSuccess?.(res.extractedData as ExtractedData)
        console.log('[workshop] 重新提取成功:', res.message)
      } else {
        console.error('[workshop] 重新提取失败:', res)
      }
    } catch (e) {
      console.error('[workshop] 重新提取异常:', e)
    } finally {
      setIsReExtracting(false)
    }
  }

  return (
    <div className="hidden lg:flex flex-col w-80 xl:w-96 border-l bg-muted/30 overflow-auto">
      <div className="p-6 space-y-6 sticky top-0">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            实时预览
          </h3>
          {sessionId && (
            <button
              onClick={handleReExtract}
              disabled={isReExtracting || isGenerating}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-md border border-border/50 bg-background hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="从已有对话消息中重新提取结构化数据"
            >
              <RefreshCw className={`h-3 w-3 ${isReExtracting ? 'animate-spin' : ''}`} />
              {isReExtracting ? '提取中...' : '重新提取'}
            </button>
          )}
        </div>

        {!hasData ? (
          <div className="text-center py-12 text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p className="text-sm">暂无提取数据</p>
            <p className="text-xs mt-1">与 AI 对话后，这里会显示结构化的创作数据</p>
          </div>
        ) : (
          <div className="space-y-4">
            <PreviewBasicInfo data={extractedData} />
            <PreviewWritingRules rules={extractedData.writingRules || []} />
            <PreviewWorldSettings settings={extractedData.worldSettings || []} />
            <PreviewCharacters characters={extractedData.characters || []} />
            <PreviewVolumes volumes={extractedData.volumes || []} />
            <PreviewChapters chapters={extractedData.chapters || []} />
            {volumeDataMissing && !isGenerating && (
              <div className="rounded-lg border border-amber-300/50 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-1.5">
                <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span className="text-xs font-semibold">卷纲数据提取失败</span>
                </div>
                <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed">
                  AI 输出的 JSON 可能不完整或被截断。常见原因：
                </p>
                <ul className="text-[11px] text-amber-700 dark:text-amber-300 list-disc pl-4 space-y-0.5">
                  <li>模型 max_tokens 设置过小（卷纲建议 ≥32000）</li>
                  <li>AI 一次性输出太多卷导致超长</li>
                  <li>AI 输出格式不规范</li>
                </ul>
                <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed">
                  可点击右上方「重新提取」按钮尝试修复，或增大模型 max_tokens，或要求 AI 分卷逐个输出。
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
