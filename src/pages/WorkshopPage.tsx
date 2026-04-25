/**
 * @file WorkshopPage.tsx
 * @description 创作工坊页面 - 对话式创作引擎前端界面（v3.0）
 * @version 3.0.0
 * @modified 2026-04-22 - 集成会话管理功能（借鉴OSSshelf-main ChatSidebar模式）
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, getToken } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MainLayout } from '@/components/layout/MainLayout'
import { WorkshopSidebar } from '@/components/workshop/WorkshopSidebar'
import { ImportDataDialog, type FormattedImportData } from '@/components/workshop/ImportDataDialog'
import {
  MessageSquare,
  Send,
  Sparkles,
  BookOpen,
  Users,
  Globe,
  Layers,
  FileText,
  CheckCircle2,
  Loader2,
  Plus,
  PanelLeftClose,
  PanelLeft,
  Upload,
} from 'lucide-react'

interface WorkshopMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

interface ExtractedData {
  title?: string
  genre?: string
  description?: string
  coreAppeal?: string[]
  targetWordCount?: string
  targetChapters?: string
  worldSettings?: Array<{ type: string; title: string; content: string; importance?: string }>
  characters?: Array<{
    name: string
    role: 'protagonist' | 'supporting' | 'antagonist' | 'minor'
    description: string
    aliases?: string[]
    attributes?: Record<string, unknown>
    powerLevel?: string
  }>
  volumes?: Array<{
    title: string
    summary?: string
    blueprint?: string
    eventLine?: string[]
    notes?: string[]
    chapterCount?: number
  }>
  chapters?: Array<{
    title: string
    summary?: string
    outline?: string
    characters?: string[]
    foreshadowingActions?: Array<{ action: 'setup' | 'resolve'; target: string; description: string }>
    keyScenes?: string[]
  }>
}

interface SessionListItem {
  id: string
  title: string
  updatedAt: number
  stage?: string
}

const STAGES = [
  { id: 'concept', label: '概念构思', icon: Sparkles, description: '确定小说类型、核心设定' },
  { id: 'worldbuild', label: '世界观构建', icon: Globe, description: '建立完整的世界观体系' },
  { id: 'character_design', label: '角色设计', icon: Users, description: '设计主要角色和关系' },
  { id: 'volume_outline', label: '卷纲规划', icon: Layers, description: '规划分卷和事件线' },
  { id: 'chapter_outline', label: '章节大纲', icon: FileText, description: '细化每章内容和伏笔操作' },
]

export default function WorkshopPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [stage, setStage] = useState('concept')
  const [messages, setMessages] = useState<WorkshopMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [extractedData, setExtractedData] = useState<ExtractedData>({})
  const [showCommitDialog, setShowCommitDialog] = useState(false)
  const [showImportDialog, setShowImportDialog] = useState(false)

  // 会话管理状态（借鉴OSSshelf-main AIChat.tsx:216-219）
  const [showSidebar, setShowSidebar] = useState(() => window.innerWidth >= 1024)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // 加载会话列表（借鉴OSSshelf-main AIChat.tsx:392-396）
  const { data: sessions = [] } = useQuery({
    queryKey: ['workshop-sessions'],
    queryFn: async () => {
      const res = await api.workshop.listSessions()
      return (res.sessions || []) as SessionListItem[]
    },
    staleTime: 30000,
  })

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 加载指定会话的内容（借鉴OSSshelf-main AIChat.tsx:459-498）
  const loadSession = useCallback(async (id: string) => {
    try {
      setIsGenerating(true)
      const res = await api.workshop.getSession(id)
      if (res.ok && res.session) {
        setSessionId(id)
        setStage(res.session.stage || 'concept')
        setMessages(
          (res.session.messages as Array<{ role: string; content: string; timestamp?: number }> || []).map((m) => ({
            id: crypto.randomUUID(),
            role: m.role as 'user' | 'assistant',
            content: m.content,
            timestamp: m.timestamp || Date.now(),
          }))
        )
        if (res.session.extractedData) {
          setExtractedData(res.session.extractedData)
        }
      }
    } catch (e) {
      console.error(e)
      toast.error('加载会话失败')
    } finally {
      setIsGenerating(false)
    }
  }, [])

  // 从URL参数自动加载会话（小说列表"继续世界观构建"等操作跳转过来时）
  useEffect(() => {
    const sessionParam = searchParams.get('session')
    if (sessionParam && !sessionId) {
      loadSession(sessionParam)
      queryClient.invalidateQueries({ queryKey: ['workshop-sessions'] })
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, sessionId, loadSession, queryClient, setSearchParams])

  // 创建新会话
  const createSessionMutation = useMutation({
    mutationFn: async () => {
      const res = await api.workshop.createSession({ stage })
      if (!res.ok) throw new Error('创建会话失败')
      return res
    },
    onSuccess: (data) => {
      if (data.ok) {
        setSessionId(data.session.id)
        setMessages([])
        setExtractedData({})
        queryClient.invalidateQueries({ queryKey: ['workshop-sessions'] })
        toast.success('会话已创建，开始对话吧！')
      }
    },
  })

  // 发送消息（SSE）- 借鉴OSSshelf-main AIChat.tsx 的 UUID+map 模式
  const sendMessage = async () => {
    if (!inputValue.trim() || !sessionId || isGenerating) return

    const userMessage = inputValue.trim()
    setInputValue('')

    const userMsg: WorkshopMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    }
    setMessages(prev => [...prev, userMsg])
    setIsGenerating(true)

    // 先添加带UUID的空assistant占位消息（关键：通过ID定位更新）
    const assistantId = crypto.randomUUID()
    setMessages(prev => [
      ...prev,
      {
        id: assistantId,
        role: 'assistant' as const,
        content: '',
        timestamp: Date.now(),
      },
    ])

    try {
      const response = await api.workshop.sendMessage(sessionId, { message: userMessage, stage })

      if (!response.ok) throw new Error('发送消息失败')

      const reader = response.body?.getReader()
      if (!reader) throw new Error('无法读取响应流')

      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const text = decoder.decode(value, { stream: true })
        const lines = text.split('\n')

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue

          try {
            const data = JSON.parse(trimmed.slice(5).trim())

            if (data.content) {
              setMessages(prev =>
                prev.map(m => (m.id === assistantId ? { ...m, content: m.content + data.content } : m))
              )
            }

            if (data.type === 'done') {
              if (data.extractedData) {
                setExtractedData(prev => {
                  const merged: ExtractedData = { ...prev }
                  for (const [key, value] of Object.entries(data.extractedData as Record<string, unknown>)) {
                    if (value !== undefined && value !== null) {
                      (merged as Record<string, unknown>)[key] = value
                    }
                  }
                  return merged
                })
              }
              // removed: no-op setMessages that blocked extractedData re-render
            }

            if (data.type === 'error') {
              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantId ? { ...m, content: (m.content || '') + `\n\n❌ 错误: ${data.error}` } : m
                )
              )
              throw new Error(data.error)
            }
          } catch (e) {
            if (!(e instanceof SyntaxError)) console.warn('Parse error:', e)
          }
        }
      }

      setIsGenerating(false)
      queryClient.invalidateQueries({ queryKey: ['workshop-sessions'] })
      queryClient.invalidateQueries({ queryKey: ['workshop', sessionId] })

      // AI对话完成后从服务端拉取最新预览数据，确保右侧预览同步
      if (sessionId) {
        try {
          const refreshRes = await api.workshop.getSession(sessionId)
          if (refreshRes.ok && refreshRes.session?.extractedData) {
            setExtractedData(refreshRes.session.extractedData)
          }
        } catch (e) {
          console.warn('刷新预览数据失败:', e)
        }
      }
    } catch (error) {
      setIsGenerating(false)
      toast.error(`消息处理失败: ${(error as Error).message}`)
    }
  }

  // 提交确认
  const commitMutation = useMutation({
    mutationFn: async () => {
      if (!sessionId) throw new Error('没有活动会话')
      const res = await api.workshop.commitSession(sessionId)
      if (!res.ok) throw new Error('提交失败')
      return res
    },
    onSuccess: (data) => {
      if (data.ok && data.novelId) {
        toast.success('🎉 创作数据已提交！正在跳转到工作区...')
        setTimeout(() => navigate(`/novels/${data.novelId}`), 1500)
      }
      setShowCommitDialog(false)
    },
  })
  const handleStageChange = async (newStage: string) => {
    if (!sessionId) {
      setStage(newStage)
      return
    }

    if (newStage === stage) return

    setStage(newStage)
    toast.info(`已切换到 ${STAGES.find(s => s.id === newStage)?.label} 阶段`)

    try {
      await api.workshop.updateSession(sessionId, { stage: newStage })
      queryClient.invalidateQueries({ queryKey: ['workshop-sessions'] })
    } catch (e) {
      console.error('Failed to update session stage:', e)
    }
  }

  // ────────────────────────────────────────────────────────
  // 会话管理函数（借鉴OSSshelf-main AIChat.tsx:822-860）
  // ────────────────────────────────────────────────────────

  // 新建对话
  const handleNewChat = () => {
    setMessages([])
    setExtractedData({})
    setSessionId(null)
    setStage('concept')
  }

  // 选择/切换会话
  const handleSelectSession = (id: string) => {
    if (id === sessionId) return
    loadSession(id)
    if (window.innerWidth < 1024) setShowSidebar(false)
  }

  // 删除会话
  const handleDeleteSession = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    try {
      const res = await api.workshop.deleteSession(id)
      if (!res.ok) throw new Error('删除失败')

      queryClient.invalidateQueries({ queryKey: ['workshop-sessions'] })
      if (sessionId === id) handleNewChat()
      toast.success('会话已删除')
    } catch (error) {
      toast.error(`删除失败: ${(error as Error).message}`)
    }
  }

  // 确认重命名
  const handleConfirmRename = async (id: string) => {
    const v = renameValue.trim()
    if (v) {
      try {
        await api.workshop.updateSession(id, { title: v })
        queryClient.invalidateQueries({ queryKey: ['workshop-sessions'] })
      } catch (e) {
        console.error('重命名失败:', e)
      }
    }
    setRenamingId(null)
  }

  // 构建顶栏右侧操作区
  const headerActions = (
    <div className="flex items-center gap-3">
      {/* 侧边栏切换按钮 */}
      <button
        onClick={() => setShowSidebar(!showSidebar)}
        className={`h-8 w-8 rounded-lg flex items-center justify-center transition-colors ${
          showSidebar
            ? 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
            : 'text-violet-600 bg-violet-50 dark:bg-violet-900/20'
        }`}
        title={showSidebar ? '隐藏创作历史' : '显示创作历史'}
      >
        {showSidebar ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
      </button>

      {/* 阶段选择器 */}
      {sessionId && (
        <Select value={stage} onValueChange={handleStageChange}>
          <SelectTrigger className="w-[140px] h-8 text-xs">
            <SelectValue placeholder="选择阶段" />
          </SelectTrigger>
          <SelectContent>
            {STAGES.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                <span className="flex items-center gap-1.5">
                  <s.icon className="h-3.5 w-3.5" />
                  {s.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* 提交按钮 */}
      {sessionId && Object.keys(extractedData).length > 0 && (
        <Button size="sm" onClick={() => setShowCommitDialog(true)} className="gap-2">
          <CheckCircle2 className="h-4 w-4" />
          提交创建小说
        </Button>
      )}

      {/* 导入数据按钮 */}
      <Button size="sm" variant="outline" onClick={() => setShowImportDialog(true)} className="gap-2">
        <Upload className="h-4 w-4" />
        导入数据
      </Button>
    </div>
  )

  return (
    <MainLayout
      headerTitle="AI 创作工坊"
      headerSubtitle={
        sessionId 
          ? `当前阶段：${STAGES.find(s => s.id === stage)?.label}`
          : '通过多轮对话生成完整的小说框架'
      }
      headerActions={headerActions}
    >
      {/* 主内容区域 - 借鉴OSSshelf-main AIChat.tsx:871 flex布局 */}
      <div className="flex bg-background overflow-hidden h-[calc(100vh-8rem)] mx-6 mb-6 rounded-lg border shadow-sm">
        
        {/* 左侧：会话历史侧边栏 */}
        <WorkshopSidebar
          showSidebar={showSidebar}
          sessions={sessions}
          currentSessionId={sessionId}
          renamingId={renamingId}
          renameValue={renameValue}
          onNewChat={() => {
            handleNewChat()
            createSessionMutation.mutate()
          }}
          onSelectSession={handleSelectSession}
          onDeleteSession={handleDeleteSession}
          onStartRename={(session) => {
            setRenamingId(session.id)
            setRenameValue(session.title || '')
          }}
          onConfirmRename={handleConfirmRename}
          onCancelRename={() => setRenamingId(null)}
          onRenameValueChange={setRenameValue}
          onCloseMobile={() => setShowSidebar(false)}
        />

        {/* 中间：对话区域 */}
        <div className="flex-1 flex flex-col min-w-0">
          {!sessionId ? (
            /* 开始界面 */
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="text-center space-y-6 max-w-md">
                <div className="mx-auto w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/20 via-purple-500/10 to-pink-500/20 flex items-center justify-center shadow-lg">
                  <MessageSquare className="h-10 w-10 text-primary" />
                </div>

                <div className="space-y-2">
                  <h2 className="text-2xl font-bold">AI 创作助手</h2>
                  <p className="text-muted-foreground leading-relaxed">
                    通过多轮对话，帮我整理你的创意，<br />生成完整的小说框架。
                  </p>
                </div>

                <div className="pt-4">
                  <p className="text-sm font-medium text-left text-muted-foreground mb-3">创作流程：</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {STAGES.map((s, idx) => (
                      <div key={s.id} className={`flex items-start gap-3 p-3 rounded-xl border transition-all ${
                        idx === 0 
                          ? 'bg-primary/5 border-primary/30 shadow-sm' 
                          : 'bg-muted/30 border-transparent hover:border-border'
                      }`}>
                        <s.icon className={`h-5 w-5 mt-0.5 shrink-0 ${idx === 0 ? 'text-primary' : 'text-muted-foreground'}`} />
                        <div className="text-left min-w-0">
                          <p className="font-medium text-sm">{s.label}</p>
                          <p className="text-xs text-muted-foreground">{s.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <Button
                  size="lg"
                  onClick={() => createSessionMutation.mutate()}
                  disabled={createSessionMutation.isPending}
                  className="w-full mt-4"
                >
                  {createSessionMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      正在创建会话...
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4 mr-2" />
                      开始新的创作对话
                    </>
                  )}
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* 对话历史 */}
              <ScrollArea className="flex-1 p-6">
                <div className="max-w-3xl mx-auto space-y-4">
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                          msg.role === 'user'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted'
                        }`}
                      >
                        <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                      </div>
                    </div>
                  ))}

                  {/* 加载中指示器 */}
                  {isGenerating && (
                    <div className="flex justify-start">
                      <div className="bg-muted rounded-2xl px-4 py-3">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          AI 正在思考...
                        </div>
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>

              {/* 输入区域 */}
              <div className="border-t p-4 bg-background/50 backdrop-blur-sm">
                <div className="max-w-3xl mx-auto flex gap-3">
                  <Input
                    ref={inputRef}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                    placeholder={
                      isGenerating
                        ? 'AI 正在回复中...'
                        : STAGES.find(s => s.id === stage)?.description || '输入你的想法...'
                    }
                    disabled={isGenerating}
                    className="flex-1 h-10"
                  />
                  <Button
                    onClick={sendMessage}
                    disabled={!inputValue.trim() || isGenerating}
                    size="icon"
                    className="h-10 w-10"
                  >
                    {isGenerating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* 右侧：实时预览面板 */}
        <div className="hidden lg:flex flex-col w-80 xl:w-96 border-l bg-muted/30 overflow-auto">
          <div className="p-6 space-y-6 sticky top-0">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <BookOpen className="h-4 w-4" />
              实时预览 - 已提取的数据
            </h3>

            {Object.keys(extractedData).length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p className="text-sm">暂无提取数据</p>
                <p className="text-xs mt-1">与 AI 对话后，这里会显示结构化的创作数据</p>
              </div>
            ) : (
              <div className="space-y-4">
                {(extractedData.title || extractedData.genre || extractedData.description) && (
                  <PreviewCard title="基本信息" icon={Sparkles}>
                    {extractedData.title && (
                      <PreviewField label="标题" value={extractedData.title} highlight />
                    )}
                    {extractedData.genre && <PreviewField label="流派" value={extractedData.genre} />}
                    {extractedData.description && (
                      <PreviewField label="简介" value={extractedData.description} multiline />
                    )}
                    {extractedData.coreAppeal && (
                      <div className="space-y-1">
                        <span className="text-xs text-muted-foreground">核心看点</span>
                        <div className="flex flex-wrap gap-1">
                          {extractedData.coreAppeal.map((item, i) => (
                            <Badge key={i} variant="secondary" className="text-xs">
                              {item}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </PreviewCard>
                )}

                {extractedData.worldSettings && extractedData.worldSettings.length > 0 && (
                  <PreviewCard title="世界观设定" icon={Globe}>
                    {extractedData.worldSettings.map((ws, i) => (
                      <div key={i} className="mb-3 last:mb-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-medium text-sm">{ws.title}</p>
                          {ws.importance && (
                            <Badge 
                              variant={ws.importance === 'high' ? 'destructive' : ws.importance === 'low' ? 'secondary' : 'outline'} 
                              className="text-[10px]"
                            >
                              {ws.importance === 'high' ? '重要' : ws.importance === 'low' ? '次要' : '普通'}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-3">{ws.content}</p>
                      </div>
                    ))}
                  </PreviewCard>
                )}

                {extractedData.characters && extractedData.characters.length > 0 && (
                  <PreviewCard title="角色设计" icon={Users}>
                    {extractedData.characters.map((char, i) => (
                      <div key={i} className="mb-3 last:mb-0 pb-3 border-b last:border-b-0 last:pb-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-sm">{char.name}</span>
                          <Badge variant="outline" className="text-[10px]">
                            {char.role === 'protagonist' ? '主角' : char.role === 'antagonist' ? '反派' : char.role === 'minor' ? '次要' : '配角'}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2">{char.description}</p>
                      </div>
                    ))}
                  </PreviewCard>
                )}

                {extractedData.volumes && extractedData.volumes.length > 0 && (
                  <PreviewCard title="卷纲规划" icon={Layers}>
                    {extractedData.volumes.map((vol, i) => (
                      <div key={i} className="mb-3 last:mb-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-[10px]">第{i + 1}卷</Badge>
                          <span className="font-medium text-sm">{vol.title}</span>
                          <span className="text-[10px] text-muted-foreground ml-auto">
                            约{vol.chapterCount}章
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2 mb-1">{vol.summary || '暂无概述'}</p>
                        {vol.eventLine && vol.eventLine.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {vol.eventLine.slice(0, 3).map((event, idx) => (
                              <Badge key={idx} variant="secondary" className="text-[10px]">{event}</Badge>
                            ))}
                            {vol.eventLine.length > 3 && (
                              <Badge variant="secondary" className="text-[10px]">+{vol.eventLine.length - 3}</Badge>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </PreviewCard>
                )}

                {extractedData.chapters && extractedData.chapters.length > 0 && (
                  <PreviewCard title="章节大纲" icon={FileText}>
                    <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                      {extractedData.chapters.map((chap, i) => (
                        <div key={i} className="border-l-2 border-primary/20 pl-3 py-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="secondary" className="text-[10px]">第{i + 1}章</Badge>
                            <span className="font-medium text-sm">{chap.title}</span>
                          </div>
                          {chap.summary && (
                            <p className="text-xs text-muted-foreground line-clamp-2 ml-5">{chap.summary}</p>
                          )}
                          {chap.characters && chap.characters.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1 ml-5">
                              {chap.characters.slice(0, 4).map((char, idx) => (
                                <Badge key={idx} variant="outline" className="text-[10px]">{char}</Badge>
                              ))}
                              {chap.characters.length > 4 && (
                                <Badge variant="outline" className="text-[10px]">+{chap.characters.length - 4}</Badge>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </PreviewCard>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 提交确认对话框 */}
      <Dialog open={showCommitDialog} onOpenChange={setShowCommitDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认提交创作数据？</DialogTitle>
            <DialogDescription>
              确认后将创建新的小说项目并写入数据库
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-4">
            <p className="text-sm text-muted-foreground">
              以下数据将被写入数据库并创建新的小说项目：
            </p>

            <div className="grid grid-cols-2 gap-2 text-sm">
              {extractedData.title && (
                <div className="p-2 bg-primary/5 rounded">
                  <span className="text-muted-foreground">标题：</span>
                  <span className="font-medium">{extractedData.title}</span>
                </div>
              )}
              {extractedData.genre && (
                <div className="p-2 bg-primary/5 rounded">
                  <span className="text-muted-foreground">流派：</span>
                  <span className="font-medium">{extractedData.genre}</span>
                </div>
              )}
              {extractedData.characters && (
                <div className="p-2 bg-purple-50 dark:bg-purple-950 rounded">
                  <span className="text-muted-foreground">角色：</span>
                  <span className="font-medium">{extractedData.characters.length} 个</span>
                </div>
              )}
              {extractedData.volumes && (
                <div className="p-2 bg-blue-50 dark:bg-blue-950 rounded">
                  <span className="text-muted-foreground">卷数：</span>
                  <span className="font-medium">{extractedData.volumes.length} 卷</span>
                </div>
              )}
            </div>

            <p className="text-xs text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950 p-2 rounded">
              ⚠️ 提交后将在数据库中创建正式的小说、总纲、角色、卷等记录。此操作不可撤销。
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCommitDialog(false)}>
              取消
            </Button>
            <Button
              onClick={() => commitMutation.mutate()}
              disabled={commitMutation.isPending}
            >
              {commitMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  提交中...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  确认提交
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 导入数据对话框 */}
      <ImportDataDialog
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        onImportSuccess={(data) => {
          setExtractedData((prev) => ({
            ...prev,
            ...(Array.isArray(data.data) ? { importedItems: data.data } : data.data),
          }))
          toast.success('数据已导入，请确认后提交')
        }}
      />
    </MainLayout>
  )
}

// ============================================================
// 子组件
// ============================================================

function PreviewCard({
  title,
  icon: Icon,
  children,
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border bg-background p-4 space-y-3">
      <h4 className="text-sm font-semibold flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        {title}
      </h4>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function PreviewField({
  label,
  value,
  highlight,
  multiline,
}: {
  label: string
  value: string | undefined
  highlight?: boolean
  multiline?: boolean
}) {
  if (!value) return null

  return (
    <div className="space-y-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {multiline ? (
        <pre className="text-sm whitespace-pre-wrap bg-muted/50 p-2 rounded text-xs max-h-32 overflow-auto">
          {value}
        </pre>
      ) : (
        <p className={`text-sm ${highlight ? 'font-semibold text-base' : ''}`}>{value}</p>
      )}
    </div>
  )
}
