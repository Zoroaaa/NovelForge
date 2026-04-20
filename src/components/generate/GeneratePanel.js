import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button } from '@/components/ui/button';
import { Square, PenLine } from 'lucide-react';
import { useGenerate } from '@/hooks/useGenerate';
import { StreamOutput } from './StreamOutput';
export function GeneratePanel({ novelId, chapterId, chapterTitle, onInsertContent }) {
    const { output, status, generate, stop } = useGenerate();
    const handleInsert = () => {
        if (output) {
            onInsertContent(output);
        }
    };
    return (_jsxs("div", { className: "p-4 space-y-4", children: [_jsxs("div", { className: "space-y-2", children: [_jsx("h3", { className: "font-semibold text-sm", children: "AI \u751F\u6210" }), _jsxs("p", { className: "text-xs text-muted-foreground", children: ["\u5F53\u524D\u7AE0\u8282\uFF1A", chapterTitle] })] }), _jsx("div", { className: "flex gap-2", children: status === 'generating' ? (_jsxs(Button, { variant: "destructive", size: "sm", className: "gap-2 flex-1", onClick: stop, children: [_jsx(Square, { className: "h-4 w-4" }), "\u505C\u6B62\u751F\u6210"] })) : (_jsxs(Button, { size: "sm", className: "gap-2 flex-1", onClick: () => generate(chapterId, novelId), children: [_jsx(PenLine, { className: "h-4 w-4" }), "\u751F\u6210\u5185\u5BB9"] })) }), _jsx(StreamOutput, { content: output, status: status }), status === 'done' && output && (_jsxs(Button, { variant: "outline", size: "sm", className: "w-full gap-2", onClick: handleInsert, children: [_jsx(PenLine, { className: "h-4 w-4" }), "\u5199\u5165\u7F16\u8F91\u5668"] }))] }));
}
