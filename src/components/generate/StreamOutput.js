import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Copy, Check } from 'lucide-react';
import { useState } from 'react';
export function StreamOutput({ content, status }) {
    const [copied, setCopied] = useState(false);
    const handleCopy = async () => {
        if (!content)
            return;
        await navigator.clipboard.writeText(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    if (status === 'idle') {
        return (_jsx("div", { className: "text-center text-muted-foreground py-8", children: _jsx("p", { className: "text-sm", children: "\u70B9\u51FB\"\u751F\u6210\"\u6309\u94AE\u5F00\u59CB AI \u521B\u4F5C" }) }));
    }
    return (_jsxs("div", { className: "space-y-2", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-xs font-medium text-muted-foreground uppercase tracking-wider", children: status === 'generating' ? '生成中...' : status === 'done' ? '生成完成' : '生成出错' }), content && (_jsxs(Button, { variant: "ghost", size: "sm", onClick: handleCopy, className: "h-7 gap-1", children: [copied ? _jsx(Check, { className: "h-3 w-3" }) : _jsx(Copy, { className: "h-3 w-3" }), copied ? '已复制' : '复制'] }))] }), _jsx(ScrollArea, { className: "h-[400px] rounded-md border bg-muted/30 p-4", children: _jsxs("div", { className: "whitespace-pre-wrap text-sm leading-relaxed font-serif", children: [content || (status === 'generating' ? '等待输出...' : ''), status === 'generating' && _jsx("span", { className: "animate-pulse", children: "\u258A" })] }) })] }));
}
