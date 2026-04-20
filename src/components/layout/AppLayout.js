import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
export function AppLayout({ left, center, right }) {
    const [rightOpen, setRightOpen] = useState(true);
    return (_jsxs("div", { className: "flex h-screen overflow-hidden bg-background", children: [_jsx("aside", { className: "w-64 shrink-0 border-r overflow-y-auto", children: left }), _jsx("main", { className: "flex-1 overflow-y-auto", children: center }), rightOpen && right && (_jsxs("aside", { className: "w-80 shrink-0 border-l overflow-y-auto relative", children: [_jsx(Button, { variant: "ghost", size: "icon", className: "absolute top-2 right-2 z-10", onClick: () => setRightOpen(false), children: _jsx(PanelRightClose, { className: "h-4 w-4" }) }), right] })), !rightOpen && right && (_jsx(Button, { variant: "ghost", size: "icon", className: "fixed top-4 right-4 z-10", onClick: () => setRightOpen(true), children: _jsx(PanelRightOpen, { className: "h-4 w-4" }) }))] }));
}
