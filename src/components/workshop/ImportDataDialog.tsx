/**
 * @file ImportDataDialog.tsx
 * @description 导入数据对话框 - 支持JSON/TXT/MD格式文件导入和粘贴
 */
import { useState, useCallback, useEffect } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, getToken } from '@/lib/api'
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
  | 'master_outline'

export interface FormattedImportData {
  module: ImportTargetModule
  data: Record<string, unknown> | Record<string, unknown>[]
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
  { value: 'master_outline', label: '总纲', icon: '📜', description: '小说总纲/大纲' },
  { value: 'setting', label: '设定', icon: '⚙️', description: '世界观、势力、地理等设定' },
  { value: 'character', label: '角色', icon: '👤', description: '角色信息' },
  { value: 'rule', label: '规则', icon: '📋', description: '创作规则' },
  { value: 'volume', label: '卷', icon: '📚', description: '卷/部结构' },
  { value: 'foreshadowing', label: '伏笔', icon: '🎭', description: '伏笔线索' },
  { value: 'chapter', label: '章节', icon: '📄', description: '小说章节内容' },
]

const MODULE_FIELD_HINTS: Record<ImportTargetModule, string> = {
  chapter: `可用字段：
• title (必填): 章节标题
• content: 正文内容
• summary: 章节摘要
• volumeTitle: 所属卷标题【智能匹配✨】

示例：
{
  "title": "第一章：觉醒",
  "content": "正文内容...",
  "volumeTitle": "第一卷"
}`,

  character: `可用字段：
• name (必填): 角色姓名
• role: 角色定位 (protagonist/supporting/antagonist/minor)
• description: 综合描述（简要）
• aliases: 别名列表
• powerLevel: 战斗力等级
• relationships: 角色关系列表【存入attributes✨】
• attributes: 详细属性对象【包含appearance/personality/backgroundStory等✨】

示例：
{
  "name": "张三",
  "role": "protagonist",
  "description": "青云宗弟子",
  "relationships": ["苏婉儿(恋人)", "赵长老(师父)"],
  "attributes": {
    "appearance": "身高180cm，相貌英俊",
    "personality": "性格坚毅，重情重义",
    "backgroundStory": "出身平凡村落"
  }
}`,

  volume: `可用字段：
• title (必填): 卷标题
• summary: 卷概要
• blueprint: 详细蓝图
• eventLine: 事件线数组
• notes: 备注数组
• chapterCount: 预计章节数
• targetWordCount: 目标字数【新✨】
• targetChapterCount: 目标章节数【新✨】
• foreshadowingSetup: 伏笔埋设计划数组【新✨】
• foreshadowingResolve: 伏笔回收计划数组【新✨】

示例：
{
  "title": "第一卷：觉醒之路",
  "targetWordCount": 300000,
  "targetChapterCount": 30,
  "foreshadowingSetup": ["神秘玉佩", "血海深仇"]
}`,

  setting: `可用字段：
• name (必填): 设定名称
• type: 设定类型 (worldview/power_system/faction/geography/item_skill/misc)
• category: 分类【新✨】
• content: 详细内容
• importance: 重要程度

示例：
{
  "type": "faction",
  "category": "正道势力",
  "name": "青云宗",
  "content": "宗门详细设定..."
}`,

  rule: `可用字段：
• title (必填): 规则标题
• category: 规则类别 (style/pacing/character/plot/world/taboo/custom)
• content: 规则内容
• priority: 优先级 (1-5)

示例：
{
  "category": "style",
  "title": "第三人称叙事",
  "content": "全篇使用第三人称...",
  "priority": 1
}`,

  foreshadowing: `可用字段：
• title (必填): 伏笔标题
• description: 详细描述
• status: 状态 (open/resolved/abandoned/resolve_planned)
• importance: 重要程度
• volumeTitle: 所属卷标题【智能匹配✨】
• chapterTitle: 埋设章节标题【智能匹配✨】
• resolvedChapterTitle: 回收章节标题【智能匹配✨】

示例：
{
  "title": "神秘玉佩",
  "description": "主角童年获得的玉佩...",
  "volumeTitle": "第一卷",
  "chapterTitle": "第一章",
  "resolvedChapterTitle": "第二十章"
}`,

  master_outline: `可用字段：
• title (必填): 总纲标题
• summary: 摘要【新✨】
• content: 完整内容

示例：
{
  "title": "修仙之路总纲",
  "summary": "本文讲述了一个少年...",
  "content": "# 世界观\\n...\\n# 主线剧情\\n..."
}`,
}

export function ImportDataDialog({ open, onOpenChange, onImportSuccess }: ImportDataDialogProps) {
  const [activeTab, setActiveTab] = useState<'paste' | 'file'>('paste')
  const [pastedContent, setPastedContent] = useState('')
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [targetModule, setTargetModule] = useState<ImportTargetModule>('chapter')
  const [formattedPreview, setFormattedPreview] = useState<FormattedImportData[]>([])
  const [selectedNovelId, setSelectedNovelId] = useState<string>('')
  const [importMode, setImportMode] = useState<'create' | 'update' | 'upsert'>('upsert')
  const [selectedUpdateIds, setSelectedUpdateIds] = useState<Record<number, string>>({})

  const { data: novels = [] } = useQuery({
    queryKey: ['novels-for-import'],
    queryFn: async () => {
      const res = await api.novels.list()
      return (res.data || []) as Array<{ id: string; title: string }>
    },
    enabled: open,
  })

  useEffect(() => {
    if (novels.length > 0 && !selectedNovelId) {
      setSelectedNovelId(novels[0].id)
    }
  }, [novels, selectedNovelId])

  const { data: existingItems = [] } = useQuery({
    queryKey: ['existing-items', targetModule, selectedNovelId],
    queryFn: async () => {
      const res = await api.workshopImport.listExisting(selectedNovelId, targetModule)
      return res.items || []
    },
    enabled: open && importMode === 'update' && !!selectedNovelId,
  })

  const formatMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await api.workshopFormatImport.format(content, targetModule)
      return res as FormattedImportData
    },
    onSuccess: (data) => {
      setFormattedPreview([data])
      toast.success('数据解析完成，请确认导入')
    },
    onError: (error) => {
      toast.error(`解析失败: ${(error as Error).message}`)
    },
  })

  const importMutation = useMutation({
    mutationFn: async (params: { module: string; data: Record<string, unknown>; novelId: string; importMode: string }) => {
      const res = await api.workshopImport.import(params)
      return res
    },
    onSuccess: (data) => {
      if (data.ok) {
        toast.success(data.message || '数据导入成功')
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
    const files = Array.from(e.target.files || [])
    if (files.length > 0) {
      setSelectedFiles(files)
      if (files.length === 1) {
        const reader = new FileReader()
        reader.onload = (event) => {
          const content = event.target?.result as string
          setPastedContent(content)
        }
        reader.readAsText(files[0])
      } else {
        Promise.all(files.map(file => {
          return new Promise<string>((resolve) => {
            const reader = new FileReader()
            reader.onload = (event) => resolve(event.target?.result as string)
            reader.readAsText(file)
          })
        })).then(contents => {
          setPastedContent(contents.join('\n\n--- 文件分割线 ---\n\n'))
        })
      }
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files)
    const validFiles = files.filter(file => {
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase()
      return ['.json', '.txt', '.md', '.markdown'].includes(ext)
    })
    if (validFiles.length > 0) {
      if (validFiles.length === 1) {
        setSelectedFiles(validFiles)
        const reader = new FileReader()
        reader.onload = (event) => {
          const content = event.target?.result as string
          setPastedContent(content)
          setActiveTab('file')
        }
        reader.readAsText(validFiles[0])
      } else {
        setSelectedFiles(prev => [...prev, ...validFiles])
        Promise.all(validFiles.map(file => {
          return new Promise<string>((resolve) => {
            const reader = new FileReader()
            reader.onload = (event) => resolve(event.target?.result as string)
            reader.readAsText(file)
          })
        })).then(contents => {
          setPastedContent(prev => prev + '\n\n--- 文件分割线 ---\n\n' + contents.join('\n\n--- 文件分割线 ---\n\n'))
          setActiveTab('file')
        })
      }
    }
    if (files.length !== validFiles.length) {
      toast.error('部分文件格式不支持，已过滤')
    }
  }, [])

  const handleFormat = useCallback(() => {
    if (!pastedContent.trim()) {
      toast.error('请先导入数据')
      return
    }

    const contents = pastedContent.split(/\n\n--- 文件分割线 ---\n\n/).filter(c => c.trim())

    setFormattedPreview([])

    if (contents.length === 1) {
      formatMutation.mutate(contents[0])
    } else {
      Promise.all(contents.map(content => formatMutation.mutateAsync(content)))
        .then(results => {
          setFormattedPreview(results)
          toast.success(`已解析 ${results.length} 个文件`)
        })
        .catch(() => {
          toast.error('部分文件解析失败')
        })
    }
  }, [pastedContent, formatMutation])

  const handleConfirmImport = useCallback(() => {
    if (formattedPreview.length === 0 || !selectedNovelId) return

    const successfulImports = formattedPreview.filter(p => p.parseStatus !== 'error')

    const flatData: Array<{ idx: number; module: string; data: Record<string, unknown> }> = []

    const flatten = (arr: unknown[], originalIdx: number, module: string) => {
      for (const item of arr) {
        if (Array.isArray(item)) {
          flatten(item, originalIdx, module)
        } else if (item && typeof item === 'object') {
          flatData.push({ idx: originalIdx, module, data: item as Record<string, unknown> })
        }
      }
    }

    for (const preview of successfulImports) {
      const originalIdx = formattedPreview.indexOf(preview)
      if (Array.isArray(preview.data)) {
        flatten(preview.data, originalIdx, preview.module)
      } else {
        flatData.push({ idx: originalIdx, module: preview.module, data: preview.data })
      }
    }

    if (flatData.length === 1) {
      const item = flatData[0]
      const data = importMode === 'update' && selectedUpdateIds[item.idx]
        ? { ...item.data, id: selectedUpdateIds[item.idx] }
        : item.data
      importMutation.mutate({
        module: item.module,
        data,
        novelId: selectedNovelId,
        importMode,
      })
    } else {
      Promise.all(
        flatData.map((item, idx) => {
          const data = importMode === 'update' && selectedUpdateIds[item.idx]
            ? { ...item.data, id: selectedUpdateIds[item.idx] }
            : item.data
          return importMutation.mutateAsync({
            module: item.module,
            data,
            novelId: selectedNovelId,
            importMode,
          })
        })
      ).then(() => {
        toast.success(`成功导入 ${flatData.length} 条数据`)
        handleClose()
      }).catch(() => {
        toast.error('部分数据导入失败')
      })
    }
  }, [formattedPreview, selectedNovelId, importMode, importMutation, selectedUpdateIds])

  const handleClose = () => {
    setPastedContent('')
    setSelectedFiles([])
    setFormattedPreview([])
    setSelectedUpdateIds({})
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

  const NEW_FIELDS_PER_MODULE: Record<ImportTargetModule, string[]> = {
    chapter: ['volumeTitle'],
    character: ['relationships', 'attributes'],
    volume: ['targetWordCount', 'targetChapterCount', 'foreshadowingSetup', 'foreshadowingResolve'],
    setting: ['category'],
    foreshadowing: ['volumeTitle', 'chapterTitle', 'resolvedChapterTitle'],
    rule: [],
    master_outline: ['summary'],
  }

  const isNewField = (module: ImportTargetModule, fieldName: string): boolean => {
    return NEW_FIELDS_PER_MODULE[module]?.includes(fieldName) || false
  }

  const renderFieldTable = (module: ImportTargetModule, data: Record<string, unknown>) => {
    const entries = Object.entries(data).filter(([key]) => key !== 'raw')
    if (entries.length === 0) return null

    const newFieldCount = entries.filter(([key]) => isNewField(module, key)).length

    return (
      <div className="mt-3 border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b">
          <span className="text-xs font-medium">📋 字段详情 ({entries.length} 个字段)</span>
          {newFieldCount > 0 && (
            <Badge variant="default" className="bg-green-100 text-green-700 hover:bg-green-200 text-xs">
              {newFieldCount} 个新增✨
            </Badge>
          )}
        </div>
        <div className="max-h-[150px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/50">
              <tr className="border-b">
                <th className="text-left p-2 font-medium">字段</th>
                <th className="text-left p-2 font-medium">值</th>
                <th className="text-center p-2 font-medium w-20">状态</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(([key, value]) => (
                <tr key={key} className="border-b hover:bg-muted/30">
                  <td className="p-2 font-mono font-medium">{key}</td>
                  <td className="p-2 max-w-[220px] truncate" title={typeof value === 'object' ? JSON.stringify(value) : String(value)}>
                    {typeof value === 'object' && value !== null
                      ? `[${Array.isArray(value) ? '数组' : '对象'}]`
                      : String(value)
                    }
                  </td>
                  <td className="p-2 text-center">
                    {isNewField(module, key) ? (
                      <Badge variant="default" className="bg-green-100 text-green-700 text-xs px-1.5 py-0.5">
                        新增
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs px-1.5 py-0.5">
                        标准
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
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

        <ScrollArea className="flex-1 min-h-0">
        <div className="flex flex-col gap-4 pb-2" style={{ minHeight: 0 }}>
          <div className="flex items-center gap-3 flex-shrink-0">
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
            <span className="text-sm font-medium shrink-0">模式：</span>
            <Select value={importMode} onValueChange={(v) => setImportMode(v as 'create' | 'update' | 'upsert')}>
              <SelectTrigger className="w-[100px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="create">仅新建</SelectItem>
                <SelectItem value="update">仅更新</SelectItem>
                <SelectItem value="upsert">智能导入</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'paste' | 'file')} className="flex-shrink-0 flex flex-col">
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

            <TabsContent value="paste" className="mt-2">
              <Textarea
                value={pastedContent}
                onChange={(e) => setPastedContent(e.target.value)}
                placeholder={`粘贴你的数据内容...\n\n支持的格式：\n- JSON 格式的结构化数据\n- Markdown 格式的文档\n- 纯文本内容\n\n${MODULE_FIELD_HINTS[targetModule]}`}
                className="h-[180px] font-mono text-sm resize-none"
              />
            </TabsContent>

            <TabsContent value="file" className="mt-2">
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                className="h-[180px] border-2 border-dashed border-muted-foreground/25 rounded-lg flex flex-col items-center justify-center p-4 transition-colors hover:border-violet-400 hover:bg-violet-50/50 dark:hover:bg-violet-900/20 overflow-y-auto"
              >
                <input
                  type="file"
                  id="file-input"
                  accept=".json,.txt,.md,.markdown"
                  onChange={handleFileSelect}
                  multiple
                  className="hidden"
                />
                <label htmlFor="file-input" className="cursor-pointer flex flex-col items-center gap-3">
                  {selectedFiles.length > 0 ? (
                    <>
                      <div className="w-full max-w-md">
                        <div className="flex items-center gap-2 mb-2">
                          <FileText className="h-5 w-5 text-violet-600" />
                          <span className="text-sm font-medium">已选择 {selectedFiles.length} 个文件</span>
                        </div>
                        <div className="space-y-1 max-h-[88px] overflow-y-auto pr-1">
                          {selectedFiles.map((file, idx) => (
                            <div key={idx} className="flex items-center justify-between text-sm bg-muted/50 rounded px-2 py-1">
                              <span className="truncate">{file.name}</span>
                              <span className="text-xs text-muted-foreground ml-2">{(file.size / 1024).toFixed(1)} KB</span>
                            </div>
                          ))}
                        </div>
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
                          支持 .json, .txt, .md, .markdown 格式，可多选
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

          {formattedPreview.length > 0 && (
            <div className="flex flex-col border rounded-lg overflow-hidden flex-shrink-0" style={{ maxHeight: '280px' }}>
              <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/50 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">解析预览 ({formattedPreview.length} 个文件)</span>
                  {formattedPreview.length === 1 && getParseStatusIcon(formattedPreview[0].parseStatus)}
                  {formattedPreview.length > 1 && (
                    <Badge variant="outline" className="text-xs">
                      {formattedPreview.filter(p => p.parseStatus === 'success').length}/{formattedPreview.length} 成功
                    </Badge>
                  )}
                </div>
                {formattedPreview.length === 1 && formattedPreview[0].parseMessage && (
                  <span className="text-xs text-muted-foreground">{formattedPreview[0].parseMessage}</span>
                )}
              </div>
              <ScrollArea className="flex-1 overflow-y-auto">
                <div className="p-4 space-y-4">
                  {formattedPreview.map((preview, idx) => (
                    <div key={idx} className="border rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className="text-sm font-medium">文件 {idx + 1}</span>
                        {getParseStatusIcon(preview.parseStatus)}
                        <Badge variant="outline" className="text-xs">
                          {MODULE_OPTIONS.find((m) => m.value === preview.module)?.label}
                        </Badge>
                        {importMode === 'update' && existingItems.length > 0 && (
                          <Select
                            value={selectedUpdateIds[idx] || ''}
                            onValueChange={(value) => setSelectedUpdateIds(prev => ({ ...prev, [idx]: value }))}
                          >
                            <SelectTrigger className="w-[180px] h-7 text-xs">
                              <SelectValue placeholder="选择要更新的记录" />
                            </SelectTrigger>
                            <SelectContent>
                              {existingItems.map((item: any) => (
                                <SelectItem key={item.id} value={item.id}>
                                  {item.name || item.title || `ID: ${item.id.slice(0, 8)}`}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                      <pre className="text-xs font-mono whitespace-pre-wrap break-all bg-muted/50 p-2 rounded overflow-x-auto max-h-[160px] overflow-y-auto">
                        {JSON.stringify(preview.data, null, 2)}
                      </pre>
                      {preview.data && typeof preview.data === 'object' && !Array.isArray(preview.data) && renderFieldTable(preview.module, preview.data as Record<string, unknown>)}
                      {preview.module === 'volume' && preview.data && typeof preview.data === 'object' && 'targetWordCount' in (preview.data as Record<string, unknown>) && (
                        <div className="mt-2 p-2 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded text-xs">
                          <span className="text-blue-700 dark:text-blue-300 font-medium">📊 目标字数：</span>
                          <span className="text-blue-600 dark:text-blue-400">
                            {((preview.data as Record<string, unknown>).targetWordCount as number)?.toLocaleString()} 字
                            {((preview.data as Record<string, unknown>).targetChapterCount as number) && (
                              <span className="ml-2 text-muted-foreground">
                                （目标 {(preview.data as Record<string, unknown>).targetChapterCount as number} 章）
                              </span>
                            )}
                          </span>
                        </div>
                      )}
                      {preview.parseMessage && (
                        <p className="text-xs text-muted-foreground mt-1">{preview.parseMessage}</p>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            取消
          </Button>
          <Button
            onClick={handleConfirmImport}
            disabled={formattedPreview.length === 0 || !selectedNovelId || importMutation.isPending}
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