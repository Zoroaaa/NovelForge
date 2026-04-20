import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useQuery } from '@tanstack/react-query';
import { useParams, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { api } from '@/lib/api';
import { AppLayout } from '@/components/layout/AppLayout';
import { Sidebar } from '@/components/layout/Sidebar';
import { ChapterEditor } from '@/components/chapter/ChapterEditor';
import { GeneratePanel } from '@/components/generate/GeneratePanel';
export default function WorkspacePage() {
    const { id } = useParams();
    const location = useLocation();
    const initialChapterId = location.state?.chapterId;
    const [activeChapterId, setActiveChapterId] = useState(initialChapterId || null);
    const { data: novel, isLoading: novelLoading } = useQuery({
        queryKey: ['novel', id],
        queryFn: () => api.novels.get(id),
        enabled: !!id,
    });
    const { data: chapters, isLoading: chaptersLoading } = useQuery({
        queryKey: ['chapters', id],
        queryFn: () => api.chapters.list(id),
        enabled: !!id,
    });
    const activeChapter = chapters?.find(c => c.id === activeChapterId);
    if (novelLoading || chaptersLoading) {
        return (_jsx("div", { className: "h-screen flex items-center justify-center", children: _jsx("div", { className: "animate-pulse text-muted-foreground", children: "\u52A0\u8F7D\u4E2D..." }) }));
    }
    if (!novel) {
        return (_jsx("div", { className: "h-screen flex items-center justify-center", children: _jsx("p", { className: "text-destructive", children: "\u5C0F\u8BF4\u4E0D\u5B58\u5728" }) }));
    }
    return (_jsx(AppLayout, { left: _jsx(Sidebar, { novelId: id }), center: activeChapter ? (_jsx(ChapterEditor, { chapter: activeChapter })) : (_jsx("div", { className: "h-full flex items-center justify-center", children: _jsxs("div", { className: "text-center text-muted-foreground space-y-2", children: [_jsx("p", { className: "text-lg", children: "\u9009\u62E9\u4E00\u4E2A\u7AE0\u8282\u5F00\u59CB\u7F16\u8F91" }), _jsx("p", { className: "text-sm", children: "\u6216\u4ECE\u5DE6\u4FA7\u9762\u677F\u521B\u5EFA\u65B0\u7AE0\u8282" })] }) })), right: activeChapter ? (_jsx(GeneratePanel, { novelId: id, chapterId: activeChapter.id, chapterTitle: activeChapter.title, onInsertContent: (content) => {
                console.log('Insert content:', content);
            } })) : undefined }));
}
