/**
 * NovelForge · WorkspaceHeader 工作台顶部导航栏
 *
 * 功能：
 * - 返回小说列表
 * - 显示当前小说标题
 * - 进入阅读器
 * - 全局模型配置入口（无需选择章节）
 */

import { Link } from 'react-router-dom'
import { ArrowLeft, BookOpen, Settings2, Home } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { ModelConfig } from '@/components/settings/ModelConfig'
import type { Novel } from '@/lib/types'

interface WorkspaceHeaderProps {
  novel: Novel
}

export function WorkspaceHeader({ novel }: WorkspaceHeaderProps) {
  return (
    <header className="h-14 border-b bg-card/50 backdrop-blur-sm flex items-center px-4 shrink-0">
      {/* 左侧：返回和标题 */}
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <Button variant="ghost" size="icon" asChild className="shrink-0">
          <Link to="/novels" title="返回小说列表">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>

        <div className="flex items-center gap-2 min-w-0">
          <Home className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground">/</span>
          <h1 className="font-medium truncate">{novel.title}</h1>
          {novel.genre && (
            <span className="text-xs text-muted-foreground hidden sm:inline">
              · {novel.genre}
            </span>
          )}
        </div>
      </div>

      {/* 右侧：操作按钮 */}
      <div className="flex items-center gap-2 shrink-0">
        {/* 全局模型配置 */}
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2 hidden sm:flex">
              <Settings2 className="h-4 w-4" />
              模型配置
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Settings2 className="h-5 w-5" />
                模型配置
              </DialogTitle>
            </DialogHeader>
            <div className="mt-4">
              <ModelConfig novelId={novel.id} />
            </div>
          </DialogContent>
        </Dialog>

        {/* 进入阅读器 */}
        <Button variant="outline" size="sm" className="gap-2" asChild>
          <Link to={`/novels/${novel.id}/read`}>
            <BookOpen className="h-4 w-4" />
            <span className="hidden sm:inline">阅读</span>
          </Link>
        </Button>
      </div>
    </header>
  )
}
