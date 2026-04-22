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
import { Plus, User, Trash2, Edit2, Swords, ChevronDown, ChevronRight, ChevronUp, TrendingUp } from 'lucide-react'
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
  const [expandedCharacterId, setExpandedCharacterId] = useState<string | null>(null)
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

  const { data: powerSystems } = useQuery({
    queryKey: ['settings-power-system', novelId],
    queryFn: () => api.settings.list(novelId, { type: 'power_system' }),
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
    let parsedPowerLevel = ''
    if (character.powerLevel) {
      try {
        JSON.parse(character.powerLevel)
        parsedPowerLevel = character.powerLevel
      } catch {
        parsedPowerLevel = JSON.stringify({ current: character.powerLevel })
      }
    }
    setPowerLevel(parsedPowerLevel)
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
                  characterId={editingId || 'temp'}
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
                {powerSystems && powerSystems.settings && powerSystems.settings.length > 0 ? (
                  <div className="space-y-2">
                    <Select value={powerLevel ? JSON.parse(powerLevel).system || '' : ''} onValueChange={(system) => {
                      const current = powerLevel ? JSON.parse(powerLevel) : {}
                      setPowerLevel(JSON.stringify({ ...current, system }))
                    }}>
                      <SelectTrigger><SelectValue placeholder="选择境界体系" /></SelectTrigger>
                      <SelectContent>
                        {powerSystems.settings.map((s: any) => (
                          <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {powerLevel && JSON.parse(powerLevel).system && (() => {
                      const systemSetting = powerSystems.settings.find((s: any) => s.name === JSON.parse(powerLevel).system)
                      const levels = systemSetting?.attributes ? JSON.parse(systemSetting.attributes).levels : null
                      return levels ? (
                        <Select value={JSON.parse(powerLevel).current || ''} onValueChange={(current) => {
                          const current_data = JSON.parse(powerLevel)
                          setPowerLevel(JSON.stringify({ ...current_data, current }))
                        }}>
                          <SelectTrigger><SelectValue placeholder="选择当前境界" /></SelectTrigger>
                          <SelectContent>
                            {levels.map((level: string) => (
                              <SelectItem key={level} value={level}>{level}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          id="char-power-level"
                          value={JSON.parse(powerLevel).current || ''}
                          onChange={(e) => {
                            const current = JSON.parse(powerLevel)
                            setPowerLevel(JSON.stringify({ ...current, current: e.target.value }))
                          }}
                          placeholder="输入当前境界"
                        />
                      )
                    })()}
                  </div>
                ) : (
                  <Input
                    id="char-power-level"
                    value={powerLevel}
                    onChange={(e) => setPowerLevel(e.target.value)}
                    placeholder='手动输入境界，如：{"realm": "金丹期", "level": 3}'
                  />
                )}
                <p className="text-[10px] text-muted-foreground">从设定表选择境界体系，或手动输入（选填）</p>
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
                  {character.powerLevel && (() => {
                    try {
                      const powerData = JSON.parse(character.powerLevel)
                      return (
                        <span
                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-sm bg-purple-50 text-purple-700 text-[10px] font-medium cursor-pointer hover:bg-purple-100"
                          onClick={(e) => {
                            e.stopPropagation()
                            setExpandedCharacterId(expandedCharacterId === character.id ? null : character.id)
                          }}
                        >
                          <Swords className="h-2.5 w-2.5" />
                          {powerData.current || '境界'}
                          {expandedCharacterId === character.id ? (
                            <ChevronUp className="h-2.5 w-2.5" />
                          ) : (
                            <ChevronDown className="h-2.5 w-2.5" />
                          )}
                        </span>
                      )
                    } catch {
                      return null
                    }
                  })()}
                </div>
                {character.description && (
                  <p className="text-[11px] text-muted-foreground/70 line-clamp-1">
                    {character.description}
                  </p>
                )}

                {expandedCharacterId === character.id && character.powerLevel && (() => {
                  try {
                    const powerData = JSON.parse(character.powerLevel)
                    return (
                      <div className="mt-2 pt-2 border-t border-purple-100 dark:border-purple-900 space-y-2">
                        <div className="flex items-center gap-1.5">
                          <Swords className="h-3 w-3 text-purple-500" />
                          <span className="text-[11px] font-medium text-purple-700 dark:text-purple-300">
                            境界信息
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-[10px]">
                          <div className="bg-purple-50 dark:bg-purple-950 rounded p-1.5">
                            <span className="text-muted-foreground">体系：</span>
                            <span className="font-medium">{powerData.system || '未知'}</span>
                          </div>
                          <div className="bg-purple-50 dark:bg-purple-950 rounded p-1.5">
                            <span className="text-muted-foreground">当前：</span>
                            <span className="font-medium text-purple-600 dark:text-purple-400">{powerData.current || '未知'}</span>
                          </div>
                        </div>

                        {powerData.nextMilestone && (
                          <div className="bg-blue-50 dark:bg-blue-950 rounded p-1.5 text-[10px]">
                            <span className="text-muted-foreground">下一目标：</span>
                            <span className="font-medium text-blue-600 dark:text-blue-400">{powerData.nextMilestone}</span>
                          </div>
                        )}

                        {powerData.breakthroughs && powerData.breakthroughs.length > 0 && (
                          <div className="space-y-1">
                            <div className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
                              <TrendingUp className="h-2.5 w-2.5" />
                              突破历史（{powerData.breakthroughs.length} 次）
                            </div>
                            <div className="max-h-[120px] overflow-y-auto space-y-1">
                              {powerData.breakthroughs.map((bt: any, idx: number) => (
                                <div key={idx} className="text-[10px] bg-muted/50 rounded p-1.5 flex items-start gap-1.5">
                                  <span className="text-purple-500 font-mono shrink-0">#{idx + 1}</span>
                                  <div className="flex-1 min-w-0">
                                    <div className="font-medium text-green-600 dark:text-green-400">
                                      {bt.from} → {bt.to}
                                    </div>
                                    {bt.note && (
                                      <div className="text-muted-foreground line-clamp-1 mt-0.5">{bt.note}</div>
                                    )}
                                    {bt.timestamp && (
                                      <div className="text-muted-foreground/50 mt-0.5">
                                        {new Date(bt.timestamp).toLocaleDateString('zh-CN')}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  } catch {
                    return null
                  }
                })()}
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