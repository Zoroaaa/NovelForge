import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { PROVIDERS } from '@/lib/providers'
import type { ModelConfig } from '@/lib/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Plus, Trash2, Settings2 } from 'lucide-react'

interface ModelConfigProps {
  novelId?: string
}

export function ModelConfig({ novelId }: ModelConfigProps) {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [provider, setProvider] = useState('volcengine')
  const [stage, setStage] = useState('chapter_gen')
  const [modelId, setModelId] = useState('')
  const [apiBase, setApiBase] = useState('')

  const { data: configs, isLoading } = useQuery({
    queryKey: ['model-configs', novelId],
    queryFn: () => api.settings.list(novelId),
  })

  const createMutation = useMutation({
    mutationFn: api.settings.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['model-configs', novelId] })
      toast.success('配置已添加')
      setShowForm(false)
      setModelId('')
      setApiBase('')
    },
    onError: (error) => toast.error(error.message),
  })

  const deleteMutation = useMutation({
    mutationFn: api.settings.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['model-configs', novelId] })
      toast.success('已删除')
    },
    onError: (error) => toast.error(error.message),
  })

  const selectedProvider = PROVIDERS.find(p => p.id === provider)

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault()
    if (!modelId) return
    createMutation.mutate({
      scope: novelId ? 'novel' : 'global',
      stage,
      provider,
      modelId,
      apiBase: apiBase || selectedProvider?.apiBase || undefined,
      apiKeyEnv: selectedProvider?.keyEnv || 'CUSTOM_API_KEY',
      ...(novelId ? { novelId } : {}),
    })
  }

  const stageLabels: Record<string, string> = {
    'outline_gen': '大纲生成',
    'chapter_gen': '章节生成',
    'summary_gen': '摘要生成',
    'vision': '视觉理解',
  }

  if (isLoading) return <div className="animate-pulse space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-muted rounded-lg" />)}</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Settings2 className="h-4 w-4" />
          模型配置
        </h3>
        <Button variant="outline" size="sm" onClick={() => setShowForm(!showForm)}>
          <Plus className="h-4 w-4" />
          添加配置
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="pt-6">
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label>提供商</Label>
                <Select value={provider} onValueChange={(v) => { setProvider(v); setModelId(''); setApiBase('') }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>用途</Label>
                <Select value={stage} onValueChange={setStage}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(stageLabels).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>模型</Label>
                {selectedProvider && selectedProvider.models.length > 0 ? (
                  <Select value={modelId} onValueChange={setModelId}>
                    <SelectTrigger><SelectValue placeholder="选择模型" /></SelectTrigger>
                    <SelectContent>
                      {selectedProvider.models.map(m => (
                        <SelectItem key={m} value={m}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="输入模型 ID" />
                )}
              </div>

              {provider === 'custom' && (
                <div className="space-y-2">
                  <Label>API Base URL</Label>
                  <Input value={apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder="https://api.example.com/v1" />
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>取消</Button>
                <Button type="submit" disabled={!modelId || createMutation.isPending}>添加</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {configs && configs.length > 0 ? (
          configs.map((config: ModelConfig) => (
            <Card key={config.id}>
              <CardContent className="py-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{config.modelId}</span>
                      <Badge variant="secondary">{PROVIDERS.find(p => p.id === config.provider)?.name}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {stageLabels[config.stage]} · {config.scope === 'global' ? '全局' : '当前小说'}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deleteMutation.mutate(config.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">暂无配置，点击上方按钮添加</p>
        )}
      </div>
    </div>
  )
}
