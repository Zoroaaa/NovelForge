/**
 * @file WorkshopPage.tsx
 * @description 创作工坊页面 - 对话式创作引擎前端界面（v3.0 重构版）
 * @version 3.0.0
 * @modified 2026-04-27 - 组件拆分重构
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { MainLayout } from '@/components/layout/MainLayout'
import { WorkshopSidebar } from '@/components/workshop/WorkshopSidebar'
import { ImportDataDialog, type FormattedImportData } from '@/components/workshop/ImportDataDialog'
import { WelcomeView } from '@/components/workshop/WelcomeView'
import { ChatMessageList } from '@/components/workshop/ChatMessageList'
import { ChatInput } from '@/components/workshop/ChatInput'
import { PreviewPanel } from '@/components/workshop/PreviewPanel'
import { CommitDialog } from '@/components/workshop/CommitDialog'
import { WorkshopHeaderActions } from '@/components/workshop/WorkshopHeaderActions'
import type { WorkshopMessage, ExtractedData, SessionListItem } from '@/components/workshop/types'
import { STAGES } from '@/components/workshop/types'

export default function WorkshopPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessionNovelId, setSessionNovelId] = useState<string | null>(null)
  const [stage, setStage] = useState('concept')
  const [messages, setMessages] = useState<WorkshopMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [extractedData, setExtractedData] = useState<ExtractedData>({})
  const [showCommitDialog, setShowCommitDialog] = useState(false)
  const [showImportDialog, setShowImportDialog] = useState(false)

  const [showSidebar, setShowSidebar] = useState(() => window.innerWidth >= 1024)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const inputRef = useRef<HTMLInputElement>(null)

  const { data: sessions = [] } = useQuery({
    queryKey: ['workshop-sessions'],
    queryFn: async () => {
      const res = await api.workshop.listSessions()
      return (res.sessions || []) as SessionListItem[]
    },
    staleTime: 30000,
  })

  const loadSession = useCallback(async (id: string) => {
    try {
      setIsGenerating(true)
      const res = await api.workshop.getSession(id)
      if (res.ok && res.session) {
        setSessionId(id)
        setSessionNovelId(res.session.novelId || null)
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

  useEffect(() => {
    const sessionParam = searchParams.get('session')
    if (sessionParam && !sessionId) {
      loadSession(sessionParam)
      queryClient.invalidateQueries({ queryKey: ['workshop-sessions'] })
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, sessionId, loadSession, queryClient, setSearchParams])

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

  const commitMutation = useMutation({
    mutationFn: async () => {
      if (!sessionId) throw new Error('没有活动会话')
      const res = await api.workshop.commitSession(sessionId)
      if (!res.ok) throw new Error('提交失败')
      return res
    },
    onSuccess: (data) => {
      if (data.ok) {
        toast.success('🎉 创作数据已提交到后台处理！')
        setShowCommitDialog(false)
      }
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

  const handleNewChat = () => {
    setMessages([])
    setExtractedData({})
    setSessionId(null)
    setStage('concept')
  }

  const handleSelectSession = (id: string) => {
    if (id === sessionId) return
    loadSession(id)
    if (window.innerWidth < 1024) setShowSidebar(false)
  }

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

  const currentStageInfo = STAGES.find(s => s.id === stage)

  return (
    <MainLayout
      headerTitle="AI 创作工坊"
      headerSubtitle={
        sessionId
          ? `当前阶段：${currentStageInfo?.label}`
          : '通过多轮对话生成完整的小说框架'
      }
      headerActions={
        <WorkshopHeaderActions
          showSidebar={showSidebar}
          onToggleSidebar={() => setShowSidebar(!showSidebar)}
          sessionId={sessionId}
          stage={stage}
          onStageChange={handleStageChange}
          extractedData={extractedData}
          onShowCommitDialog={() => setShowCommitDialog(true)}
          onShowImportDialog={() => setShowImportDialog(true)}
        />
      }
    >
      <div className="flex bg-background overflow-hidden h-[calc(100vh-8rem)] mx-6 mb-6 rounded-lg border shadow-sm">
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

        <div className="flex-1 flex flex-col min-w-0">
          {!sessionId ? (
            <WelcomeView
              onStartChat={() => createSessionMutation.mutate()}
              isPending={createSessionMutation.isPending}
            />
          ) : (
            <>
              <ChatMessageList messages={messages} isGenerating={isGenerating} />
              <ChatInput
                value={inputValue}
                onChange={setInputValue}
                onSend={sendMessage}
                isGenerating={isGenerating}
                stage={stage}
              />
            </>
          )}
        </div>

        <PreviewPanel extractedData={extractedData} stage={stage} isGenerating={isGenerating} sessionId={sessionId ?? undefined} onReExtractSuccess={setExtractedData} />
      </div>

      <CommitDialog
        open={showCommitDialog}
        onOpenChange={setShowCommitDialog}
        extractedData={extractedData}
        sessionNovelId={sessionNovelId}
        stage={stage}
        onCommit={() => commitMutation.mutate()}
        isCommitting={commitMutation.isPending}
      />

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
