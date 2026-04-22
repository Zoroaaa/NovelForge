/**
 * @file NovelCard.tsx
 * @description 小说卡片组件，展示单个小说的信息和操作入口
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getToken } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  MoreHorizontal,
  BookOpen,
  FileText,
  Trash2,
  Edit,
  Clock,
  Sparkles,
  ChevronRight,
  ImagePlus,
  RefreshCw,
} from 'lucide-react'
import type { Novel } from '@/lib/types'

interface NovelCardProps {
  novel: Novel
  onEdit: (novel: Novel) => void
  onDelete: (novel: Novel) => void
  onStatusChange?: (id: string, status: string) => void
}

const genreColors: Record<string, string> = {
  '玄幻': 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  '仙侠': 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  '都市': 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  '科幻': 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300',
  '历史': 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  '悬疑': 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  '其他': 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
}

const statusConfig: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  draft: { 
    label: '草稿', 
    color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
    icon: <Sparkles className="h-3 w-3" />
  },
  writing: { 
    label: '连载中', 
    color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    icon: <BookOpen className="h-3 w-3" />
  },
  completed: { 
    label: '已完成', 
    color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    icon: <FileText className="h-3 w-3" />
  },
  archived: { 
    label: '已归档', 
    color: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
    icon: <Clock className="h-3 w-3" />
  },
}

export function NovelCard({ novel, onEdit, onDelete, onStatusChange }: NovelCardProps) {
  const navigate = useNavigate()
  const [uploading, setUploading] = useState(false)
  const [coverUrl, setCoverUrl] = useState(novel.coverR2Key ? `/api/novels/${novel.id}/cover?t=${novel.updatedAt}` : null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    try {
      const token = getToken()
      const headers: Record<string, string> = { 'Content-Type': file.type }
      if (token) headers['Authorization'] = `Bearer ${token}`
      const resp = await fetch(`/api/novels/${novel.id}/cover`, {
        method: 'POST',
        body: file,
        headers,
      })
      if (!resp.ok) throw new Error('上传失败')
      setCoverUrl(`/api/novels/${novel.id}/cover?t=${Date.now()}`)
    } catch (error) {
      console.error('Cover upload failed:', error)
    } finally {
      setUploading(false)
    }
  }

  const getGradient = (title: string) => {
    const colors = [
      'from-purple-500/20 to-blue-500/20',
      'from-blue-500/20 to-cyan-500/20',
      'from-green-500/20 to-emerald-500/20',
      'from-orange-500/20 to-red-500/20',
      'from-pink-500/20 to-rose-500/20',
    ]
    const index = title.charCodeAt(0) % colors.length
    return colors[index]
  }

  return (
    <Card className="group relative overflow-hidden hover:shadow-xl transition-all duration-300 cursor-pointer border-0 bg-card/50 backdrop-blur-sm">
      <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${getGradient(novel.title)}`} />
      
      <CardContent className="p-6">
        {/* 封面图区域 */}
        <div className="flex gap-4 mb-4">
          {coverUrl ? (
            <div className="relative w-24 h-32 shrink-0 rounded-lg overflow-hidden border bg-muted group/cover">
              <img
                src={coverUrl}
                alt={novel.title}
                className="w-full h-full object-cover"
              />
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  inputRef.current?.click()
                }}
                className="absolute inset-0 bg-black/50 opacity-0 group-hover/cover:opacity-100 transition-opacity flex items-center justify-center"
              >
                <ImagePlus className="h-5 w-5 text-white" />
              </button>
            </div>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation()
                inputRef.current?.click()
              }}
              disabled={uploading}
              className="w-24 h-32 shrink-0 rounded-lg border-2 border-dashed border-muted-foreground/30 hover:border-primary/50 transition-colors flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-primary"
            >
              {uploading ? (
                <div className="h-5 w-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <ImagePlus className="h-5 w-5" />
                  <span className="text-[10px]">上传封面</span>
                </>
              )}
            </button>
          )}

          <div className="flex-1 min-w-0">
            <div
              onClick={() => navigate(`/novels/${novel.id}`)}
            >
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-lg font-semibold line-clamp-1 group-hover:text-primary transition-colors">
                  {novel.title}
                </h3>
                <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-all transform group-hover:translate-x-1" />
              </div>
              
              <div className="flex items-center gap-2 flex-wrap">
                {novel.genre && (
                  <Badge variant="secondary" className={`${genreColors[novel.genre] || genreColors['其他']} text-xs`}>
                    {novel.genre}
                  </Badge>
                )}
                {statusConfig[novel.status] && (
                  <Badge variant="secondary" className={`${statusConfig[novel.status].color} text-xs flex items-center gap-1`}>
                    {statusConfig[novel.status].icon}
                    {statusConfig[novel.status].label}
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleCoverUpload}
        />

        {novel.description ? (
          <p className="text-sm text-muted-foreground mb-4 line-clamp-2 leading-relaxed">
            {novel.description}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground/50 mb-4 italic">
            暂无描述
          </p>
        )}

        <div className="flex items-center justify-between pt-4 border-t border-border/50">
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              <span className="font-medium">{(novel.wordCount / 1000).toFixed(1)}k</span>
              <span>字</span>
            </span>
            <span className="flex items-center gap-1.5">
              <BookOpen className="h-3.5 w-3.5" />
              <span className="font-medium">{novel.chapterCount}</span>
              <span>章</span>
            </span>
          </div>
          
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>{formatDate(novel.updatedAt)}</span>
          </div>
        </div>
      </CardContent>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button 
            variant="ghost" 
            size="icon" 
            className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => navigate(`/novels/${novel.id}`)}>
            <BookOpen className="mr-2 h-4 w-4" />
            进入工作台
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onEdit(novel)}>
            <Edit className="mr-2 h-4 w-4" />
            编辑信息
          </DropdownMenuItem>
          {onStatusChange && (
            <>
              <div className="h-px bg-border my-1" />
              <div className="px-2 py-1.5 text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                <RefreshCw className="h-3 w-3" />
                更改状态
              </div>
              {Object.entries(statusConfig)
                .filter(([key]) => key !== novel.status)
                .map(([status, config]) => (
                  <DropdownMenuItem 
                    key={status}
                    onClick={() => onStatusChange(novel.id, status)}
                    className="pl-6"
                  >
                    {config.icon}
                    <span className="ml-2">{config.label}</span>
                  </DropdownMenuItem>
                ))
              }
            </>
          )}
          <div className="h-px bg-border my-1" />
          <DropdownMenuItem onClick={() => onDelete(novel)} className="text-destructive">
            <Trash2 className="mr-2 h-4 w-4" />
            删除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </Card>
  )
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  if (hours < 24) return `${hours}小时前`
  if (days < 30) return `${days}天前`
  
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}
