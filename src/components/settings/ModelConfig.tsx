/**
 * @file ModelConfig.tsx
 * @description 模型配置组件，管理AI模型的API配置和参数设置
 * @version 2.0.0
 * @modified 2026-04-21 - 添加编辑和激活功能
 */
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
import { Switch } from '@/components/ui/switch'
import { Plus, Trash2, Settings2, CheckCircle, AlertCircle, Loader2, Pencil, Power } from 'lucide-react'

interface ModelConfigProps {
  novelId?: string
}

export function ModelConfig({ novelId }: ModelConfigProps) {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editingConfig, setEditingConfig] = useState<ModelConfig | null>(null)
  const [provider, setProvider] = useState('volcengine')
  const [stage, setStage] = useState('chapter_gen')
  const [modelId, setModelId] = useState('')
  const [apiBase, setApiBase] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null)

  const { data: configs, isLoading } = useQuery({
    queryKey: ['model-configs', novelId],
    queryFn: () => api.modelConfigs.list(novelId ? { novelId } : undefined),
  })

  const createMutation = useMutation({
    mutationFn: api.modelConfigs.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['model-configs', novelId] })
      toast.success('配置已添加')
      resetForm()
    },
    onError: (error) => toast.error(error.message),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ModelConfig> }) =>
      api.modelConfigs.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['model-configs', novelId] })
      toast.success('配置已更新')
      resetForm()
    },
    onError: (error) => toast.error(error.message),
  })

  const deleteMutation = useMutation({
    mutationFn: api.modelConfigs.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['model-configs', novelId] })
      toast.success('已删除')
    },
    onError: (error) => toast.error(error.message),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.modelConfigs.toggle(id, isActive),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['model-configs', novelId] })
      toast.success('状态已更新')
    },
    onError: (error) => toast.error(error.message),
  })

  const selectedProvider = PROVIDERS.find(p => p.id === provider)

  const handleProviderChange = (v: string) => {
    setProvider(v)
    const p = PROVIDERS.find(p => p.id === v)
    if (p) {
      setApiBase(p.apiBase || '')
      setModelId(p.models.length > 0 && p.models[0] ? p.models[0] : '')
    } else {
      setApiBase('')
      setModelId('')
    }
  }

  const resetForm = () => {
    setShowForm(false)
    setEditingConfig(null)
    setProvider('volcengine')
    setStage('chapter_gen')
    setModelId('')
    setApiBase('')
    setApiKey('')
    setTestResult(null)
  }

  const handleEdit = (config: ModelConfig) => {
    setEditingConfig(config)
    setProvider(config.provider)
    setStage(config.stage)
    setModelId(config.modelId)
    setApiBase(config.apiBase || '')
    setApiKey(config.apiKey || '')
    setShowForm(true)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!modelId) return

    const data = {
      stage,
      provider,
      modelId,
      scope: novelId ? 'novel' : 'global',
      apiBase: apiBase || selectedProvider?.apiBase || undefined,
      apiKeyEnv: selectedProvider?.keyEnv || 'CUSTOM_API_KEY',
      apiKey: apiKey || undefined,
      ...(novelId ? { novelId } : {}),
    }

    if (editingConfig) {
      updateMutation.mutate({ id: editingConfig.id, data })
    } else {
      createMutation.mutate(data as any)
    }
  }

  const handleTest = async () => {
    if (!modelId || !apiKey) {
      toast.error('请填写模型 ID 和 API Key')
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const base = apiBase || selectedProvider?.apiBase || ''
      if (!base) {
        toast.error('请填写 API Base URL')
        setTestResult('error')
        return
      }
      const resp = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'Say hi' }],
          max_tokens: 10,
        }),
      })
      if (resp.ok) {
        setTestResult('success')
        toast.success('连接测试成功')
      } else {
        const errText = await resp.text()
        setTestResult('error')
        toast.error(`连接失败: ${resp.status} ${errText.slice(0, 100)}`)
      }
    } catch (error) {
      setTestResult('error')
      toast.error('连接失败: ' + (error as Error).message)
    } finally {
      setTesting(false)
    }
  }

  const stageLabels: Record<string, string> = {
    'outline_gen': '大纲生成',
    'chapter_gen': '章节生成',
    'summary_gen': '摘要生成',
    'embedding': '文本嵌入',
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
        <Button variant="outline" size="sm" onClick={() => { resetForm(); setShowForm(!showForm) }}>
          <Plus className="h-4 w-4" />
          添加配置
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{editingConfig ? '编辑配置' : '添加新配置'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>提供商</Label>
                  <Select value={provider} onValueChange={handleProviderChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-60">
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
              </div>

              <div className="space-y-2">
                <Label>模型 ID</Label>
                <Input value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="输入模型 ID（可自填任意模型名）" />
                {selectedProvider && selectedProvider.models.length > 0 && (
                  <p className="text-xs text-muted-foreground">常用: {selectedProvider.models.slice(0, 3).join(', ')}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label>API Base URL</Label>
                <Input value={apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder="https://api.example.com/v1" />
              </div>

              <div className="space-y-2">
                <Label>API Key</Label>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="输入你的 API Key"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleTest}
                    disabled={testing}
                  >
                    {testing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : testResult === 'success' ? (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : testResult === 'error' ? (
                      <AlertCircle className="h-4 w-4 text-red-500" />
                    ) : (
                      '测试'
                    )}
                  </Button>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={resetForm}>取消</Button>
                <Button type="submit" disabled={!modelId || createMutation.isPending || updateMutation.isPending}>
                  {editingConfig ? '保存' : '添加'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {configs && configs.length > 0 ? (
          configs.map((config) => (
            <Card key={config.id} className={config.isActive ? '' : 'opacity-60'}>
              <CardContent className="py-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{config.modelId}</span>
                      <Badge variant="secondary">{PROVIDERS.find(p => p.id === config.provider)?.name || config.provider}</Badge>
                      <Badge variant={config.isActive ? 'default' : 'outline'} className="text-xs">
                        {config.isActive ? '已激活' : '未激活'}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {stageLabels[config.stage]} · {config.scope === 'global' ? '全局' : '当前小说'}
                      {config.apiKey ? ' · Key已配置' : ' · Key未配置'}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => toggleMutation.mutate({ id: config.id, isActive: !config.isActive })}
                      title={config.isActive ? '停用' : '激活'}
                    >
                      <Power className={`h-4 w-4 ${config.isActive ? 'text-green-500' : 'text-muted-foreground'}`} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleEdit(config)}
                      title="编辑"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => deleteMutation.mutate(config.id)}
                      title="删除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">暂无配置，点击上方按钮添加</p>
        )}
      </div>

      <div className="text-xs text-muted-foreground p-3 bg-muted/50 rounded-lg">
        <p className="font-medium mb-1">配置说明：</p>
        <ul className="list-disc list-inside space-y-0.5">
          <li>每个用途（章节生成、大纲生成等）只能有一个激活的配置</li>
          <li>小说级配置优先于全局配置</li>
          <li>激活的配置会被用于对应的生成任务</li>
        </ul>
      </div>
    </div>
  )
}
