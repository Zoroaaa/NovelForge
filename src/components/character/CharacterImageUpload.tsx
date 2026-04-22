/**
 * @file CharacterImageUpload.tsx
 * @description 角色图片上传组件，支持拖拽上传、图片预览和AI视觉分析
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { useState, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { getToken } from '@/lib/api'
import { toast } from 'sonner'
import type { Character } from '@/lib/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Upload,
  Image as ImageIcon,
  X,
  Loader2,
  Brain,
  CheckCircle2,
  Sparkles,
} from 'lucide-react'

interface CharacterImageUploadProps {
  characterId: string
  characterName: string
  currentImageR2Key?: string | null
  onUploadSuccess?: () => void
  onAnalysisComplete?: (analysis: any) => void
}

export function CharacterImageUpload({
  characterId,
  characterName,
  currentImageR2Key,
  onUploadSuccess,
  onAnalysisComplete,
}: CharacterImageUploadProps) {
  const [open, setOpen] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(
    currentImageR2Key ? `/api/characters/${characterId}/image` : null
  )
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisResult, setAnalysisResult] = useState<any>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 上传 mutation
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('image', file)
      formData.append('analyze', 'true')

      const token = getToken()
      const headers: Record<string, string> = {}
      if (token) headers['Authorization'] = `Bearer ${token}`
      const response = await fetch(`/api/characters/${characterId}/image`, {
        method: 'POST',
        headers,
        body: formData,
      })

      if (!response.ok) {
        throw new Error(`上传失败: ${response.status}`)
      }

      return response.json()
    },
    onSuccess: (data) => {
      if (data.imageR2Key) {
        setPreviewUrl(`/api/characters/${characterId}/image`)
        onUploadSuccess?.()
        toast.success('✅ 图片上传成功')
      }

      // 如果有分析结果
      if (data.analysis) {
        setAnalysisResult(data.analysis)
        setIsAnalyzing(false)
        onAnalysisComplete?.(data.analysis)
        toast.success('🧠 AI 分析完成')
      }
    },
    onError: (error) => {
      toast.error(`上传失败: ${(error as Error).message}`)
      setIsAnalyzing(false)
    },
  })

  // 处理文件选择
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      validateAndPreview(file)
    }
  }

  // 处理拖放
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) {
      validateAndPreview(file)
    }
  }

  // 验证并预览
  const validateAndPreview = (file: File) => {
    // 验证文件类型
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    if (!allowedTypes.includes(file.type)) {
      toast.error('请选择支持的图片格式（JPEG/PNG/GIF/WebP）')
      return
    }

    // 验证文件大小（5MB）
    if (file.size > 5 * 1024 * 1024) {
      toast.error('图片大小不能超过 5MB')
      return
    }

    setSelectedFile(file)

    // 创建预览 URL
    const reader = new FileReader()
    reader.onloadend = () => {
      setPreviewUrl(reader.result as string)
    }
    reader.readAsDataURL(file)
  }

  // 执行上传
  const handleUpload = () => {
    if (!selectedFile) return
    setIsAnalyzing(true)
    uploadMutation.mutate(selectedFile)
  }

  // 清除当前状态
  const handleClear = () => {
    setPreviewUrl(null)
    setSelectedFile(null)
    setAnalysisResult(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="relative group">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt={characterName}
              className="w-16 h-16 rounded-lg object-cover border-2 border-border group-hover:border-primary transition-colors"
            />
          ) : (
            <div className="w-16 h-16 rounded-lg border-2 border-dashed border-border flex items-center justify-center bg-muted/30 group-hover:border-primary transition-colors">
              <ImageIcon className="h-6 w-6 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
          )}
          <div className="absolute inset-0 rounded-lg bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
            <Upload className="h-4 w-4 text-white" />
          </div>
        </button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5" />
            上传角色图片
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* 拖放区域 */}
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
            className={`relative border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              previewUrl
                ? 'border-primary/30 bg-primary/5'
                : 'border-muted-foreground/25 hover:border-primary hover:bg-muted/30'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              onChange={handleFileSelect}
              className="hidden"
            />

            {previewUrl ? (
              <div className="space-y-3">
                <img
                  src={previewUrl}
                  alt="预览"
                  className="max-h-48 mx-auto rounded-lg object-contain"
                />
                <p className="text-sm text-muted-foreground">点击或拖放更换图片</p>
              </div>
            ) : (
              <div className="space-y-3">
                <Upload className="h-12 w-12 mx-auto text-muted-foreground" />
                <div>
                  <p className="font-medium">点击或拖放图片到此处</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    支持 JPEG、PNG、GIF、WebP，最大 5MB
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* AI 分析选项 */}
          {selectedFile && !analysisResult && (
            <div className="flex items-center gap-2 p-3 bg-purple-50 dark:bg-purple-950 border border-purple-200 dark:border-purple-800 rounded-lg">
              <Brain className="h-5 w-5 text-purple-600 dark:text-purple-400 shrink-0" />
              <span className="text-sm text-purple-700 dark:text-purple-300">
                上传后将使用 AI 自动分析图片特征
              </span>
            </div>
          )}

          {/* 分析结果 */}
          {analysisResult && (
            <div className="space-y-3 p-4 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg animate-in slide-in-from-bottom-2">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="h-5 w-5 text-green-600 dark:text-green-400" />
                <span className="font-medium text-green-700 dark:text-green-300">
                  AI 分析完成
                </span>
              </div>

              {analysisResult.description && (
                <div className="space-y-1">
                  <Label className="text-xs text-green-600 dark:text-green-400">外貌描述</Label>
                  <p className="text-sm text-green-900 dark:text-green-100 leading-relaxed">
                    {analysisResult.description}
                  </p>
                </div>
              )}

              {analysisResult.tags && analysisResult.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {analysisResult.tags.map((tag: string, idx: number) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 bg-white/60 dark:bg-black/20 rounded-full text-xs font-medium text-green-700 dark:text-green-300"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              <Button
                variant="outline"
                size="sm"
                className="mt-3 w-full gap-2"
                onClick={() => {
                  onAnalysisComplete?.(analysisResult)
                  toast.success('已应用分析结果')
                }}
              >
                <CheckCircle2 className="h-4 w-4" />
                应用分析结果到角色描述
              </Button>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex justify-between pt-2">
            {(previewUrl || selectedFile) && (
              <Button variant="ghost" size="sm" onClick={handleClear}>
                <X className="h-4 w-4 mr-1" />
                清除
              </Button>
            )}

            <div className="flex gap-2 ml-auto">
              <Button variant="outline" onClick={() => setOpen(false)}>
                取消
              </Button>

              <Button
                onClick={handleUpload}
                disabled={!selectedFile || uploadMutation.isPending || isAnalyzing}
                className="gap-2 min-w-[120px]"
              >
                {uploadMutation.isPending || isAnalyzing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {isAnalyzing ? '分析中...' : '上传中...'}
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    上传与分析
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
