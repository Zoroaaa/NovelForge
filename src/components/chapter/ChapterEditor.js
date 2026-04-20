import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMutation } from '@tanstack/react-query';
import { EditorRoot, EditorContent } from 'novel';
import { useDebouncedCallback } from 'use-debounce';
import { api } from '@/lib/api';
export function ChapterEditor({ chapter }) {
    const mutation = useMutation({
        mutationFn: (content) => api.chapters.update(chapter.id, { content }),
    });
    const save = useDebouncedCallback((content) => {
        mutation.mutate(content);
    }, 1500);
    return (_jsxs("div", { className: "max-w-3xl mx-auto px-8 py-12", children: [_jsx("h1", { className: "text-2xl font-bold mb-8", children: chapter.title }), _jsx(EditorRoot, { children: _jsx(EditorContent, { initialContent: chapter.content ?? undefined, onUpdate: ({ editor }) => {
                        const html = editor.getHTML();
                        if (html !== '<p></p>')
                            save(html);
                    }, className: "font-serif text-base leading-relaxed focus:outline-none" }) }), _jsxs("div", { className: "text-xs text-muted-foreground mt-4 flex items-center gap-2", children: [_jsx("span", { className: `inline-block w-2 h-2 rounded-full ${mutation.isPending ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'}` }), mutation.isPending ? '保存中...' : '已保存'] })] }));
}
