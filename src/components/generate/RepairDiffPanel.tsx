/**
 * @file RepairDiffPanel.tsx
 * @description 一致性修复 Diff 面板 — 展示原文与修复版本的差异，支持接受/忽略
 *
 * Diff 算法：按段落分割后做 LCS（最长公共子序列），逐段标记 unchanged / removed / added。
 * 不依赖任何第三方 diff 库，纯 TS 实现。
 */
import { useState, useMemo } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { CheckCheck, X, ChevronDown, ChevronUp, Wrench } from 'lucide-react'

interface Issue {
  severity: 'error' | 'warning'
  category?: string
  message: string
  suggestion?: string
}

interface RepairDiffPanelProps {
  originalContent: string
  repairedContent: string
  originalScore: number
  issues: Issue[]
  onAccept: (content: string) => void
  onDismiss: () => void
}

// ─────────────────────────────────────────
// LCS-based diff (paragraph level)
// ─────────────────────────────────────────

type DiffOp = { type: 'unchanged' | 'removed' | 'added'; text: string }

function splitParagraphs(text: string): string[] {
  return text.split(/\n+/).map(s => s.trim()).filter(Boolean)
}

function lcs(a: string[], b: string[]): number[][] {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
  return dp
}

function diffParagraphs(original: string, repaired: string): DiffOp[] {
  const a = splitParagraphs(original)
  const b = splitParagraphs(repaired)
  const dp = lcs(a, b)

  const ops: DiffOp[] = []
  let i = a.length, j = b.length

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.unshift({ type: 'unchanged', text: a[i - 1] })
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ type: 'added', text: b[j - 1] })
      j--
    } else {
      ops.unshift({ type: 'removed', text: a[i - 1] })
      i--
    }
  }

  // 合并相邻同类 op（减少碎片）
  const merged: DiffOp[] = []
  for (const op of ops) {
    const last = merged[merged.length - 1]
    if (last && last.type === op.type) {
      last.text += '\n' + op.text
    } else {
      merged.push({ ...op })
    }
  }
  return merged
}

// ─────────────────────────────────────────
// Component
// ─────────────────────────────────────────

export function RepairDiffPanel({
  originalContent,
  repairedContent,
  originalScore,
  issues,
  onAccept,
  onDismiss,
}: RepairDiffPanelProps) {
  const [showIssues, setShowIssues] = useState(false)
  const [viewMode, setViewMode] = useState<'diff' | 'repaired'>('diff')

  const diffOps = useMemo(
    () => diffParagraphs(originalContent, repairedContent),
    [originalContent, repairedContent]
  )

  const changedCount = diffOps.filter(op => op.type !== 'unchanged').length
  const errorCount = issues.filter(i => i.severity === 'error').length
  const warnCount = issues.filter(i => i.severity === 'warning').length

  return (
    <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-amber-100 dark:bg-amber-900/50 border-b border-amber-200 dark:border-amber-800">
        <div className="flex items-center gap-2">
          <Wrench className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
          <span className="text-xs font-semibold text-amber-800 dark:text-amber-300">
            自动修复建议
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-200 dark:bg-amber-800 text-amber-700 dark:text-amber-300">
            原评分 {originalScore}/100
          </span>
        </div>
        <button
          onClick={onDismiss}
          className="text-amber-500 hover:text-amber-700 dark:hover:text-amber-300 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Issues summary */}
      <button
        onClick={() => setShowIssues(v => !v)}
        className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
      >
        <span>
          {errorCount > 0 && <span className="text-red-600 dark:text-red-400 font-medium">{errorCount} 个错误</span>}
          {errorCount > 0 && warnCount > 0 && <span className="mx-1">·</span>}
          {warnCount > 0 && <span className="text-yellow-600 dark:text-yellow-400">{warnCount} 个警告</span>}
          <span className="ml-2 text-amber-600 dark:text-amber-500">· {changedCount} 处段落变更</span>
        </span>
        {showIssues ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>

      {showIssues && (
        <div className="px-3 pb-2 space-y-1">
          {issues.map((issue, i) => (
            <div
              key={i}
              className={`text-[11px] px-2 py-1 rounded border ${
                issue.severity === 'error'
                  ? 'bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'
                  : 'bg-yellow-50 dark:bg-yellow-950/50 border-yellow-200 dark:border-yellow-800 text-yellow-700 dark:text-yellow-400'
              }`}
            >
              <span className="font-medium">{issue.severity === 'error' ? '✗' : '△'} {issue.message}</span>
              {issue.suggestion && (
                <div className="mt-0.5 opacity-75">→ {issue.suggestion}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* View mode toggle */}
      <div className="flex gap-1 px-3 py-1.5 border-t border-amber-200 dark:border-amber-800">
        <button
          onClick={() => setViewMode('diff')}
          className={`text-[11px] px-2 py-0.5 rounded transition-colors ${
            viewMode === 'diff'
              ? 'bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200 font-medium'
              : 'text-amber-600 dark:text-amber-500 hover:bg-amber-100 dark:hover:bg-amber-900/40'
          }`}
        >
          差异对比
        </button>
        <button
          onClick={() => setViewMode('repaired')}
          className={`text-[11px] px-2 py-0.5 rounded transition-colors ${
            viewMode === 'repaired'
              ? 'bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200 font-medium'
              : 'text-amber-600 dark:text-amber-500 hover:bg-amber-100 dark:hover:bg-amber-900/40'
          }`}
        >
          修复全文
        </button>
      </div>

      {/* Diff / Repaired content */}
      <ScrollArea className="h-[320px] border-t border-amber-200 dark:border-amber-800">
        <div className="p-3 text-sm font-serif leading-relaxed space-y-1">
          {viewMode === 'diff' ? (
            diffOps.map((op, idx) => {
              if (op.type === 'unchanged') {
                return (
                  <p key={idx} className="text-foreground/70 whitespace-pre-wrap">
                    {op.text}
                  </p>
                )
              }
              if (op.type === 'removed') {
                return (
                  <p
                    key={idx}
                    className="whitespace-pre-wrap bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-400 line-through px-1 rounded"
                  >
                    {op.text}
                  </p>
                )
              }
              // added
              return (
                <p
                  key={idx}
                  className="whitespace-pre-wrap bg-green-100 dark:bg-green-950/60 text-green-800 dark:text-green-300 px-1 rounded"
                >
                  {op.text}
                </p>
              )
            })
          ) : (
            <div className="whitespace-pre-wrap text-foreground">
              {repairedContent}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Actions */}
      <div className="flex gap-2 px-3 py-2 border-t border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40">
        <Button
          size="sm"
          className="flex-1 h-7 text-xs gap-1 bg-green-600 hover:bg-green-700 text-white"
          onClick={() => onAccept(repairedContent)}
        >
          <CheckCheck className="h-3.5 w-3.5" />
          接受修复，写入编辑器
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40"
          onClick={onDismiss}
        >
          忽略
        </Button>
      </div>
    </div>
  )
}
