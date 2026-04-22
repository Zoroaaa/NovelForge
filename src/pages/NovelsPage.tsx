/**
 * @file NovelsPage.tsx
 * @description 小说列表页面组件（v2.0）- 使用新布局系统，集成所有功能入口
 * @version 2.0.0
 * @modified 2026-04-22 - 重构为MainLayout架构，优化视觉层次和功能入口
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Search,
  Filter,
  BookOpen,
  Sparkles,
  Trash2,
  Wand2,
  Plus,
  LayoutGrid,
  List,
} from 'lucide-react'
import { api } from '@/lib/api'
import { NovelCard } from '@/components/novel/NovelCard'
import { CreateNovelDialog } from '@/components/novel/CreateNovelDialog'
import { EditNovelDialog } from '@/components/novel/EditNovelDialog'
import { MainLayout } from '@/components/layout/MainLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { Novel, NovelInput } from '@/lib/types'
import { useState, useMemo } from 'react'

/**
 * 小说列表页面组件（v2.0）
 * @description 采用MainLayout架构，左侧导航+顶栏+内容区，功能入口清晰分层
 */
export default function NovelsPage() {
  const queryClient = useQueryClient()
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [editingNovel, setEditingNovel] = useState<Novel | null>(null)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Novel | null>(null)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')

  const { data: novelsData, isLoading } = useQuery({
    queryKey: ['novels'],
    queryFn: api.novels.list,
  })

  const novels = novelsData?.data

  const createMutation = useMutation({
    mutationFn: api.novels.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['novels'] })
      toast.success('小说已创建')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: api.novels.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['novels'] })
      toast.success('小说已删除')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  // 过滤和搜索
  const filteredNovels = useMemo(() => {
    if (!novels) return []
    return novels.filter((novel) => {
      const matchesSearch =
        searchQuery === '' ||
        novel.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (novel.description &&
          novel.description.toLowerCase().includes(searchQuery.toLowerCase()))
      const matchesStatus = statusFilter === null || novel.status === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [novels, searchQuery, statusFilter])

  // 统计信息
  const stats = useMemo(() => {
    if (!novels) return { total: 0, writing: 0, completed: 0, draft: 0 }
    return {
      total: novels.length,
      writing: novels.filter((n) => n.status === 'writing').length,
      completed: novels.filter((n) => n.status === 'completed').length,
      draft: novels.filter((n) => n.status === 'draft').length,
    }
  }, [novels])

  const handleCreate = (data: NovelInput) => {
    createMutation.mutate(data)
  }

  const handleDelete = (novel: Novel) => {
    setDeleteTarget(novel)
  }

  const confirmDelete = () => {
    if (deleteTarget) {
      deleteMutation.mutate(deleteTarget.id)
      setDeleteTarget(null)
    }
  }

  const handleEdit = (novel: Novel) => {
    setEditingNovel(novel)
    setEditDialogOpen(true)
  }

  const handleSaveEdit = (
    id: string,
    data: { title: string; description?: string; genre?: string }
  ) => {
    api
      .novels.update(id, data)
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['novels'] })
        toast.success('已更新')
      })
      .catch((error) => toast.error(error.message))
  }

  const handleStatusChange = (id: string, newStatus: string) => {
    api
      .novels.update(id, { status: newStatus as any })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['novels'] })
        const statusLabels: Record<string, string> = {
          draft: '草稿',
          writing: '连载中',
          completed: '已完成',
          archived: '已归档',
        }
        toast.success(`状态已更新为：${statusLabels[newStatus] || newStatus}`)
      })
      .catch((error) => toast.error(error.message))
  }

  const statusLabels: Record<string, string> = {
    draft: '草稿',
    writing: '连载中',
    completed: '已完成',
    archived: '已归档',
  }

  // 顶部栏右侧操作按钮
  const headerActions = (
    <div className="flex items-center gap-2">
      {/* 视图切换 */}
      <div className="hidden sm:flex items-center border rounded-md p-0.5">
        <Button
          variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => setViewMode('grid')}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant={viewMode === 'list' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => setViewMode('list')}
        >
          <List className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* 创建按钮 */}
      <CreateNovelDialog onCreate={handleCreate} />
    </div>
  )

  // 加载状态
  if (isLoading) {
    return (
      <MainLayout headerTitle="我的小说" headerSubtitle="管理您的创作项目">
        <div className="p-6 lg:p-8 space-y-6 animate-pulse">
          {/* 统计卡片骨架 */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-24 bg-muted rounded-xl" />
            ))}
          </div>
          
          {/* 搜索框骨架 */}
          <div className="h-10 bg-muted rounded-lg max-w-md" />
          
          {/* 小说卡片骨架 */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-48 bg-muted rounded-xl" />
            ))}
          </div>
        </div>
      </MainLayout>
    )
  }

  return (
    <MainLayout
      headerTitle="我的小说"
      headerSubtitle={`共 ${stats.total} 部作品 · ${stats.writing} 部连载中 · ${stats.completed} 部已完成`}
      headerActions={headerActions}
    >
      <div className="p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
        {/* 统计概览卡片 */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/20 rounded-xl p-4 border border-blue-100/50 dark:border-blue-900/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-blue-600/70 dark:text-blue-400/60 font-medium uppercase tracking-wide">
                  全部作品
                </p>
                <p className="text-2xl font-bold text-blue-900 dark:text-blue-100 mt-1">
                  {stats.total}
                </p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <BookOpen className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/20 rounded-xl p-4 border border-emerald-100/50 dark:border-emerald-900/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-emerald-600/70 dark:text-emerald-400/60 font-medium uppercase tracking-wide">
                  连载中
                </p>
                <p className="text-2xl font-bold text-emerald-900 dark:text-emerald-100 mt-1">
                  {stats.writing}
                </p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-950/30 dark:to-purple-950/20 rounded-xl p-4 border border-violet-100/50 dark:border-violet-900/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-violet-600/70 dark:text-violet-400/60 font-medium uppercase tracking-wide">
                  已完成
                </p>
                <p className="text-2xl font-bold text-violet-900 dark:text-violet-100 mt-1">
                  {stats.completed}
                </p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center">
                <BookOpen className="w-5 h-5 text-violet-600 dark:text-violet-400" />
              </div>
            </div>
          </div>
        </div>

        {/* 搜索和过滤工具栏 */}
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
          <div className="relative flex-1 max-w-md w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索小说标题或描述..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-10"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Badge
              variant={statusFilter === null ? 'default' : 'outline'}
              className="cursor-pointer transition-all hover:scale-105"
              onClick={() => setStatusFilter(null)}
            >
              全部
            </Badge>
            {Object.entries(statusLabels).map(([status, label]) => (
              <Badge
                key={status}
                variant={statusFilter === status ? 'default' : 'outline'}
                className="cursor-pointer transition-all hover:scale-105"
                onClick={() =>
                  setStatusFilter(statusFilter === status ? null : status)
                }
              >
                {label}
              </Badge>
            ))}
          </div>
        </div>

        {/* 小说列表/网格 */}
        {filteredNovels.length > 0 ? (
          <div
            className={
              viewMode === 'grid'
                ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6'
                : 'space-y-4'
            }
          >
            {filteredNovels.map((novel) => (
              <NovelCard
                key={novel.id}
                novel={novel}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onStatusChange={handleStatusChange}
              />
            ))}
          </div>
        ) : (
          /* 空状态 */
          <div className="text-center py-16 px-4">
            {searchQuery || statusFilter ? (
              <>
                <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-gray-100 to-gray-50 dark:from-gray-800 dark:to-gray-900 flex items-center justify-center shadow-sm">
                  <Search className="h-10 w-10 text-gray-400 dark:text-gray-500" />
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-2">
                  未找到匹配的小说
                </h3>
                <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
                  尝试调整搜索条件或筛选器来查找您的内容
                </p>
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearchQuery('')
                    setStatusFilter(null)
                  }}
                  className="gap-2"
                >
                  <Filter className="h-4 w-4" />
                  清除所有筛选
                </Button>
              </>
            ) : (
              <>
                <div className="w-24 h-24 mx-auto mb-8 rounded-3xl bg-gradient-to-br from-primary/20 via-purple-500/10 to-pink-500/20 flex items-center justify-center shadow-lg shadow-primary/5">
                  <Sparkles className="h-12 w-12 text-primary" />
                </div>
                <h3 className="text-2xl font-bold text-foreground mb-3">
                  开始您的创作之旅 ✨
                </h3>
                <p className="text-sm text-muted-foreground mb-8 max-w-md mx-auto leading-relaxed">
                  创建您的第一部小说，让AI助力每一个创作环节。
                  从构思到成书，NovelForge 伴您同行。
                </p>
                <div className="flex items-center justify-center gap-4 flex-wrap">
                  <CreateNovelDialog onCreate={handleCreate} />
                  <Button variant="outline" size="lg" className="gap-2" asChild>
                    <Link to="/workshop">
                      <Wand2 className="h-4 w-4" />
                      进入 AI 创作工坊
                    </Link>
                  </Button>
                </div>
                
                {/* 功能提示 */}
                <div className="mt-12 pt-8 border-t border-border/50 max-w-lg mx-auto">
                  <p className="text-xs text-muted-foreground/60 mb-4 uppercase tracking-wider font-medium">
                    新手指南
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
                    <div className="p-3 rounded-lg bg-muted/30">
                      <span className="text-sm font-medium">1️⃣ 创建</span>
                      <p className="text-xs text-muted-foreground mt-1">
                        设定小说基础信息和世界观
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-muted/30">
                      <span className="text-sm font-medium">2️⃣ 规划</span>
                      <p className="text-xs text-muted-foreground mt-1">
                        编写总纲、角色设定、创作规则
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-muted/30">
                      <span className="text-sm font-medium">3️⃣ 创作</span>
                      <p className="text-xs text-muted-foreground mt-1">
                        AI辅助章节生成与持续迭代
                      </p>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* 编辑对话框 */}
      {editingNovel && (
        <EditNovelDialog
          key={editingNovel.id}
          novelId={editingNovel.id}
          initialTitle={editingNovel.title}
          initialDescription={editingNovel.description || ''}
          initialGenre={editingNovel.genre || ''}
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          onSave={handleSaveEdit}
        />
      )}

      {/* 删除确认对话框 */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open: boolean) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" />
              确认删除
            </AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除小说《{deleteTarget?.title}》吗？此操作可以撤销，删除后数据将进入回收站。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MainLayout>
  )
}
