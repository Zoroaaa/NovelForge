/**
 * @file CreateNovelDialog.tsx
 * @description 创建小说对话框组件，提供新建小说的表单界面
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Plus } from 'lucide-react'
import type { NovelInput } from '@/lib/types'

interface CreateNovelDialogProps {
  onCreate: (data: NovelInput) => void
}

export function CreateNovelDialog({ onCreate }: CreateNovelDialogProps) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [genre, setGenre] = useState('')
  const [targetWordCount, setTargetWordCount] = useState('')
  const [targetChapterCount, setTargetChapterCount] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    onCreate({
      title: title.trim(),
      description: description.trim() || undefined,
      genre: genre || undefined,
      targetWordCount: targetWordCount ? parseInt(targetWordCount, 10) : undefined,
      targetChapterCount: targetChapterCount ? parseInt(targetChapterCount, 10) : undefined,
    })
    setTitle('')
    setDescription('')
    setGenre('')
    setTargetWordCount('')
    setTargetChapterCount('')
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          新建小说
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>创建新小说</DialogTitle>
          <DialogDescription>
            填写小说信息来创建新的小说项目
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">标题 *</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="输入小说标题"
              maxLength={200}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="genre">类型</Label>
            <Select value={genre} onValueChange={setGenre}>
              <SelectTrigger>
                <SelectValue placeholder="选择类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="玄幻">玄幻</SelectItem>
                <SelectItem value="仙侠">仙侠</SelectItem>
                <SelectItem value="都市">都市</SelectItem>
                <SelectItem value="科幻">科幻</SelectItem>
                <SelectItem value="其他">其他</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">简介</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="输入小说简介（选填）"
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="target-word-count">目标字数</Label>
            <Input
              id="target-word-count"
              type="number"
              value={targetWordCount}
              onChange={(e) => setTargetWordCount(e.target.value)}
              placeholder="输入目标总字数（选填）"
              min="0"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="target-chapter-count">预计总章数</Label>
            <Input
              id="target-chapter-count"
              type="number"
              value={targetChapterCount}
              onChange={(e) => setTargetChapterCount(e.target.value)}
              placeholder="输入预计总章数（选填）"
              min="0"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="submit" disabled={!title.trim()}>
              创建
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
