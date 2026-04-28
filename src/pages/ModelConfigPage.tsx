/**
 * @file ModelConfigPage.tsx
 * @description 模型配置独立页面 - 管理全局AI模型配置（v1.0.0）
 * @version 1.0.0
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { PROVIDERS } from '@/lib/providers'
import type { ModelConfig as ModelConfigType } from '@/lib/types'
import { MainLayout } from '@/components/layout/MainLayout'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
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
import {
  Settings2,
  Plus,
  Trash2,
  CheckCircle,
  AlertCircle,
  Loader2,
  Pencil,
  Power,
  Cpu,
  Globe,
  Zap,
  Eye,
  MessageSquare,
  FileText,
} from 'lucide-react'

const STAGE_CONFIG = [
  { id: 'chapter_gen', label: '章节生成', icon: FileText, description: '章节内容生成、章节修复、MCP工具触发' },
  { id: 'summary_gen', label: '摘要生成', icon: FileText, description: '章节摘要、总纲摘要、卷摘要、设定摘要' },
  { id: 'analysis', label: '智能分析', icon: Cpu, description: '角色一致性、伏笔检测/提取/建议、战力检测/验证、卷进度检查' },
  { id: 'workshop', label: '创作工坊', icon: MessageSquare, description: 'AI创作助手对话（仅全局配置）' },
  { id: 'image_gen', label: '封面生成', icon: Eye, description: 'AI封面图生成（调用图像生成模型API，如豆包Seedream等）' },
]

export default function ModelConfigPage() {
  const queryClient = useQueryClient()
  
  const [showForm, setShowForm] = useState(false)
  const [editingConfig, setEditingConfig] = useState<ModelConfigType | null>(null)
  const [provider, setProvider] = useState('')
  const [stage, setStage] = useState('chapter_gen')
  const [modelId, setModelId] = useState('')
  const [apiBase, setApiBase] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [params, setParams] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null)

  const { data: configs, isLoading } = useQuery({
    queryKey: ['model-configs'],
    queryFn: () => api.modelConfigs.list(),
  })

  const createMutation = useMutation({
    mutationFn: api.modelConfigs.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['model-configs'] })
      toast.success('配置已添加')
      resetForm()
    },
    onError: (error) => toast.error(error.message),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ModelConfigType> }) =>
      api.modelConfigs.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['model-configs'] })
      toast.success('配置已更新')
      resetForm()
    },
    onError: (error) => toast.error(error.message),
  })

  const deleteMutation = useMutation({
    mutationFn: api.modelConfigs.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['model-configs'] })
      toast.success('已删除')
    },
    onError: (error) => toast.error(error.message),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.modelConfigs.toggle(id, isActive),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['model-configs'] })
      toast.success('状态已更新')
    },
    onError: (error) => toast.error(error.message),
  })

  const selectedProvider = PROVIDERS.find(p => p.id === provider)

  const handleProviderChange = (v: string) => {
    setProvider(v)
    const p = PROVIDERS.find(p => p.id === v)
    if (p) {
      setApiBase(p.apiBase)
    } else {
      setApiBase('')
    }
  }

  const resetForm = () => {
    setShowForm(false)
    setEditingConfig(null)
    setProvider('')
    setStage('chapter_gen')
    setModelId('')
    setApiBase('')
    setApiKey('')
    setParams('')
    setShowAdvanced(false)
    setTestResult(null)
  }

  const handleEdit = (config: ModelConfigType) => {
    setEditingConfig(config)
    setProvider(config.provider)
    setStage(config.stage)
    setModelId(config.modelId)
    setApiBase(config.apiBase || '')
    setApiKey(config.apiKey || '')
    setParams(config.params || '')
    setShowForm(true)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!modelId) return

    const data = {
      stage: stage as 'chapter_gen' | 'summary_gen' | 'analysis' | 'workshop',
      provider,
      modelId,
      scope: 'global' as const,
      apiBase: apiBase || selectedProvider?.apiBase || undefined,
      apiKey: apiKey || undefined,
      params: params || undefined,
    }

    if (editingConfig) {
      updateMutation.mutate({ id: editingConfig.id, data })
    } else {
      createMutation.mutate(data)
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
        toast.success('连接测试成功 ✓')
      } else {
        setTestResult('error')
        toast.error(`连接失败: ${resp.status}`)
      }
    } catch (error) {
      setTestResult('error')
      toast.error('连接失败: ' + (error as Error).message)
    } finally {
      setTesting(false)
    }
  }

  // 统计信息
  const stats = configs ? {
    total: configs.length,
    active: configs.filter(c => c.isActive).length,
    providers: [...new Set(configs.map(c => c.provider))].length,
  } : { total: 0, active: 0, providers: 0 }

  return (
    <MainLayout
      headerTitle="全局模型配置"
      headerSubtitle={`管理AI模型 · 共 ${stats.total} 个配置 · ${stats.active} 个激活`}
    >
      <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
        {/* 页面说明 */}
        <div className="bg-gradient-to-r from-blue-50 via-indigo-50 to-violet-50 dark:from-blue-950/20 dark:via-indigo-950/20 dark:to-violet-950/20 rounded-xl p-6 border border-blue-100/50 dark:border-blue-900/20">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center shadow-lg shrink-0">
              <Settings2 className="w-6 h-6 text-white" />
            </div>
            <div className="space-y-1 flex-1 min-w-0">
              <h3 className="font-semibold text-lg">AI 模型配置中心</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                在这里管理所有AI模型的API配置。每个用途可以配置不同的模型和提供商，
                系统会自动选择最合适的配置来执行任务。
              </p>
              
              {/* 用途快速预览 */}
              <div className="flex flex-wrap gap-2 mt-3">
                {STAGE_CONFIG.slice(0, 4).map(s => (
                  <Badge key={s.id} variant="secondary" className="gap-1 text-xs">
                    <s.icon className="w-3 h-3" />
                    {s.label}
                  </Badge>
                ))}
                {STAGE_CONFIG.length > 4 && (
                  <Badge variant="outline" className="text-xs">
                    +{STAGE_CONFIG.length - 4} 更多
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 操作栏 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Badge variant={configs && configs.length > 0 ? "default" : "secondary"} className="px-3 py-1">
              {configs?.length || 0} 个配置
            </Badge>
            <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50 dark:bg-green-950 dark:border-green-800">
              {stats.active} 个激活
            </Badge>
          </div>
          
          <Button onClick={() => { resetForm(); setShowForm(!showForm) }} className="gap-2">
            {showForm ? (
              <>
                ✕ 取消
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" />
                添加配置
              </>
            )}
          </Button>
        </div>

        {/* 添加/编辑表单 */}
        {showForm && (
          <Card className="border-primary/20 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="w-5 h-5 text-primary" />
                {editingConfig ? '编辑配置' : '添加新配置'}
              </CardTitle>
              <CardDescription>
                填写以下信息来{editingConfig ? '修改' : '创建'}一个AI模型配置
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="space-y-2">
                    <Label htmlFor="provider">提供商</Label>
                    <Select value={provider} onValueChange={handleProviderChange}>
                      <SelectTrigger id="provider" className="h-10">
                        <SelectValue placeholder="选择提供商" />
                      </SelectTrigger>
                      <SelectContent className="max-h-60">
                        {PROVIDERS.map(p => (
                          <SelectItem key={p.id} value={p.id}>
                            <span className="flex items-center gap-2">
                              <Globe className="w-4 h-4" />
                              {p.name}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="stage">用途</Label>
                    <Select value={stage} onValueChange={setStage}>
                      <SelectTrigger id="stage" className="h-10">
                        <SelectValue placeholder="选择用途" />
                      </SelectTrigger>
                      <SelectContent>
                        {STAGE_CONFIG.map(s => (
                          <SelectItem key={s.id} value={s.id}>
                            <span className="flex items-center gap-2">
                              <s.icon className="w-4 h-4" />
                              {s.label}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="modelId">模型 ID</Label>
                  <Input
                    id="modelId"
                    value={modelId}
                    onChange={(e) => setModelId(e.target.value)}
                    placeholder="例如：gpt-4o, deepseek-chat, claude-3-opus"
                    className="h-10 font-mono"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="apiBase">API Base URL</Label>
                  <Input
                    id="apiBase"
                    value={apiBase}
                    onChange={(e) => setApiBase(e.target.value)}
                    placeholder="https://api.openai.com/v1"
                    className="h-10 font-mono"
                  />
                  {selectedProvider && (
                    <p className="text-xs text-muted-foreground">
                      默认值：{selectedProvider.apiBase}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="apiKey">API Key</Label>
                  <div className="flex gap-2">
                    <Input
                      id="apiKey"
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="输入你的 API Key"
                      className="flex-1 h-10 font-mono"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleTest}
                      disabled={testing}
                      className="gap-2 px-4 h-10"
                    >
                      {testing ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : testResult === 'success' ? (
                        <CheckCircle className="w-4 h-4 text-green-500" />
                      ) : testResult === 'error' ? (
                        <AlertCircle className="w-4 h-4 text-red-500" />
                      ) : (
                        <Zap className="w-4 h-4" />
                      )}
                      测试连接
                    </Button>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <button
                    type="button"
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Settings2 className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-90' : ''}`} />
                    高级参数配置 {showAdvanced ? '（收起）' : ''}
                  </button>

                  {showAdvanced && (
                    <div className="mt-4 space-y-4 bg-muted/30 rounded-lg p-4">
                      <div className="space-y-2">
                        <Label htmlFor="params" className="flex items-center gap-2">
                          模型参数 (JSON)
                          <Badge variant="outline" className="text-xs font-normal">可选</Badge>
                        </Label>
                        <Input
                          id="params"
                          value={params}
                          onChange={(e) => setParams(e.target.value)}
                          placeholder='{"temperature": 0.72, "max_tokens": 10000}'
                          className="h-10 font-mono text-sm"
                        />
                        <p className="text-xs text-muted-foreground">
                          填写 JSON 格式，用于控制 AI 输出的质量和长度
                        </p>
                      </div>

                      <details className="space-y-2">
                        <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                          📋 查看配置示例与参数说明
                        </summary>
                        <div className="mt-3 space-y-4 text-xs bg-background rounded-lg p-4 border">
                          <div>
                            <p className="font-semibold mb-2">快速复制配置：</p>
                            <div className="space-y-2">
                              <div>
                                <p className="text-muted-foreground mb-1">创作工坊（长对话）：</p>
                                <code className="block bg-muted px-2 py-1 rounded text-[11px] overflow-x-auto">
                                  {`{"temperature": 0.72, "max_tokens": 15000, "top_p": 0.9}`}
                                </code>
                              </div>
                              <div>
                                <p className="text-muted-foreground mb-1">章节生成（长内容）：</p>
                                <code className="block bg-muted px-2 py-1 rounded text-[11px] overflow-x-auto">
                                  {`{"temperature": 0.72, "max_tokens": 10000, "top_p": 0.9}`}
                                </code>
                              </div>
                              <div>
                                <p className="text-muted-foreground mb-1">智能分析（精准）：</p>
                                <code className="block bg-muted px-2 py-1 rounded text-[11px] overflow-x-auto">
                                  {`{"temperature": 0.3, "max_tokens": 4000, "top_p": 0.8}`}
                                </code>
                              </div>
                              <div>
                                <p className="text-muted-foreground mb-1">摘要生成（简洁）：</p>
                                <code className="block bg-muted px-2 py-1 rounded text-[11px] overflow-x-auto">
                                  {`{"temperature": 0.5, "max_tokens": 3000, "top_p": 0.85}`}
                                </code>
                              </div>
                            </div>
                          </div>

                          <div className="border-t pt-3 space-y-2">
                            <p className="font-semibold">参数说明：</p>
                            <div className="grid grid-cols-1 gap-x-4 gap-y-2">
                              <div>
                                <span className="font-medium text-blue-600">temperature</span>
                                <span className="text-muted-foreground"> - 随机性 (0~1)</span>
                                <div className="text-muted-foreground mt-0.5">
                                  较低（0.3~0.5）：输出更稳定一致，适合分析/摘要<br />
                                  较高（0.7~0.9）：输出更有创意，适合创作/对话
                                </div>
                              </div>
                              <div>
                                <span className="font-medium text-blue-600">max_tokens</span>
                                <span className="text-muted-foreground"> - 最大生成 tokens 数</span>
                                <div className="text-muted-foreground mt-0.5">
                                  控制单次回复最大长度。10000 tokens ≈ 7000-8000 中文字<br />
                                  章节生成建议 ≥10000，摘要建议 3000-6000
                                </div>
                              </div>
                              <div>
                                <span className="font-medium text-blue-600">top_p</span>
                                <span className="text-muted-foreground"> - 核采样 (0~1)</span>
                                <div className="text-muted-foreground mt-0.5">
                                  控制候选词范围。较低（0.8）更精准，较高（0.95）更有创意<br />
                                  通常与 temperature 二选一使用
                                </div>
                              </div>
                              <div>
                                <span className="font-medium text-blue-600">frequency_penalty</span>
                                <span className="text-muted-foreground"> - 频率惩罚 (-2~2)</span>
                                <div className="text-muted-foreground mt-0.5">
                                  减少重复。小说创作建议 0（需要高频复用角色名/境界词）
                                </div>
                              </div>
                              <div>
                                <span className="font-medium text-blue-600">presence_penalty</span>
                                <span className="text-muted-foreground"> - 存在惩罚 (-2~2)</span>
                                <div className="text-muted-foreground mt-0.5">
                                  鼓励话题扩展。小说创作建议 0（避免制造变体词）
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </details>
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <Button type="button" variant="outline" onClick={resetForm}>
                    取消
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={!modelId || createMutation.isPending || updateMutation.isPending}
                    className="min-w-[100px]"
                  >
                    {(createMutation.isPending || updateMutation.isPending) ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      editingConfig ? '保存更改' : '添加配置'
                    )}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* 配置列表 */}
        <div className="space-y-3">
          {isLoading ? (
            // 加载骨架屏
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />
              ))}
            </div>
          ) : configs && configs.length > 0 ? (
            configs.map((config) => {
              const stageInfo = STAGE_CONFIG.find(s => s.id === config.stage)
              return (
                <Card 
                  key={config.id} 
                  className={`transition-all hover:shadow-md ${
                    config.isActive ? 'border-green-200 dark:border-green-800' : 'opacity-60'
                  }`}
                >
                  <CardContent className="py-4">
                    <div className="flex items-center gap-4">
                      {/* 图标区域 */}
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                        config.isActive 
                          ? 'bg-gradient-to-br from-green-400 to-emerald-500' 
                          : 'bg-muted'
                      }`}>
                        {stageInfo ? (
                          <stageInfo.icon className={`w-5 h-5 ${config.isActive ? 'text-white' : 'text-muted-foreground'}`} />
                        ) : (
                          <Cpu className={`w-5 h-5 ${config.isActive ? 'text-white' : 'text-muted-foreground'}`} />
                        )}
                      </div>

                      {/* 信息区域 */}
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <code className="font-semibold text-sm">{config.modelId}</code>
                          
                          <Badge variant="secondary" className="text-xs">
                            {PROVIDERS.find(p => p.id === config.provider)?.name || config.provider}
                          </Badge>
                          
                          <Badge 
                            variant={config.isActive ? "default" : "outline"} 
                            className={`text-xs ${
                              config.isActive 
                                ? 'bg-green-500 hover:bg-green-600 text-white' 
                                : ''
                            }`}
                          >
                            {config.isActive ? '● 已激活' : '○ 未激活'}
                          </Badge>
                        </div>
                        
                        <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                          <span className="flex items-center gap-1">
                            {stageInfo && <stageInfo.icon className="w-3 h-3" />}
                            {stageInfo?.label || config.stage}
                          </span>
                          <span>·</span>
                          <span>{config.scope === 'global' ? '全局配置' : '小说级'}</span>
                          {config.apiKey && (
                            <>
                              <span>·</span>
                              <span className="text-green-600 dark:text-green-400">✓ Key 已配置</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* 操作按钮 */}
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => toggleMutation.mutate({ id: config.id, isActive: !config.isActive })}
                          title={config.isActive ? '停用此配置' : '激活此配置'}
                        >
                          <Power className={`h-4 w-4 ${config.isActive ? 'text-green-500' : 'text-muted-foreground'}`} />
                        </Button>
                        
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleEdit(config)}
                          title="编辑配置"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => deleteMutation.mutate(config.id)}
                          title="删除配置"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })
          ) : (
            /* 空状态 */
            <div className="text-center py-16">
              <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-gray-100 to-gray-50 dark:from-gray-800 dark:to-gray-900 flex items-center justify-center">
                <Settings2 className="w-10 h-10 text-gray-400 dark:text-gray-500" />
              </div>
              <h3 className="text-lg font-semibold mb-2">暂无模型配置</h3>
              <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
                添加你的第一个AI模型配置，开始使用智能创作功能。
                支持多种主流AI提供商。
              </p>
              <Button onClick={() => setShowForm(true)} className="gap-2">
                <Plus className="w-4 h-4" />
                添加第一个配置
              </Button>
            </div>
          )}
        </div>

        {/* 使用说明 */}
        <div className="bg-muted/30 rounded-xl p-5 space-y-4">
          <h4 className="font-medium text-sm flex items-center gap-2">
            💡 配置指南与用途说明
          </h4>

          {/* 全局专用用途 */}
          <div className="space-y-2">
            <p className="font-medium text-xs uppercase tracking-wider text-purple-600 dark:text-purple-400 flex items-center gap-1">
              <Globe className="w-3 h-3" />
              全局专用用途（仅在全局配置中可用）
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-purple-100 dark:border-purple-900">
                <div className="flex items-center gap-2 mb-1">
                  <MessageSquare className="w-4 h-4 text-purple-500" />
                  <span className="font-semibold">创作工坊 (workshop)</span>
                </div>
                <p className="text-xs text-muted-foreground">AI创作助手对话，用于创意工坊页面的对话式创作引擎</p>
                <p className="text-xs text-muted-foreground mt-1">📍 调用位置：/workshop 页面</p>
              </div>
            </div>
          </div>

          {/* 小说工作台 + 全局通用用途 */}
          <div className="space-y-2">
            <p className="font-medium text-xs uppercase tracking-wider text-blue-600 dark:text-blue-400 flex items-center gap-1">
              <FileText className="w-3 h-3" />
              通用用途（可在全局或小说工作台中配置）
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
              <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-blue-100 dark:border-blue-900">
                <div className="flex items-center gap-2 mb-1">
                  <FileText className="w-4 h-4 text-blue-500" />
                  <span className="font-semibold">章节生成 (chapter_gen)</span>
                </div>
                <p className="text-xs text-muted-foreground">章节内容生成、章节修复、MCP工具触发</p>
                <p className="text-xs text-muted-foreground mt-1">📍 小说工作台 → 章节编辑</p>
              </div>

              <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-blue-100 dark:border-blue-900">
                <div className="flex items-center gap-2 mb-1">
                  <FileText className="w-4 h-4 text-blue-500" />
                  <span className="font-semibold">摘要生成 (summary_gen)</span>
                </div>
                <p className="text-xs text-muted-foreground">章节摘要、总纲摘要、卷摘要、设定摘要</p>
                <p className="text-xs text-muted-foreground mt-1">📍 小说工作台 → 各实体列表</p>
              </div>

              <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-blue-100 dark:border-blue-900">
                <div className="flex items-center gap-2 mb-1">
                  <Cpu className="w-4 h-4 text-blue-500" />
                  <span className="font-semibold">智能分析 (analysis)</span>
                </div>
                <p className="text-xs text-muted-foreground">角色一致性、伏笔检测/提取/建议、战力检测/验证、卷进度检查</p>
                <p className="text-xs text-muted-foreground mt-1">📍 质量检查工具</p>
              </div>
            </div>
          </div>

          {/* 基本规则 */}
          <div className="space-y-2 pt-2 border-t">
            <p className="font-medium text-xs uppercase tracking-wider text-muted-foreground">基本规则</p>
            <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
              <li>每个用途只能有一个<strong className="text-foreground">激活的</strong>配置</li>
              <li><strong className="text-foreground">小说级配置优先于全局配置</strong>：如果在小说工作台为某用途配置了模型，将优先使用该配置</li>
              <li>未配置用途时，对应功能将无法使用并提示错误</li>
              <li><strong className="text-purple-600">创作工坊(workshop)</strong> 仅限全局配置，不可在小说工作台中设置</li>
            </ul>
          </div>

          {/* 推荐配置 */}
          <div className="space-y-2 pt-2 border-t">
            <p className="font-medium text-xs uppercase tracking-wider text-muted-foreground">推荐配置方案</p>
            <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
              <li><strong className="text-foreground">章节生成</strong>: GPT-4o / Claude 3.5 Sonnet / DeepSeek-V3（需要较强的创意写作能力）</li>
              <li><strong className="text-foreground">大纲规划</strong>: GPT-4o / Claude 3 / DeepSeek（需要结构化思维）</li>
              <li><strong className="text-foreground">创作工坊</strong>: Claude 3.5 / GPT-4o（需要长对话和多轮交互能力）</li>
              <li><strong className="text-foreground">智能分析</strong>: GPT-4o / Claude 3（需要逻辑推理能力）</li>
            </ul>
          </div>
        </div>
      </div>
    </MainLayout>
  )
}
