import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/sonner';
import NovelsPage from '@/pages/NovelsPage';
import WorkspacePage from '@/pages/WorkspacePage';
import ReaderPage from '@/pages/ReaderPage';
const qc = new QueryClient({
    defaultOptions: { queries: { staleTime: 1000 * 30 } },
});
export default function App() {
    return (_jsxs(QueryClientProvider, { client: qc, children: [_jsx(BrowserRouter, { children: _jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(Navigate, { to: "/novels", replace: true }) }), _jsx(Route, { path: "/novels", element: _jsx(NovelsPage, {}) }), _jsx(Route, { path: "/novels/:id", element: _jsx(WorkspacePage, {}) }), _jsx(Route, { path: "/novels/:id/read/:chapterId?", element: _jsx(ReaderPage, {}) })] }) }), _jsx(Toaster, { richColors: true })] }));
}
