import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Character } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Plus, User, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CharacterImageUpload } from './CharacterImageUpload'

interface CharacterListProps {
  novelId: string
}

export function CharacterList({ novelId }: CharacterListProps) {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [name, setName] = useState('')
  const [role, setRole] = useState('supporting')
  const [description, setDescription] = useState('')
  const [aliases, setAliases] = useState('')

  const { data: characters, isLoading } = useQuery({
    queryKey: ['characters', novelId],
    queryFn: () => api.characters.list(novelId),
  })

  const createMutation = useMutation({
    mutationFn: (data: any) => api.characters.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['characters', novelId] })
      toast.success('角色已创建')
      setDialogOpen(false)
      resetForm()
    },
    onError: (error) => toast.error(error.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.characters.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['characters', novelId] })
      toast.success('已删除')
    },
    onError: (error) => toast.error(error.message),
  })

  const resetForm = () => {
    setName('')
    setRole('supporting')
    setDescription('')
    setAliases('')
  }

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    createMutation.mutate({
      novelId,
      name: name.trim(),
      role,
      description: description.trim() || null,
      aliases: aliases.trim() || null,
    })
  }

  // 处理图片分析结果
  const handleAnalysisComplete = (analysis: any) => {
    if (analysis.description) {
      setDescription(analysis.description)
    }
  }

  const roleLabels: Record<string, string> = {
    'protagonist': '主角',
    'antagonist': '反派',
    'supporting': '配角',
    'minor': '次要角色',
  }

  if (isLoading) {
    return <div className="animate-pulse space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-muted rounded-lg" />)}</div>
  }

  return (
    <div className="space-y-2">
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="w-full gap-2">
            <Plus className="h-4 w-4" />
            添加角色
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加新角色</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            {/* 图片上传 */}
            <div className="flex justify-center">
              <CharacterImageUpload
                characterId="temp"
                characterName={name || '新角色'}
                onUploadSuccess={() => {}}
                onAnalysisComplete={handleAnalysisComplete}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="char-name">姓名 *</Label>
              <Input
                id="char-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="输入角色姓名"
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label>角色定位</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(roleLabels).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="char-aliases">别名/称号</Label>
              <Input
                id="char-aliases"
                value={aliases}
                onChange={(e) => setAliases(e.target.value)}
                placeholder="多个别名用逗号分隔（选填）"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="char-desc">描述</Label>
              <Textarea
                id="char-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="角色背景、性格特点等（选填，可上传图片自动生成）"
                rows={3}
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
              <Button type="submit" disabled={!name.trim() || createMutation.isPending}>创建</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <div className="mt-4 space-y-2">
        {characters && characters.length > 0 ? (
          characters.map((character: Character) => (
            <div
              key={character.id}
              className="p-3 border rounded-lg hover:bg-muted/50 group transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {/* 角色头像 */}
                  <CharacterImageUpload
                    characterId={character.id}
                    characterName={character.name}
                    currentImageUrl={character.imageUrl}
                    onUploadSuccess={(url) => {
                      queryClient.invalidateQueries({ queryKey: ['characters', novelId] })
                    }}
                  />

                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{character.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {character.role ? (roleLabels[character.role] || character.role) : ''}
                      {character.aliases && ` · ${character.aliases}`}
                    </div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 opacity-0 group-hover:opacity-100 text-destructive shrink-0"
                  onClick={() => deleteMutation.mutate(character.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              {character.description && (
                <p className="text-xs text-muted-foreground mt-2 pl-6 line-clamp-2">
                  {character.description}
                </p>
              )}
            </div>
          ))
        ) : (
          <div className="text-center py-8 text-muted-foreground space-y-2">
            <User className="h-10 w-10 mx-auto opacity-20" />
            <p className="text-sm">暂无角色</p>
            <p className="text-xs opacity-60">点击上方按钮添加角色</p>
          </div>
        )}
      </div>
    </div>
  )
}
