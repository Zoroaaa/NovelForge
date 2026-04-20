import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from '@/components/ui/select';
import { Plus } from 'lucide-react';
export function CreateNovelDialog({ onCreate }) {
    const [open, setOpen] = useState(false);
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [genre, setGenre] = useState('');
    const handleSubmit = (e) => {
        e.preventDefault();
        if (!title.trim())
            return;
        onCreate({ title: title.trim(), description: description.trim() || undefined, genre: genre || undefined });
        setTitle('');
        setDescription('');
        setGenre('');
        setOpen(false);
    };
    return (_jsxs(Dialog, { open: open, onOpenChange: setOpen, children: [_jsx(DialogTrigger, { asChild: true, children: _jsxs(Button, { className: "gap-2", children: [_jsx(Plus, { className: "h-4 w-4" }), "\u65B0\u5EFA\u5C0F\u8BF4"] }) }), _jsxs(DialogContent, { className: "sm:max-w-[425px]", children: [_jsx(DialogHeader, { children: _jsx(DialogTitle, { children: "\u521B\u5EFA\u65B0\u5C0F\u8BF4" }) }), _jsxs("form", { onSubmit: handleSubmit, className: "space-y-4", children: [_jsxs("div", { className: "space-y-2", children: [_jsx(Label, { htmlFor: "title", children: "\u6807\u9898 *" }), _jsx(Input, { id: "title", value: title, onChange: (e) => setTitle(e.target.value), placeholder: "\u8F93\u5165\u5C0F\u8BF4\u6807\u9898", maxLength: 200, autoFocus: true })] }), _jsxs("div", { className: "space-y-2", children: [_jsx(Label, { htmlFor: "genre", children: "\u7C7B\u578B" }), _jsxs(Select, { value: genre, onValueChange: setGenre, children: [_jsx(SelectTrigger, { children: _jsx(SelectValue, { placeholder: "\u9009\u62E9\u7C7B\u578B" }) }), _jsxs(SelectContent, { children: [_jsx(SelectItem, { value: "\u7384\u5E7B", children: "\u7384\u5E7B" }), _jsx(SelectItem, { value: "\u4ED9\u4FA0", children: "\u4ED9\u4FA0" }), _jsx(SelectItem, { value: "\u90FD\u5E02", children: "\u90FD\u5E02" }), _jsx(SelectItem, { value: "\u79D1\u5E7B", children: "\u79D1\u5E7B" }), _jsx(SelectItem, { value: "\u5176\u4ED6", children: "\u5176\u4ED6" })] })] })] }), _jsxs("div", { className: "space-y-2", children: [_jsx(Label, { htmlFor: "description", children: "\u7B80\u4ECB" }), _jsx(Textarea, { id: "description", value: description, onChange: (e) => setDescription(e.target.value), placeholder: "\u8F93\u5165\u5C0F\u8BF4\u7B80\u4ECB\uFF08\u9009\u586B\uFF09", rows: 3 })] }), _jsxs("div", { className: "flex justify-end gap-2", children: [_jsx(Button, { type: "button", variant: "outline", onClick: () => setOpen(false), children: "\u53D6\u6D88" }), _jsx(Button, { type: "submit", disabled: !title.trim(), children: "\u521B\u5EFA" })] })] })] })] }));
}
