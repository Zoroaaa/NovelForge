import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Plus, ChevronRight, ChevronDown, FileText } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from '@/components/ui/select';
function buildTree(flat) {
    const map = new Map(flat.map(o => [o.id, { ...o, children: [] }]));
    const roots = [];
    for (const node of map.values()) {
        if (node.parentId)
            map.get(node.parentId)?.children.push(node);
        else
            roots.push(node);
    }
    const sort = (arr) => {
        arr.sort((a, b) => a.sortOrder - b.sortOrder);
        arr.forEach(n => sort(n.children));
        return arr;
    };
    return sort(roots);
}
export function OutlineTree({ novelId }) {
    const queryClient = useQueryClient();
    const [dialogOpen, setDialogOpen] = useState(false);
    const [parentId, setParentId] = useState(null);
    const [title, setTitle] = useState('');
    const [type, setType] = useState('chapter_outline');
    const [expandedIds, setExpandedIds] = useState(new Set());
    const { data: outlines, isLoading } = useQuery({
        queryKey: ['outlines', novelId],
        queryFn: () => api.outlines.list(novelId),
    });
    const createMutation = useMutation({
        mutationFn: api.outlines.create,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['outlines', novelId] });
            toast.success('大纲已创建');
            setDialogOpen(false);
            setTitle('');
        },
        onError: (error) => toast.error(error.message),
    });
    const deleteMutation = useMutation({
        mutationFn: api.outlines.delete,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['outlines', novelId] });
            toast.success('已删除');
        },
        onError: (error) => toast.error(error.message),
    });
    const handleCreate = (e) => {
        e.preventDefault();
        if (!title.trim())
            return;
        const data = {
            novelId,
            title: title.trim(),
            type: type,
            parentId: parentId,
            content: null,
        };
        createMutation.mutate(data);
    };
    const toggleExpand = (id) => {
        setExpandedIds(prev => {
            const next = new Set(prev);
            if (next.has(id))
                next.delete(id);
            else
                next.add(id);
            return next;
        });
    };
    const renderNode = (node, level = 0) => {
        const hasChildren = node.children.length > 0;
        const isExpanded = expandedIds.has(node.id);
        return (_jsxs("div", { children: [_jsxs("div", { className: "flex items-center gap-1 py-1 px-2 hover:bg-muted rounded cursor-pointer group", style: { paddingLeft: `${level * 16 + 8}px` }, children: [_jsx(Button, { variant: "ghost", size: "icon", className: "h-5 w-5", onClick: () => toggleExpand(node.id), children: hasChildren ? (isExpanded ? _jsx(ChevronDown, { className: "h-3 w-3" }) : _jsx(ChevronRight, { className: "h-3 w-3" })) : (_jsx("span", { className: "w-3" })) }), _jsx(FileText, { className: "h-4 w-4 text-muted-foreground" }), _jsx("span", { className: "flex-1 text-sm truncate", children: node.title }), _jsx(Button, { variant: "ghost", size: "icon", className: "h-6 w-6 opacity-0 group-hover:opacity-100 text-destructive", onClick: () => deleteMutation.mutate(node.id), children: "\u00D7" })] }), hasChildren && isExpanded && (_jsx("div", { children: node.children.map(child => renderNode(child, level + 1)) }))] }, node.id));
    };
    if (isLoading)
        return _jsx("div", { className: "animate-pulse space-y-2", children: [...Array(3)].map((_, i) => _jsx("div", { className: "h-8 bg-muted rounded" }, i)) });
    const tree = outlines ? buildTree(outlines) : [];
    return (_jsxs("div", { className: "space-y-2", children: [_jsxs(Dialog, { open: dialogOpen, onOpenChange: setDialogOpen, children: [_jsx(DialogTrigger, { asChild: true, children: _jsxs(Button, { variant: "outline", size: "sm", className: "w-full gap-2", onClick: () => setParentId(null), children: [_jsx(Plus, { className: "h-4 w-4" }), "\u6DFB\u52A0\u5927\u7EB2\u8282\u70B9"] }) }), _jsxs(DialogContent, { children: [_jsx(DialogHeader, { children: _jsx(DialogTitle, { children: "\u6DFB\u52A0\u5927\u7EB2\u8282\u70B9" }) }), _jsxs("form", { onSubmit: handleCreate, className: "space-y-4", children: [_jsxs("div", { className: "space-y-2", children: [_jsx(Label, { children: "\u7C7B\u578B" }), _jsxs(Select, { value: type, onValueChange: setType, children: [_jsx(SelectTrigger, { children: _jsx(SelectValue, {}) }), _jsxs(SelectContent, { children: [_jsx(SelectItem, { value: "world_setting", children: "\u4E16\u754C\u8BBE\u5B9A" }), _jsx(SelectItem, { value: "volume", children: "\u5377" }), _jsx(SelectItem, { value: "chapter_outline", children: "\u7AE0\u8282\u5927\u7EB2" }), _jsx(SelectItem, { value: "custom", children: "\u81EA\u5B9A\u4E49" })] })] })] }), _jsxs("div", { className: "space-y-2", children: [_jsx(Label, { htmlFor: "outline-title", children: "\u6807\u9898" }), _jsx(Input, { id: "outline-title", value: title, onChange: (e) => setTitle(e.target.value), placeholder: "\u8F93\u5165\u6807\u9898", autoFocus: true })] }), _jsxs("div", { className: "flex justify-end gap-2", children: [_jsx(Button, { type: "button", variant: "outline", onClick: () => setDialogOpen(false), children: "\u53D6\u6D88" }), _jsx(Button, { type: "submit", disabled: !title.trim() || createMutation.isPending, children: "\u521B\u5EFA" })] })] })] })] }), _jsx("div", { className: "mt-4", children: tree.length > 0 ? tree.map(node => renderNode(node)) : _jsx("p", { className: "text-sm text-muted-foreground text-center py-4", children: "\u6682\u65E0\u5927\u7EB2" }) })] }));
}
