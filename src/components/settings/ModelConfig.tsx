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
import { Plus, Trash2, Settings2, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'

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
  const [apiKey, setApiKey] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null)

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
      setApiKey('')
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

  const handleProviderChange = (v: string) => {
    setProvider(v)
    const p = PROVIDERS.find(p => p.id === v)
    if (p) {
      setApiBase(p.apiBase || '')
      setModelId(p.models.length > 0 ? p.models[0] : '')
    } else {
      setApiBase('')
      setModelId('')
    }
  }

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
      apiKey: apiKey || undefined,
      ...(novelId ? { novelId } : {}),
    })
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
                <Select value={provider} onValueChange={handleProviderChange}>
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
                <Label>模型 ID</Label>
                <Input value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="输入模型 ID（可自填任意模型名）" />
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
                      {config.apiKey ? ' · Key已配置' : ' · Key未配置'}
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
