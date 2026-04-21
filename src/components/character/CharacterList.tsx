/**
 * @file CharacterList.tsx
 * @description 角色列表组件，提供角色的展示、创建、编辑和删除功能
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Character } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Plus, User, Trash2, Edit2, Swords } from 'lucide-react'
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
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [role, setRole] = useState('supporting')
  const [description, setDescription] = useState('')
  const [aliases, setAliases] = useState('')
  const [powerLevel, setPowerLevel] = useState('')
  const [attributes, setAttributes] = useState('')

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

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.characters.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['characters', novelId] })
      toast.success('角色已更新')
      setDialogOpen(false)
      resetForm()
    },
    onError: (error) => toast.error(error.message),
  })

  const resetForm = () => {
    setEditingId(null)
    setName('')
    setRole('supporting')
    setDescription('')
    setAliases('')
    setPowerLevel('')
    setAttributes('')
  }

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    const characterData: any = {
      novelId,
      name: name.trim(),
      role,
      description: description.trim() || null,
      aliases: aliases.trim() || null,
    }

    if (powerLevel.trim()) {
      characterData.powerLevel = powerLevel.trim()
    }
    if (attributes.trim()) {
      characterData.attributes = attributes.trim()
    }

    if (editingId) {
      updateMutation.mutate({ id: editingId, data: characterData })
    } else {
      createMutation.mutate(characterData)
    }
  }

  const handleEdit = (character: Character) => {
    setEditingId(character.id)
    setName(character.name)
    setRole(character.role || 'supporting')
    setDescription(character.description || '')
    setAliases(character.aliases || '')
    setPowerLevel(character.powerLevel || '')
    setAttributes(character.attributes || '')
    setDialogOpen(true)
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
    return (
      <div className="p-4 space-y-3">
        {[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />)}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* 操作栏 */}
      <div className="px-4 py-3 border-b">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="w-full gap-2 h-8">
              <Plus className="h-3.5 w-3.5" />
              添加角色
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingId ? '编辑角色' : '添加新角色'}</DialogTitle>
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

              <div className="space-y-2">
                <Label htmlFor="char-power-level" className="flex items-center gap-1.5">
                  <Swords className="h-4 w-4" />
                  境界信息
                </Label>
                <Input
                  id="char-power-level"
                  value={powerLevel}
                  onChange={(e) => setPowerLevel(e.target.value)}
                  placeholder='如：{"realm": "金丹期", "level": 3, "title": "金丹真人"}'
                />
                <p className="text-[10px] text-muted-foreground">JSON格式存储境界、等级等信息（选填）</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="char-attributes">属性</Label>
                <Textarea
                  id="char-attributes"
                  value={attributes}
                  onChange={(e) => setAttributes(e.target.value)}
                  placeholder='如：{"strength": 85, "intelligence": 90, "skills": ["剑法", "阵法"]}'
                  rows={2}
                />
                <p className="text-[10px] text-muted-foreground">JSON格式存储额外属性（选填）</p>
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
                <Button 
                  type="submit" 
                  disabled={!name.trim() || createMutation.isPending || updateMutation.isPending}
                >
                  {updateMutation.isPending ? '更新中...' : (editingId ? '更新' : '创建')}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* 角色列表 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {characters && characters.length > 0 ? (
          characters.map((character: Character) => (
            <div
              key={character.id}
              className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/40 group transition-colors"
            >
              {/* 角色头像 */}
              <div className="shrink-0">
                <CharacterImageUpload
                  characterId={character.id}
                  characterName={character.name}
                  currentImageR2Key={character.imageR2Key}
                  onUploadSuccess={() => {
                    queryClient.invalidateQueries({ queryKey: ['characters', novelId] })
                  }}
                />
              </div>

              <div className="flex-1 min-w-0 space-y-1">
                <div className="font-medium text-sm truncate">{character.name}</div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {character.role && (
                    <span className="text-[11px] text-muted-foreground">
                      {roleLabels[character.role] || character.role}
                    </span>
                  )}
                  {character.aliases && (
                    <span className="text-[11px] text-muted-foreground/60 truncate max-w-[80px]" title={character.aliases}>
                      · {character.aliases}
                    </span>
                  )}
                  {character.powerLevel && (
                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-sm bg-purple-50 text-purple-700 text-[10px] font-medium">
                      <Swords className="h-2.5 w-2.5" />
                      境界
                    </span>
                  )}
                </div>
                {character.description && (
                  <p className="text-[11px] text-muted-foreground/70 line-clamp-1">
                    {character.description}
                  </p>
                )}
              </div>

              <div className="flex items-center opacity-0 group-hover:opacity-100 shrink-0 transition-opacity">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleEdit(character)
                  }}
                >
                  <Edit2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive"
                  onClick={() => deleteMutation.mutate(character.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <User className="h-10 w-10 mb-3 opacity-20" />
            <p className="text-sm">暂无角色</p>
            <p className="text-xs mt-1 opacity-60">点击上方按钮添加角色</p>
          </div>
        )}
      </div>
    </div>
  )
}