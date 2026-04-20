import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { NovelCard } from '@/components/novel/NovelCard';
import { CreateNovelDialog } from '@/components/novel/CreateNovelDialog';
export default function NovelsPage() {
    const queryClient = useQueryClient();
    const { data: novels, isLoading } = useQuery({
        queryKey: ['novels'],
        queryFn: api.novels.list,
    });
    const createMutation = useMutation({
        mutationFn: api.novels.create,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['novels'] });
            toast.success('小说已创建');
        },
        onError: (error) => {
            toast.error(error.message);
        },
    });
    const deleteMutation = useMutation({
        mutationFn: api.novels.delete,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['novels'] });
            toast.success('小说已删除');
        },
        onError: (error) => {
            toast.error(error.message);
        },
    });
    const handleCreate = (data) => {
        createMutation.mutate(data);
    };
    const handleDelete = (id) => {
        if (confirm('确定要删除这个小说吗？')) {
            deleteMutation.mutate(id);
        }
    };
    const handleEdit = (novel) => {
        const newTitle = prompt('编辑标题:', novel.title);
        if (newTitle && newTitle !== novel.title) {
            api.novels.update(novel.id, { title: newTitle }).then(() => {
                queryClient.invalidateQueries({ queryKey: ['novels'] });
                toast.success('已更新');
            }).catch((error) => toast.error(error.message));
        }
    };
    if (isLoading) {
        return (_jsx("div", { className: "min-h-screen bg-background p-8", children: _jsx("div", { className: "max-w-7xl mx-auto", children: _jsx("div", { className: "animate-pulse space-y-4", children: [...Array(6)].map((_, i) => (_jsx("div", { className: "h-32 bg-muted rounded-lg" }, i))) }) }) }));
    }
    return (_jsx("div", { className: "min-h-screen bg-background p-8", children: _jsxs("div", { className: "max-w-7xl mx-auto", children: [_jsxs("div", { className: "flex items-center justify-between mb-8", children: [_jsx("h1", { className: "text-3xl font-bold", children: "\u6211\u7684\u5C0F\u8BF4" }), _jsx(CreateNovelDialog, { onCreate: handleCreate })] }), novels && novels.length > 0 ? (_jsx("div", { className: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6", children: novels.map((novel) => (_jsx(NovelCard, { novel: novel, onEdit: handleEdit, onDelete: handleDelete }, novel.id))) })) : (_jsxs("div", { className: "text-center py-20 text-muted-foreground", children: [_jsx("p", { className: "text-lg mb-2", children: "\u8FD8\u6CA1\u6709\u5C0F\u8BF4" }), _jsx("p", { className: "text-sm", children: "\u70B9\u51FB\u53F3\u4E0A\u89D2\"\u65B0\u5EFA\u5C0F\u8BF4\"\u5F00\u59CB\u521B\u4F5C" })] }))] }) }));
}
