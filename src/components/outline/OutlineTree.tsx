import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Outline, OutlineInput } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Plus, ChevronRight, ChevronDown, FileText } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface OutlineNode extends Outline {
  children: OutlineNode[]
}

function buildTree(flat: Outline[]): OutlineNode[] {
  const map = new Map(flat.map(o => [o.id, { ...o, children: [] as OutlineNode[] }]))
  const roots: OutlineNode[] = []
  for (const node of map.values()) {
    if (node.parentId) map.get(node.parentId)?.children.push(node)
    else roots.push(node)
  }
  const sort = (arr: OutlineNode[]) => {
    arr.sort((a, b) => a.sortOrder - b.sortOrder)
    arr.forEach(n => sort(n.children))
    return arr
  }
  return sort(roots)
}

interface OutlineTreeProps {
  novelId: string
}

export function OutlineTree({ novelId }: OutlineTreeProps) {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [parentId, setParentId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [type, setType] = useState('chapter_outline')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const { data: outlines, isLoading } = useQuery({
    queryKey: ['outlines', novelId],
    queryFn: () => api.outlines.list(novelId),
  })

  const createMutation = useMutation({
    mutationFn: api.outlines.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['outlines', novelId] })
      toast.success('大纲已创建')
      setDialogOpen(false)
      setTitle('')
    },
    onError: (error) => toast.error(error.message),
  })

  const deleteMutation = useMutation({
    mutationFn: api.outlines.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['outlines', novelId] })
      toast.success('已删除')
    },
    onError: (error) => toast.error(error.message),
  })

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    const data: OutlineInput = {
      novelId,
      title: title.trim(),
      type: type as any,
      parentId: parentId,
      content: null,
    }
    createMutation.mutate(data)
  }

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const renderNode = (node: OutlineNode, level: number = 0) => {
    const hasChildren = node.children.length > 0
    const isExpanded = expandedIds.has(node.id)

    return (
      <div key={node.id}>
        <div
          className="flex items-center gap-1 py-1 px-2 hover:bg-muted rounded cursor-pointer group"
          style={{ paddingLeft: `${level * 16 + 8}px` }}
        >
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={() => toggleExpand(node.id)}
          >
            {hasChildren ? (
              isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />
            ) : (
              <span className="w-3" />
            )}
          </Button>
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="flex-1 text-sm truncate">{node.title}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 opacity-0 group-hover:opacity-100 text-destructive"
            onClick={() => deleteMutation.mutate(node.id)}
          >
            ×
          </Button>
        </div>
        {hasChildren && isExpanded && (
          <div>{node.children.map(child => renderNode(child, level + 1))}</div>
        )}
      </div>
    )
  }

  if (isLoading) return <div className="animate-pulse space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-8 bg-muted rounded" />)}</div>

  const tree = outlines ? buildTree(outlines) : []

  return (
    <div className="space-y-2">
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="w-full gap-2" onClick={() => setParentId(null)}>
            <Plus className="h-4 w-4" />
            添加大纲节点
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加大纲节点</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label>类型</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="world_setting">世界设定</SelectItem>
                  <SelectItem value="volume">卷</SelectItem>
                  <SelectItem value="chapter_outline">章节大纲</SelectItem>
                  <SelectItem value="custom">自定义</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="outline-title">标题</Label>
              <Input id="outline-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="输入标题" autoFocus />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
              <Button type="submit" disabled={!title.trim() || createMutation.isPending}>创建</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <div className="mt-4">
        {tree.length > 0 ? tree.map(node => renderNode(node)) : <p className="text-sm text-muted-foreground text-center py-4">暂无大纲</p>}
      </div>
    </div>
  )
}
