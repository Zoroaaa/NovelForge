import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Plus, FileText, BookOpen } from 'lucide-react';
export function ChapterList({ novelId }) {
    const navigate = useNavigate();
    const { data: chapters, isLoading } = useQuery({
        queryKey: ['chapters', novelId],
        queryFn: () => api.chapters.list(novelId),
    });
    if (isLoading) {
        return _jsx("div", { className: "animate-pulse space-y-2", children: [...Array(5)].map((_, i) => _jsx("div", { className: "h-10 bg-muted rounded" }, i)) });
    }
    return (_jsxs("div", { className: "space-y-2", children: [_jsxs(Button, { variant: "outline", size: "sm", className: "w-full gap-2", onClick: () => { }, children: [_jsx(Plus, { className: "h-4 w-4" }), "\u6DFB\u52A0\u7AE0\u8282"] }), _jsx("div", { className: "mt-4 space-y-1", children: chapters && chapters.length > 0 ? (chapters.map((chapter) => (_jsxs("div", { className: "flex items-center gap-2 py-2 px-3 hover:bg-muted rounded cursor-pointer group", onClick: () => navigate(`/novels/${novelId}`, { state: { chapterId: chapter.id } }), children: [_jsx(FileText, { className: "h-4 w-4 text-muted-foreground shrink-0" }), _jsx("span", { className: "flex-1 text-sm truncate", children: chapter.title }), _jsx(Button, { variant: "ghost", size: "icon", className: "h-6 w-6 opacity-0 group-hover:opacity-100 shrink-0", onClick: (e) => {
                                e.stopPropagation();
                                navigate(`/novels/${novelId}/read/${chapter.id}`);
                            }, children: _jsx(BookOpen, { className: "h-3 w-3" }) })] }, chapter.id)))) : (_jsx("p", { className: "text-sm text-muted-foreground text-center py-4", children: "\u6682\u65E0\u7AE0\u8282" })) })] }));
}
