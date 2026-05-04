/**
 * @file WorkshopHeaderActions.tsx
 * @description 创作工坊顶部操作栏 - 提交/导出/删除/设置等快捷操作按钮组
 * @date 2026-05-04
 */
import { PanelLeftClose, PanelLeft, CheckCircle2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { STAGES } from './types'
import type { ExtractedData } from './types'

interface WorkshopHeaderActionsProps {
  showSidebar: boolean
  onToggleSidebar: () => void
  sessionId: string | null
  stage: string
  onStageChange: (stage: string) => void
  extractedData: ExtractedData
  onShowCommitDialog: () => void
  onShowImportDialog: () => void
}

export function WorkshopHeaderActions({
  showSidebar,
  onToggleSidebar,
  sessionId,
  stage,
  onStageChange,
  extractedData,
  onShowCommitDialog,
  onShowImportDialog,
}: WorkshopHeaderActionsProps) {
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onToggleSidebar}
        className={`h-8 w-8 rounded-lg flex items-center justify-center transition-colors ${
          showSidebar
            ? 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
            : 'text-violet-600 bg-violet-50 dark:bg-violet-900/20'
        }`}
        title={showSidebar ? '隐藏创作历史' : '显示创作历史'}
      >
        {showSidebar ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
      </button>

      {sessionId && (
        <Select value={stage} onValueChange={onStageChange}>
          <SelectTrigger className="w-[140px] h-8 text-xs">
            <SelectValue placeholder="选择阶段" />
          </SelectTrigger>
          <SelectContent>
            {STAGES.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                <span className="flex items-center gap-1.5">
                  <s.icon className="h-3.5 w-3.5" />
                  {s.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {sessionId && Object.keys(extractedData).length > 0 && (
        <Button size="sm" onClick={onShowCommitDialog} className="gap-2">
          <CheckCircle2 className="h-4 w-4" />
          提交创建小说
        </Button>
      )}

      <Button size="sm" variant="outline" onClick={onShowImportDialog} className="gap-2">
        <Upload className="h-4 w-4" />
        导入数据
      </Button>
    </div>
  )
}
