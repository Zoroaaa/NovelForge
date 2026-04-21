/**
 * @file App.tsx
 * @description 应用根组件，配置路由和全局Provider
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from '@/components/ui/sonner'
import NovelsPage from '@/pages/NovelsPage'
import WorkspacePage from '@/pages/WorkspacePage'
import ReaderPage from '@/pages/ReaderPage'

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 1000 * 30 } },
})

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/novels" replace />} />
          <Route path="/novels" element={<NovelsPage />} />
          <Route path="/novels/:id" element={<WorkspacePage />} />
          <Route path="/novels/:id/read/:chapterId?" element={<ReaderPage />} />
        </Routes>
      </BrowserRouter>
      <Toaster richColors />
    </QueryClientProvider>
  )
}
