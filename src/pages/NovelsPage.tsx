import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Search, Filter, BookOpen, Sparkles } from 'lucide-react'
import { api } from '@/lib/api'
import { NovelCard } from '@/components/novel/NovelCard'
import { CreateNovelDialog } from '@/components/novel/CreateNovelDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import type { Novel, NovelInput } from '@/lib/types'
import { useState, useMemo } from 'react'

export default function NovelsPage() {
  const queryClient = useQueryClient()
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string | null>(null)

  const { data: novels, isLoading } = useQuery({
    queryKey: ['novels'],
    queryFn: api.novels.list,
  })

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
      const matchesSearch = searchQuery === '' || 
        novel.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (novel.description && novel.description.toLowerCase().includes(searchQuery.toLowerCase()))
      const matchesStatus = statusFilter === null || novel.status === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [novels, searchQuery, statusFilter])

  // 统计
  const stats = useMemo(() => {
    if (!novels) return { total: 0, writing: 0, completed: 0 }
    return {
      total: novels.length,
      writing: novels.filter(n => n.status === 'writing').length,
      completed: novels.filter(n => n.status === 'completed').length,
    }
  }, [novels])

  const handleCreate = (data: NovelInput) => {
    createMutation.mutate(data)
  }

  const handleDelete = (id: string) => {
    if (confirm('确定要删除这个小说吗？')) {
      deleteMutation.mutate(id)
    }
  }

  const handleEdit = (novel: Novel) => {
    const newTitle = prompt('编辑标题:', novel.title)
    if (newTitle && newTitle !== novel.title) {
      api.novels.update(novel.id, { title: newTitle }).then(() => {
        queryClient.invalidateQueries({ queryKey: ['novels'] })
        toast.success('已更新')
      }).catch((error) => toast.error(error.message))
    }
  }

  const handleStatusChange = (id: string, newStatus: string) => {
    api.novels.update(id, { status: newStatus as any }).then(() => {
      queryClient.invalidateQueries({ queryKey: ['novels'] })
      const statusLabels: Record<string, string> = {
        draft: '草稿',
        writing: '连载中',
        completed: '已完成',
        archived: '已归档',
      }
      toast.success(`状态已更新为：${statusLabels[newStatus] || newStatus}`)
    }).catch((error) => toast.error(error.message))
  }

  const statusLabels: Record<string, string> = {
    draft: '草稿',
    writing: '连载中',
    completed: '已完成',
    archived: '已归档',
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        {/* Header Skeleton */}
        <div className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="h-8 w-48 bg-muted rounded animate-pulse" />
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="animate-pulse space-y-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-40 bg-muted rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <BookOpen className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">我的小说</h1>
                <p className="text-sm text-muted-foreground">
                  共 {stats.total} 部作品 · {stats.writing} 部连载中
                </p>
              </div>
            </div>
            <CreateNovelDialog onCreate={handleCreate} />
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 搜索和过滤 */}
        <div className="flex flex-col sm:flex-row gap-4 mb-8">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索小说..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Badge
              variant={statusFilter === null ? 'default' : 'secondary'}
              className="cursor-pointer"
              onClick={() => setStatusFilter(null)}
            >
              全部
            </Badge>
            {Object.entries(statusLabels).map(([status, label]) => (
              <Badge
                key={status}
                variant={statusFilter === status ? 'default' : 'secondary'}
                className="cursor-pointer"
                onClick={() => setStatusFilter(statusFilter === status ? null : status)}
              >
                {label}
              </Badge>
            ))}
          </div>
        </div>

        {/* 小说列表 */}
        {filteredNovels.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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
          <div className="text-center py-20">
            {searchQuery || statusFilter ? (
              <>
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
                  <Search className="h-8 w-8 text-muted-foreground" />
                </div>
                <p className="text-lg font-medium text-muted-foreground mb-2">未找到匹配的小说</p>
                <p className="text-sm text-muted-foreground/60">尝试调整搜索条件</p>
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => { setSearchQuery(''); setStatusFilter(null) }}
                >
                  清除筛选
                </Button>
              </>
            ) : (
              <>
                <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                  <Sparkles className="h-10 w-10 text-primary" />
                </div>
                <p className="text-xl font-medium mb-2">开始你的创作之旅</p>
                <p className="text-sm text-muted-foreground mb-6">创建第一部小说，让AI助力你的写作</p>
                <CreateNovelDialog onCreate={handleCreate} />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
