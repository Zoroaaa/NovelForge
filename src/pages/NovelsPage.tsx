import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { NovelCard } from '@/components/novel/NovelCard'
import { CreateNovelDialog } from '@/components/novel/CreateNovelDialog'
import type { Novel, NovelInput } from '@/lib/types'

export default function NovelsPage() {
  const queryClient = useQueryClient()

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

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-8">
        <div className="max-w-7xl mx-auto">
          <div className="animate-pulse space-y-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-32 bg-muted rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold">我的小说</h1>
          <CreateNovelDialog onCreate={handleCreate} />
        </div>

        {novels && novels.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {novels.map((novel) => (
              <NovelCard
                key={novel.id}
                novel={novel}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-20 text-muted-foreground">
            <p className="text-lg mb-2">还没有小说</p>
            <p className="text-sm">点击右上角"新建小说"开始创作</p>
          </div>
        )}
      </div>
    </div>
  )
}
