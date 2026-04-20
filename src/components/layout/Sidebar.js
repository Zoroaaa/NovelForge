import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { OutlineTree } from '@/components/outline/OutlineTree';
import { ChapterList } from '@/components/chapter/ChapterList';
import { useNovelStore } from '@/store/novelStore';
export function Sidebar({ novelId }) {
    const { sidebarTab, setSidebarTab } = useNovelStore();
    return (_jsx("div", { className: "p-4 h-full flex flex-col", children: _jsxs(Tabs, { value: sidebarTab, onValueChange: (v) => setSidebarTab(v), className: "flex-1 flex flex-col", children: [_jsxs(TabsList, { className: "grid w-full grid-cols-3 mb-4", children: [_jsx(TabsTrigger, { value: "outline", children: "\u5927\u7EB2" }), _jsx(TabsTrigger, { value: "chapters", children: "\u7AE0\u8282" }), _jsx(TabsTrigger, { value: "characters", children: "\u89D2\u8272" })] }), _jsx(TabsContent, { value: "outline", className: "flex-1 overflow-y-auto mt-0", children: _jsx(OutlineTree, { novelId: novelId }) }), _jsx(TabsContent, { value: "chapters", className: "flex-1 overflow-y-auto mt-0", children: _jsx(ChapterList, { novelId: novelId }) }), _jsx(TabsContent, { value: "characters", className: "flex-1 overflow-y-auto mt-0", children: _jsx("div", { className: "text-center text-muted-foreground py-8", children: _jsx("p", { children: "\u89D2\u8272\u7BA1\u7406\u529F\u80FD\u5F00\u53D1\u4E2D..." }) }) })] }) }));
}
