import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate, Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '@/lib/api';
import { useReaderStore } from '@/store/readerStore';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from '@/components/ui/select';
import { ArrowLeft, ChevronLeft, ChevronRight, Settings2 } from 'lucide-react';
import { useState } from 'react';
export default function ReaderPage() {
    const { id, chapterId } = useParams();
    const navigate = useNavigate();
    const [showSettings, setShowSettings] = useState(false);
    const { fontSize, theme, fontFamily, lineHeight, setFontSize, setTheme, setFontFamily } = useReaderStore();
    const { data: novel } = useQuery({
        queryKey: ['novel', id],
        queryFn: () => api.novels.get(id),
        enabled: !!id,
    });
    const { data: chapters } = useQuery({
        queryKey: ['chapters', id],
        queryFn: () => api.chapters.list(id),
        enabled: !!id,
    });
    const { data: chapter } = useQuery({
        queryKey: ['chapter', chapterId],
        queryFn: () => chapterId ? api.chapters.get(chapterId) : Promise.resolve(null),
        enabled: !!chapterId,
    });
    const currentIndex = chapters?.findIndex(c => c.id === chapterId) ?? -1;
    const prevChapter = currentIndex > 0 ? chapters?.[currentIndex - 1] : null;
    const nextChapter = currentIndex < (chapters?.length ?? 0) - 1 ? chapters?.[currentIndex + 1] : null;
    const readerClasses = `reader-${theme} min-h-screen transition-colors duration-200`;
    return (_jsxs("div", { className: readerClasses, style: {
            backgroundColor: `var(--reader-bg)`,
            color: `var(--reader-text)`,
            fontSize: `${fontSize}px`,
            fontFamily: fontFamily === 'serif' ? '"Noto Serif SC", serif' : 'system-ui, sans-serif',
            lineHeight: lineHeight,
        }, children: [_jsxs("header", { className: "sticky top-0 z-10 backdrop-blur-md bg-[var(--reader-bg)]/80 border-b border-[var(--reader-text)]/10", children: [_jsxs("div", { className: "max-w-3xl mx-auto px-4 py-3 flex items-center justify-between", children: [_jsxs(Link, { to: `/novels/${id}`, className: "flex items-center gap-2 text-sm hover:opacity-70", children: [_jsx(ArrowLeft, { className: "h-4 w-4" }), "\u8FD4\u56DE\u5DE5\u4F5C\u53F0"] }), _jsx("h2", { className: "font-medium text-center flex-1 truncate px-4", children: chapter?.title || novel?.title || '阅读器' }), _jsx(Button, { variant: "ghost", size: "icon", onClick: () => setShowSettings(!showSettings), children: _jsx(Settings2, { className: "h-4 w-4" }) })] }), showSettings && (_jsxs("div", { className: "border-t border-[var(--reader-text)]/10 px-4 py-3 space-y-3 max-w-3xl mx-auto", children: [_jsxs("div", { className: "flex items-center gap-4 text-sm", children: [_jsx("label", { className: "shrink-0", children: "\u5B57\u53F7" }), _jsxs(Select, { value: String(fontSize), onValueChange: (v) => setFontSize(Number(v)), children: [_jsx(SelectTrigger, { className: "w-20", children: _jsx(SelectValue, {}) }), _jsx(SelectContent, { children: [14, 16, 18, 20, 22, 24].map(s => (_jsxs(SelectItem, { value: String(s), children: [s, "px"] }, s))) })] })] }), _jsxs("div", { className: "flex items-center gap-4 text-sm", children: [_jsx("label", { className: "shrink-0", children: "\u4E3B\u9898" }), _jsxs(Select, { value: theme, onValueChange: (v) => setTheme(v), children: [_jsx(SelectTrigger, { className: "w-24", children: _jsx(SelectValue, {}) }), _jsxs(SelectContent, { children: [_jsx(SelectItem, { value: "light", children: "\u6D45\u8272" }), _jsx(SelectItem, { value: "dark", children: "\u6697\u8272" }), _jsx(SelectItem, { value: "sepia", children: "\u62A4\u773C" })] })] })] }), _jsxs("div", { className: "flex items-center gap-4 text-sm", children: [_jsx("label", { className: "shrink-0", children: "\u5B57\u4F53" }), _jsxs(Select, { value: fontFamily, onValueChange: (v) => setFontFamily(v), children: [_jsx(SelectTrigger, { className: "w-24", children: _jsx(SelectValue, {}) }), _jsxs(SelectContent, { children: [_jsx(SelectItem, { value: "serif", children: "\u886C\u7EBF" }), _jsx(SelectItem, { value: "sans", children: "\u65E0\u886C\u7EBF" })] })] })] })] }))] }), _jsx("main", { className: "max-w-3xl mx-auto px-8 py-12", children: chapter?.content ? (_jsx("article", { className: "prose prose-lg max-w-none", children: _jsx(ReactMarkdown, { remarkPlugins: [remarkGfm], children: chapter.content }) })) : (_jsxs("div", { className: "text-center py-20 opacity-60", children: [_jsx("p", { children: "\u8BF7\u9009\u62E9\u4E00\u4E2A\u7AE0\u8282\u5F00\u59CB\u9605\u8BFB" }), !chapterId && chapters && chapters.length > 0 && (_jsx(Button, { variant: "outline", className: "mt-4", onClick: () => navigate(`/novels/${id}/read/${chapters[0].id}`), children: "\u4ECE\u7B2C\u4E00\u7AE0\u5F00\u59CB" }))] })) }), (prevChapter || nextChapter) && (_jsx("footer", { className: "sticky bottom-0 backdrop-blur-md bg-[var(--reader-bg)]/80 border-t border-[var(--reader-text)]/10", children: _jsxs("div", { className: "max-w-3xl mx-auto px-4 py-3 flex justify-between items-center", children: [_jsxs(Button, { variant: "ghost", disabled: !prevChapter, onClick: () => prevChapter && navigate(`/novels/${id}/read/${prevChapter.id}`), className: "gap-2", children: [_jsx(ChevronLeft, { className: "h-4 w-4" }), "\u4E0A\u4E00\u7AE0"] }), _jsxs("span", { className: "text-xs opacity-50", children: [currentIndex + 1, " / ", chapters?.length] }), _jsxs(Button, { variant: "ghost", disabled: !nextChapter, onClick: () => nextChapter && navigate(`/novels/${id}/read/${nextChapter.id}`), className: "gap-2", children: ["\u4E0B\u4E00\u7AE0", _jsx(ChevronRight, { className: "h-4 w-4" })] })] }) }))] }));
}
