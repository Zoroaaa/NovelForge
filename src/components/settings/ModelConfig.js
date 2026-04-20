import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { PROVIDERS } from '@/lib/providers';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Settings2 } from 'lucide-react';
export function ModelConfig({ novelId }) {
    const queryClient = useQueryClient();
    const [showForm, setShowForm] = useState(false);
    const [provider, setProvider] = useState('volcengine');
    const [stage, setStage] = useState('chapter_gen');
    const [modelId, setModelId] = useState('');
    const [apiBase, setApiBase] = useState('');
    const { data: configs, isLoading } = useQuery({
        queryKey: ['model-configs', novelId],
        queryFn: () => api.settings.list(novelId),
    });
    const createMutation = useMutation({
        mutationFn: api.settings.create,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['model-configs', novelId] });
            toast.success('配置已添加');
            setShowForm(false);
            setModelId('');
            setApiBase('');
        },
        onError: (error) => toast.error(error.message),
    });
    const deleteMutation = useMutation({
        mutationFn: api.settings.delete,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['model-configs', novelId] });
            toast.success('已删除');
        },
        onError: (error) => toast.error(error.message),
    });
    const selectedProvider = PROVIDERS.find(p => p.id === provider);
    const handleCreate = (e) => {
        e.preventDefault();
        if (!modelId)
            return;
        createMutation.mutate({
            scope: novelId ? 'novel' : 'global',
            stage,
            provider,
            modelId,
            apiBase: apiBase || selectedProvider?.apiBase || undefined,
            apiKeyEnv: selectedProvider?.keyEnv || 'CUSTOM_API_KEY',
            ...(novelId ? { novelId } : {}),
        });
    };
    const stageLabels = {
        'outline_gen': '大纲生成',
        'chapter_gen': '章节生成',
        'summary_gen': '摘要生成',
        'vision': '视觉理解',
    };
    if (isLoading)
        return _jsx("div", { className: "animate-pulse space-y-3", children: [...Array(3)].map((_, i) => _jsx("div", { className: "h-20 bg-muted rounded-lg" }, i)) });
    return (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("h3", { className: "font-semibold text-sm flex items-center gap-2", children: [_jsx(Settings2, { className: "h-4 w-4" }), "\u6A21\u578B\u914D\u7F6E"] }), _jsxs(Button, { variant: "outline", size: "sm", onClick: () => setShowForm(!showForm), children: [_jsx(Plus, { className: "h-4 w-4" }), "\u6DFB\u52A0\u914D\u7F6E"] })] }), showForm && (_jsx(Card, { children: _jsx(CardContent, { className: "pt-6", children: _jsxs("form", { onSubmit: handleCreate, className: "space-y-4", children: [_jsxs("div", { className: "space-y-2", children: [_jsx(Label, { children: "\u63D0\u4F9B\u5546" }), _jsxs(Select, { value: provider, onValueChange: (v) => { setProvider(v); setModelId(''); setApiBase(''); }, children: [_jsx(SelectTrigger, { children: _jsx(SelectValue, {}) }), _jsx(SelectContent, { children: PROVIDERS.map(p => (_jsx(SelectItem, { value: p.id, children: p.name }, p.id))) })] })] }), _jsxs("div", { className: "space-y-2", children: [_jsx(Label, { children: "\u7528\u9014" }), _jsxs(Select, { value: stage, onValueChange: setStage, children: [_jsx(SelectTrigger, { children: _jsx(SelectValue, {}) }), _jsx(SelectContent, { children: Object.entries(stageLabels).map(([k, v]) => (_jsx(SelectItem, { value: k, children: v }, k))) })] })] }), _jsxs("div", { className: "space-y-2", children: [_jsx(Label, { children: "\u6A21\u578B" }), selectedProvider && selectedProvider.models.length > 0 ? (_jsxs(Select, { value: modelId, onValueChange: setModelId, children: [_jsx(SelectTrigger, { children: _jsx(SelectValue, { placeholder: "\u9009\u62E9\u6A21\u578B" }) }), _jsx(SelectContent, { children: selectedProvider.models.map(m => (_jsx(SelectItem, { value: m, children: m }, m))) })] })) : (_jsx(Input, { value: modelId, onChange: (e) => setModelId(e.target.value), placeholder: "\u8F93\u5165\u6A21\u578B ID" }))] }), provider === 'custom' && (_jsxs("div", { className: "space-y-2", children: [_jsx(Label, { children: "API Base URL" }), _jsx(Input, { value: apiBase, onChange: (e) => setApiBase(e.target.value), placeholder: "https://api.example.com/v1" })] })), _jsxs("div", { className: "flex justify-end gap-2", children: [_jsx(Button, { type: "button", variant: "outline", onClick: () => setShowForm(false), children: "\u53D6\u6D88" }), _jsx(Button, { type: "submit", disabled: !modelId || createMutation.isPending, children: "\u6DFB\u52A0" })] })] }) }) })), _jsx("div", { className: "space-y-2", children: configs && configs.length > 0 ? (configs.map((config) => (_jsx(Card, { children: _jsx(CardContent, { className: "py-3", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "space-y-1 flex-1", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "font-medium text-sm", children: config.modelId }), _jsx(Badge, { variant: "secondary", children: PROVIDERS.find(p => p.id === config.provider)?.name })] }), _jsxs("div", { className: "text-xs text-muted-foreground", children: [stageLabels[config.stage], " \u00B7 ", config.scope === 'global' ? '全局' : '当前小说'] })] }), _jsx(Button, { variant: "ghost", size: "icon", className: "h-8 w-8 text-destructive", onClick: () => deleteMutation.mutate(config.id), children: _jsx(Trash2, { className: "h-4 w-4" }) })] }) }) }, config.id)))) : (_jsx("p", { className: "text-sm text-muted-foreground text-center py-4", children: "\u6682\u65E0\u914D\u7F6E\uFF0C\u70B9\u51FB\u4E0A\u65B9\u6309\u94AE\u6DFB\u52A0" })) })] }));
}
