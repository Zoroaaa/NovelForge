import { useNavigate } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MoreHorizontal, BookOpen, FileText, Trash2, Edit } from 'lucide-react'
import type { Novel } from '@/lib/types'

interface NovelCardProps {
  novel: Novel
  onEdit: (novel: Novel) => void
  onDelete: (id: string) => void
}

const genreColors: Record<string, string> = {
  '玄幻': 'bg-purple-100 text-purple-800',
  '仙侠': 'bg-blue-100 text-blue-800',
  '都市': 'bg-green-100 text-green-800',
  '科幻': 'bg-cyan-100 text-cyan-800',
  '其他': 'bg-gray-100 text-gray-800',
}

export function NovelCard({ novel, onEdit, onDelete }: NovelCardProps) {
  const navigate = useNavigate()

  return (
    <Card className="group hover:shadow-lg transition-all duration-200 cursor-pointer">
      <CardContent className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div
            className="flex-1"
            onClick={() => navigate(`/novels/${novel.id}`)}
          >
            <h3 className="text-lg font-semibold mb-2 line-clamp-1">{novel.title}</h3>
            {novel.genre && (
              <Badge variant="secondary" className={genreColors[novel.genre] || genreColors['其他']}>
                {novel.genre}
              </Badge>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100 transition-opacity">
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
                编辑
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDelete(novel.id)} className="text-destructive">
                <Trash2 className="mr-2 h-4 w-4" />
                删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {novel.description && (
          <p className="text-sm text-muted-foreground mb-4 line-clamp-2">{novel.description}</p>
        )}

        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <FileText className="h-3 w-3" />
            {(novel.wordCount / 1000).toFixed(1)}k 字
          </span>
          <span>{novel.chapterCount} 章</span>
          <span>{new Date(novel.updatedAt).toLocaleDateString()}</span>
        </div>
      </CardContent>
    </Card>
  )
}
