import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, } from '@/components/ui/dropdown-menu';
import { MoreHorizontal, BookOpen, FileText, Trash2, Edit } from 'lucide-react';
const genreColors = {
    '玄幻': 'bg-purple-100 text-purple-800',
    '仙侠': 'bg-blue-100 text-blue-800',
    '都市': 'bg-green-100 text-green-800',
    '科幻': 'bg-cyan-100 text-cyan-800',
    '其他': 'bg-gray-100 text-gray-800',
};
export function NovelCard({ novel, onEdit, onDelete }) {
    const navigate = useNavigate();
    return (_jsx(Card, { className: "group hover:shadow-lg transition-all duration-200 cursor-pointer", children: _jsxs(CardContent, { className: "p-6", children: [_jsxs("div", { className: "flex items-start justify-between mb-4", children: [_jsxs("div", { className: "flex-1", onClick: () => navigate(`/novels/${novel.id}`), children: [_jsx("h3", { className: "text-lg font-semibold mb-2 line-clamp-1", children: novel.title }), novel.genre && (_jsx(Badge, { variant: "secondary", className: genreColors[novel.genre] || genreColors['其他'], children: novel.genre }))] }), _jsxs(DropdownMenu, { children: [_jsx(DropdownMenuTrigger, { asChild: true, children: _jsx(Button, { variant: "ghost", size: "icon", className: "opacity-0 group-hover:opacity-100 transition-opacity", children: _jsx(MoreHorizontal, { className: "h-4 w-4" }) }) }), _jsxs(DropdownMenuContent, { align: "end", children: [_jsxs(DropdownMenuItem, { onClick: () => navigate(`/novels/${novel.id}`), children: [_jsx(BookOpen, { className: "mr-2 h-4 w-4" }), "\u8FDB\u5165\u5DE5\u4F5C\u53F0"] }), _jsxs(DropdownMenuItem, { onClick: () => onEdit(novel), children: [_jsx(Edit, { className: "mr-2 h-4 w-4" }), "\u7F16\u8F91"] }), _jsxs(DropdownMenuItem, { onClick: () => onDelete(novel.id), className: "text-destructive", children: [_jsx(Trash2, { className: "mr-2 h-4 w-4" }), "\u5220\u9664"] })] })] })] }), novel.description && (_jsx("p", { className: "text-sm text-muted-foreground mb-4 line-clamp-2", children: novel.description })), _jsxs("div", { className: "flex items-center gap-4 text-xs text-muted-foreground", children: [_jsxs("span", { className: "flex items-center gap-1", children: [_jsx(FileText, { className: "h-3 w-3" }), (novel.wordCount / 1000).toFixed(1), "k \u5B57"] }), _jsxs("span", { children: [novel.chapterCount, " \u7AE0"] }), _jsx("span", { children: new Date(novel.updatedAt).toLocaleDateString() })] })] }) }));
}
