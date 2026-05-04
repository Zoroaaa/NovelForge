/**
 * @file BatchGeneratePanel.tsx
 * @description 批量生成面板 - 提供批量章节创建、进度监控、暂停/恢复/取消功能
 * @date 2026-05-04
 */
import { useState, useEffect, useCallback } from 'react'
import { api } from '../../lib/api'
import type { BatchTaskStatus } from '../../lib/types'
import { Play, Pause, X, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'

interface BatchGeneratePanelProps {
  novelId: string
  volumeId: string
  targetChapterCount: number
  currentChapterCount: number
  onGenerated?: () => void
}

export function BatchGeneratePanel({
  novelId,
  volumeId,
  targetChapterCount,
  currentChapterCount,
  onGenerated,
}: BatchGeneratePanelProps) {
  const [targetCount, setTargetCount] = useState(
    Math.max(1, targetChapterCount - currentChapterCount)
  )
  const [task, setTask] = useState<BatchTaskStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const taskStatus = task?.status

  const fetchActive = useCallback(async () => {
    try {
      const active = await api.batch.getActive(novelId)
      if (active && active.volumeId === volumeId) {
        setTask(active)
      }
    } catch {}
  }, [novelId, volumeId])

  useEffect(() => {
    fetchActive()
    const interval = setInterval(fetchActive, taskStatus === 'running' ? 3000 : 10000)
    return () => clearInterval(interval)
  }, [fetchActive, taskStatus])

  useEffect(() => {
    if (taskStatus === 'done' || taskStatus === 'failed' || taskStatus === 'cancelled') {
      onGenerated?.()
    }
  }, [taskStatus, onGenerated])

  const handleStart = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await api.batch.start({ novelId, volumeId, targetCount, startFromNext: true })
      await fetchActive()
    } catch (e: any) {
      setError(e.message || '启动失败')
    } finally {
      setLoading(false)
    }
  }

  const handlePause = async () => {
    if (!task) return
    try { await api.batch.pause(task.id); await fetchActive() } catch {}
  }

  const handleResume = async () => {
    if (!task) return
    try { await api.batch.resume(task.id); await fetchActive() } catch {}
  }

  const handleCancel = async () => {
    if (!task) return
    try { await api.batch.cancel(task.id); await fetchActive() } catch {}
  }

  const progress = task ? Math.round(((task.completedCount + task.failedCount) / task.targetCount) * 100) : 0

  if (!task || task.status === 'done' || task.status === 'failed' || task.status === 'cancelled') {
    return (
      <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
        <span className="text-xs text-muted-foreground whitespace-nowrap">批量生成</span>
        <input
          type="number"
          min={1}
          max={200}
          value={targetCount}
          onChange={e => setTargetCount(Math.max(1, parseInt(e.target.value) || 1))}
          className="w-16 h-7 text-xs text-center border rounded bg-background px-2"
        />
        <span className="text-xs text-muted-foreground">章</span>
        <button
          onClick={handleStart}
          disabled={loading || targetCount < 1}
          className="h-7 px-3 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
          开始
        </button>
        {error && <span className="text-xs text-destructive">{error}</span>}
        {task?.status === 'done' && (
          <span className="text-xs text-green-600 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            已完成 {task.completedCount}/{task.targetCount} 章
          </span>
        )}
        {task?.status === 'failed' && (
          <span className="text-xs text-destructive flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            失败: {task.errorMsg}
          </span>
        )}
      </div>
    )
  }

  const currentChapterNum = task.currentChapterOrder ?? task.startChapterOrder
  const totalDone = task.completedCount + task.failedCount

  return (
    <div className="p-2 rounded-md border space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">
          正在生成第 {currentChapterNum} 章 / 共 {task.targetCount} 章
        </span>
        <span className="text-xs text-muted-foreground">{progress}%</span>
      </div>

      <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex items-center gap-2">
        {task.status === 'running' ? (
          <>
            <button onClick={handlePause} className="h-6 px-2 text-xs rounded bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300 flex items-center gap-1">
              <Pause className="w-3 h-3" /> 暂停
            </button>
          </>
        ) : (
          <button onClick={handleResume} className="h-6 px-2 text-xs rounded bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 flex items-center gap-1">
            <Play className="w-3 h-3" /> 恢复
          </button>
        )}

        <button onClick={handleCancel} className="h-6 px-2 text-xs rounded bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 flex items-center gap-1">
          <X className="w-3 h-3" /> 取消
        </button>

        <span className="ml-auto text-xs text-muted-foreground">
          ✅ {task.completedCount} · ❌ {task.failedCount}
        </span>
      </div>
    </div>
  )
}
