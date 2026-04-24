/**
 * @file ExportDialog.tsx
 * @description 导出对话框组件，支持Markdown、TXT、EPUB、ZIP等多格式导出
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { getToken } from '@/lib/api'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Download,
  FileText,
  BookOpen,
  Archive,
  FileCode2,
  Loader2,
  CheckCircle2,
  Settings2,
} from 'lucide-react'

interface ExportDialogProps {
  novelId: string
  novelTitle?: string
}

const FORMAT_OPTIONS = [
  {
    id: 'md' as const,
    name: 'Markdown',
    icon: FileCode2,
    description: '标准 Markdown 格式，适合编辑和转换',
    extension: '.md',
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
  },
  {
    id: 'txt' as const,
    name: '纯文本',
    icon: FileText,
    description: '纯文本格式，兼容性最强',
    extension: '.txt',
    color: 'text-gray-600',
    bgColor: 'bg-gray-50',
  },
  {
    id: 'epub' as const,
    name: 'EPUB 电子书',
    icon: BookOpen,
    description: '电子书标准格式，支持 Kindle、Apple Books 等',
    extension: '.epub',
    color: 'text-purple-600',
    bgColor: 'bg-purple-50',
  },
  {
    id: 'zip' as const,
    name: 'ZIP 打包',
    icon: Archive,
    description: '包含所有格式的压缩包（MD + TXT + EPUB）',
    extension: '.zip',
    color: 'text-orange-600',
    bgColor: 'bg-orange-50',
  },
]

export function ExportDialog({ novelId, novelTitle }: ExportDialogProps) {
  const [open, setOpen] = useState(false)
  const [selectedFormat, setSelectedFormat] = useState<string>('epub')
  const [includeTOC, setIncludeTOC] = useState(true)
  const [includeMeta, setIncludeMeta] = useState(true)
  const [isExporting, setIsExporting] = useState(false)

  // 导出 mutation
  const exportMutation = useMutation({
    mutationFn: async () => {
      setIsExporting(true)

      const token = getToken()
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`
      const response = await fetch('/api/export', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          novelId,
          format: selectedFormat,
          includeTOC,
          includeMeta,
        }),
      })

      if (!response.ok) {
        throw new Error(`导出失败: ${response.status}`)
      }

      return response.blob()
    },
    onSuccess: (blob) => {
      // 触发下载
      const url = URL.createObjectURL(blob)
      const formatConfig = FORMAT_OPTIONS.find(f => f.id === selectedFormat)
      const filename = `${novelTitle || 'novel'}${formatConfig?.extension || ''}`

      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      toast.success(`✅ 已导出为 ${formatConfig?.name}`)
      setIsExporting(false)
      setOpen(false)
    },
    onError: (error) => {
      toast.error(`导出失败: ${(error as Error).message}`)
      setIsExporting(false)
    },
  })

  const handleExport = () => {
    exportMutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Download className="h-4 w-4" />
          导出
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-[500px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5 text-primary" />
            导出小说
          </DialogTitle>
          <DialogDescription>
            选择格式和选项将小说导出为不同文件格式
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* 小说信息 */}
          <div className="p-3 bg-muted/30 rounded-lg">
            <p className="font-medium text-sm">{novelTitle || '未命名小说'}</p>
            <p className="text-xs text-muted-foreground mt-1">
              ID: {novelId}
            </p>
          </div>

          {/* 格式选择 */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <Settings2 className="h-4 w-4" />
              选择导出格式
            </Label>

            <div className="grid grid-cols-2 gap-3">
              {FORMAT_OPTIONS.map((format) => {
                const Icon = format.icon
                const isSelected = selectedFormat === format.id

                return (
                  <button
                    key={format.id}
                    onClick={() => setSelectedFormat(format.id)}
                    className={`relative flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all ${
                      isSelected
                        ? `border-primary ${format.bgColor} shadow-sm`
                        : 'border-transparent bg-background hover:border-border'
                    }`}
                  >
                    {isSelected && (
                      <CheckCircle2 className="absolute top-2 right-2 h-5 w-5 text-primary" />
                    )}

                    <Icon className={`h-8 w-8 ${isSelected ? format.color : 'text-muted-foreground'}`} />

                    <span className={`text-sm font-medium ${isSelected ? '' : 'text-muted-foreground'}`}>
                      {format.name}
                    </span>

                    <span className={`text-xs text-center leading-tight ${
                      isSelected ? 'text-foreground/70' : 'text-muted-foreground'
                    }`}>
                      {format.description}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* 导出选项 */}
          <div className="space-y-3">
            <Label>导出选项</Label>

            <div className="space-y-3 pl-1">
              <label className="flex items-center gap-3 cursor-pointer group">
                <Checkbox
                  checked={includeMeta}
                  onCheckedChange={(v: boolean | 'indeterminate') => setIncludeMeta(v === true)}
                />
                <div className="flex-1">
                  <span className="text-sm font-medium group-hover:text-primary transition-colors">
                    包含元数据
                  </span>
                  <p className="text-xs text-muted-foreground">
                    标题、作者、简介等信息
                  </p>
                </div>
              </label>

              <label className="flex items-center gap-3 cursor-pointer group">
                <Checkbox
                  checked={includeTOC}
                  onCheckedChange={(v: boolean | 'indeterminate') => setIncludeTOC(v === true)}
                />
                <div className="flex-1">
                  <span className="text-sm font-medium group-hover:text-primary transition-colors">
                    包含目录
                  </span>
                  <p className="text-xs text-muted-foreground">
                    自动生成章节目录索引
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex justify-end gap-3 pt-2 border-t">
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>

            <Button
              onClick={handleExport}
              disabled={isExporting}
              className="min-w-[120px] gap-2"
            >
              {isExporting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  导出中...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  开始导出
                </>
              )}
            </Button>
          </div>

          {/* 提示信息 */}
          <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t">
            <p>💡 提示：</p>
            <ul className="list-disc list-inside space-y-0.5 ml-2">
              <li>EPUB 格式可在电子阅读器或手机上阅读</li>
              <li>ZIP 打包包含所有格式，方便归档备份</li>
              <li>导出的文件将自动下载到您的设备</li>
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
