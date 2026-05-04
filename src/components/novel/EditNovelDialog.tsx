/**
 * @file EditNovelDialog.tsx
 * @description 编辑小说对话框 - 修改小说标题、描述、封面等基本信息
 * @date 2026-05-04
 */
import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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

interface EditNovelDialogProps {
  novelId: string
  initialTitle: string
  initialDescription: string
  initialGenre: string
  initialTargetWordCount?: number | null
  initialTargetChapterCount?: number | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (id: string, data: { title: string; description?: string; genre?: string; targetWordCount?: number; targetChapterCount?: number }) => void
}

export function EditNovelDialog({ 
  novelId,
  initialTitle,
  initialDescription,
  initialGenre,
  initialTargetWordCount,
  initialTargetChapterCount,
  open, 
  onOpenChange, 
  onSave 
}: EditNovelDialogProps) {
  const [title, setTitle] = useState(initialTitle)
  const [description, setDescription] = useState(initialDescription)
  const [genre, setGenre] = useState(initialGenre)
  const [targetWordCount, setTargetWordCount] = useState(initialTargetWordCount?.toString() || '')
  const [targetChapterCount, setTargetChapterCount] = useState(initialTargetChapterCount?.toString() || '')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    onSave(novelId, { 
      title: title.trim(), 
      description: description.trim() || undefined, 
      genre: genre || undefined,
      targetWordCount: targetWordCount ? parseInt(targetWordCount, 10) : undefined,
      targetChapterCount: targetChapterCount ? parseInt(targetChapterCount, 10) : undefined,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>编辑小说</DialogTitle>
          <DialogDescription>
            修改小说的标题、类型和简介信息
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-title">标题 *</Label>
            <Input
              id="edit-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="输入小说标题"
              maxLength={200}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-genre">类型</Label>
            <Select value={genre} onValueChange={setGenre}>
              <SelectTrigger>
                <SelectValue placeholder="选择类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="玄幻">玄幻</SelectItem>
                <SelectItem value="仙侠">仙侠</SelectItem>
                <SelectItem value="都市">都市</SelectItem>
                <SelectItem value="科幻">科幻</SelectItem>
                <SelectItem value="历史">历史</SelectItem>
                <SelectItem value="悬疑">悬疑</SelectItem>
                <SelectItem value="其他">其他</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-description">简介</Label>
            <Textarea
              id="edit-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="输入小说简介（选填）"
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-target-word-count">目标字数</Label>
            <Input
              id="edit-target-word-count"
              type="number"
              value={targetWordCount}
              onChange={(e) => setTargetWordCount(e.target.value)}
              placeholder="输入目标总字数（选填）"
              min="0"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-target-chapter-count">预计总章数</Label>
            <Input
              id="edit-target-chapter-count"
              type="number"
              value={targetChapterCount}
              onChange={(e) => setTargetChapterCount(e.target.value)}
              placeholder="输入预计总章数（选填）"
              min="0"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={!title.trim()}>
              保存
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
