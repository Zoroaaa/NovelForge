/**
 * @file ImportDataDialog.tsx
 * @description 导入数据对话框 - 支持JSON/TXT/MD格式文件导入和粘贴
 */
import { useState, useCallback, useEffect } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { getToken } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Upload,
  FileJson,
  FileText,
  ClipboardPaste,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Sparkles,
} from 'lucide-react'

export type ImportTargetModule =
  | 'chapter'
  | 'volume'
  | 'setting'
  | 'character'
  | 'rule'
  | 'foreshadowing'

export interface FormattedImportData {
  module: ImportTargetModule
  data: Record<string, unknown>
  rawContent: string
  parseStatus: 'success' | 'warning' | 'error'
  parseMessage?: string
}

interface ImportDataDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImportSuccess?: (data: FormattedImportData) => void
}

const MODULE_OPTIONS: { value: ImportTargetModule; label: string; icon: string; description: string }[] = [
  { value: 'chapter', label: '章节', icon: '📄', description: '小说章节内容' },
  { value: 'volume', label: '卷', icon: '📚', description: '卷/部结构' },
  { value: 'setting', label: '设定', icon: '⚙️', description: '世界观、势力、地理等设定' },
  { value: 'character', label: '角色', icon: '👤', description: '角色信息' },
  { value: 'rule', label: '规则', icon: '📋', description: '创作规则' },
  { value: 'foreshadowing', label: '伏笔', icon: '🎭', description: '伏笔线索' },
]

export function ImportDataDialog({ open, onOpenChange, onImportSuccess }: ImportDataDialogProps) {
  const [activeTab, setActiveTab] = useState<'paste' | 'file'>('paste')
  const [pastedContent, setPastedContent] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [targetModule, setTargetModule] = useState<ImportTargetModule>('chapter')
  const [formattedPreview, setFormattedPreview] = useState<FormattedImportData | null>(null)
  const [selectedNovelId, setSelectedNovelId] = useState<string>('')

  const { data: novels = [] } = useQuery({
    queryKey: ['novels-for-import'],
    queryFn: async () => {
      const token = getToken()
      const headers: Record<string, string> = {}
      if (token) headers['Authorization'] = `Bearer ${token}`
      const res = await fetch('/api/novels?perPage=100', { headers })
      if (!res.ok) return []
      const result = await res.json()
      return (result.data || []) as Array<{ id: string; title: string }>
    },
    enabled: open,
  })

  useEffect(() => {
    if (novels.length > 0 && !selectedNovelId) {
      setSelectedNovelId(novels[0].id)
    }
  }, [novels, selectedNovelId])

  const formatMutation = useMutation({
    mutationFn: async (content: string) => {
      const token = getToken()
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res = await fetch('/api/workshop-format-import/format-import', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          content,
          module: targetModule,
        }),
      })
      if (!res.ok) throw new Error('格式化失败')
      return res.json() as Promise<FormattedImportData>
    },
    onSuccess: (data) => {
      setFormattedPreview(data)
      toast.success('数据解析完成，请确认导入')
    },
    onError: (error) => {
      toast.error(`解析失败: ${(error as Error).message}`)
    },
  })

  const importMutation = useMutation({
    mutationFn: async (params: { module: string; data: Record<string, unknown>; novelId: string }) => {
      const token = getToken()
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res = await fetch('/api/workshop-import/import', {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
      })
      if (!res.ok) throw new Error('导入失败')
      return res.json()
    },
    onSuccess: (data) => {
      if (data.ok) {
        toast.success(data.message || '数据导入成功')
        if (onImportSuccess && formattedPreview) {
          onImportSuccess(formattedPreview)
        }
        handleClose()
      } else {
        toast.error(data.error || '导入失败')
      }
    },
    onError: (error) => {
      toast.error(`导入失败: ${(error as Error).message}`)
    },
  })

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setSelectedFile(file)
      const reader = new FileReader()
      reader.onload = (event) => {
        const content = event.target?.result as string
        setPastedContent(content)
      }
      reader.readAsText(file)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) {
      const validTypes = ['.json', '.txt', '.md', '.markdown']
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase()
      if (!validTypes.includes(ext)) {
        toast.error('仅支持 JSON、TXT、MD 格式文件')
        return
      }
      setSelectedFile(file)
      const reader = new FileReader()
      reader.onload = (event) => {
        const content = event.target?.result as string
        setPastedContent(content)
        setActiveTab('file')
      }
      reader.readAsText(file)
    }
  }, [])

  const handleFormat = useCallback(() => {
    if (!pastedContent.trim()) {
      toast.error('请先导入数据')
      return
    }
    formatMutation.mutate(pastedContent)
  }, [pastedContent, formatMutation])

  const handleConfirmImport = useCallback(() => {
    if (formattedPreview && selectedNovelId) {
      importMutation.mutate({
        module: formattedPreview.module,
        data: formattedPreview.data,
        novelId: selectedNovelId,
      })
    }
  }, [formattedPreview, selectedNovelId, importMutation])

  const handleClose = () => {
    setPastedContent('')
    setSelectedFile(null)
    setFormattedPreview(null)
    setActiveTab('paste')
    setSelectedNovelId('')
    onOpenChange(false)
  }

  const getParseStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />
      case 'warning':
        return <AlertCircle className="h-4 w-4 text-yellow-500" />
      case 'error':
        return <AlertCircle className="h-4 w-4 text-red-500" />
      default:
        return null
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-violet-500" />
            导入数据
          </DialogTitle>
          <DialogDescription>
            导入 JSON、TXT、MD 等格式文件或粘贴数据，AI 将自动识别并格式化为结构化数据
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium shrink-0">导入到：</span>
            <Select value={selectedNovelId} onValueChange={setSelectedNovelId}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="选择小说" />
              </SelectTrigger>
              <SelectContent>
                {novels.map((novel) => (
                  <SelectItem key={novel.id} value={novel.id}>
                    {novel.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-sm font-medium shrink-0">模块：</span>
            <Select value={targetModule} onValueChange={(v) => setTargetModule(v as ImportTargetModule)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODULE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <span className="flex items-center gap-2">
                      <span>{opt.icon}</span>
                      <span>{opt.label}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'paste' | 'file')} className="flex-1 flex flex-col overflow-hidden">
            <TabsList className="shrink-0">
              <TabsTrigger value="paste" className="gap-1.5">
                <ClipboardPaste className="h-4 w-4" />
                粘贴数据
              </TabsTrigger>
              <TabsTrigger value="file" className="gap-1.5">
                <FileJson className="h-4 w-4" />
                上传文件
              </TabsTrigger>
            </TabsList>

            <TabsContent value="paste" className="flex-1 flex flex-col overflow-hidden mt-2">
              <Textarea
                value={pastedContent}
                onChange={(e) => setPastedContent(e.target.value)}
                placeholder={`粘贴你的数据内容...\n\n支持的格式：\n- JSON 格式的结构化数据\n- Markdown 格式的文档\n- 纯文本内容\n\n示例（角色JSON）：\n{\n  "name": "张三",\n  "role": "protagonist",\n  "description": "主角..."\n}`}
                className="flex-1 min-h-[200px] font-mono text-sm"
              />
            </TabsContent>

            <TabsContent value="file" className="flex-1 flex flex-col overflow-hidden mt-2">
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                className="flex-1 border-2 border-dashed border-muted-foreground/25 rounded-lg flex flex-col items-center justify-center p-8 transition-colors hover:border-violet-400 hover:bg-violet-50/50 dark:hover:bg-violet-900/20"
              >
                <input
                  type="file"
                  id="file-input"
                  accept=".json,.txt,.md,.markdown"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <label htmlFor="file-input" className="cursor-pointer flex flex-col items-center gap-3">
                  {selectedFile ? (
                    <>
                      <div className="w-16 h-16 rounded-xl bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center">
                        <FileText className="h-8 w-8 text-violet-600" />
                      </div>
                      <div className="text-center">
                        <p className="font-medium">{selectedFile.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {(selectedFile.size / 1024).toFixed(1)} KB
                        </p>
                      </div>
                      <Button variant="outline" size="sm" className="mt-2">
                        重新选择文件
                      </Button>
                    </>
                  ) : (
                    <>
                      <div className="w-16 h-16 rounded-xl bg-muted flex items-center justify-center">
                        <Upload className="h-8 w-8 text-muted-foreground" />
                      </div>
                      <div className="text-center">
                        <p className="font-medium">拖拽文件到此处，或点击选择</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          支持 .json, .txt, .md, .markdown 格式
                        </p>
                      </div>
                    </>
                  )}
                </label>
              </div>
            </TabsContent>
          </Tabs>

          <Button
            onClick={handleFormat}
            disabled={!pastedContent.trim() || formatMutation.isPending}
            className="shrink-0"
          >
            {formatMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                AI 正在解析...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                解析数据
              </>
            )}
          </Button>

          {formattedPreview && (
            <div className="flex-1 overflow-hidden flex flex-col border rounded-lg">
              <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/50">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">解析预览</span>
                  {getParseStatusIcon(formattedPreview.parseStatus)}
                  <Badge variant="outline" className="text-xs">
                    {MODULE_OPTIONS.find((m) => m.value === formattedPreview.module)?.label}
                  </Badge>
                </div>
                {formattedPreview.parseMessage && (
                  <span className="text-xs text-muted-foreground">{formattedPreview.parseMessage}</span>
                )}
              </div>
              <ScrollArea className="flex-1">
                <pre className="p-4 text-xs font-mono whitespace-pre-wrap break-all">
                  {JSON.stringify(formattedPreview.data, null, 2)}
                </pre>
              </ScrollArea>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            取消
          </Button>
          <Button
            onClick={handleConfirmImport}
            disabled={!formattedPreview || !selectedNovelId || importMutation.isPending}
          >
            {importMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                导入中...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                确认导入
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}