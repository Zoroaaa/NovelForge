/**
 * @file App.tsx
 * @description 应用根组件，配置路由和全局Provider
 * @version 2.0.0
 * @modified 2026-04-22 - 添加用户认证路由和守卫
 */
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Toaster } from '@/components/ui/sonner'
import { useAuthStore } from '@/store/authStore'
import { api, getToken } from '@/lib/api'

import NovelsPage from '@/pages/NovelsPage'
import WorkspacePage from '@/pages/WorkspacePage'
import ReaderPage from '@/pages/ReaderPage'
import WorkshopPage from '@/pages/WorkshopPage'
import LoginPage from '@/pages/LoginPage'
import RegisterPage from '@/pages/RegisterPage'
import AccountPage from '@/pages/AccountPage'
import ModelConfigPage from '@/pages/ModelConfigPage'
import SetupPage from '@/pages/SetupPage'

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 1000 * 30 } },
})

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const user = useAuthStore((state) => state.user)
  const checkAuth = useAuthStore((state) => state.checkAuth)
  const [isLoading, setIsLoading] = useState(true)
  const location = useLocation()

  useEffect(() => {
    const token = getToken()
    if (token && !isAuthenticated) {
      checkAuth().finally(() => setIsLoading(false))
    } else if (token && isAuthenticated && !user) {
      checkAuth().finally(() => setIsLoading(false))
    } else {
      setIsLoading(false)
    }
  }, [isAuthenticated, user])

  if (isLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center space-y-4">
          <div className="w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-gray-500">正在验证身份...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <>{children}</>
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const isLoading = useAuthStore((state) => state.isLoading)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setHydrated(true)
  }, [])

  if (!hydrated || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (isAuthenticated) {
    return <Navigate to="/novels" replace />
  }

  return <>{children}</>
}

function SetupGuard({ children }: { children: React.ReactNode }) {
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null)
  const location = useLocation()

  useEffect(() => {
    // 如果已经在 /setup 页面，不需要检查
    if (location.pathname === '/setup') {
      setNeedsSetup(false)
      return
    }

    // 检查系统是否已初始化
    api.setup.checkStatus()
      .then(result => {
        const needsInit = !result.data.initialized || !result.data.adminExists
        setNeedsSetup(needsInit)
      })
      .catch(() => setNeedsSetup(false))
  }, [location.pathname])

  // 加载中
  if (needsSetup === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center space-y-4">
          <div className="w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-gray-500">正在检查系统状态...</p>
        </div>
      </div>
    )
  }

  // 需要初始化
  if (needsSetup && location.pathname !== '/setup') {
    return <Navigate to="/setup" replace state={{ from: location }} />
  }

  return <>{children}</>
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <SetupGuard>
        <Routes>
          {/* 公开路由（无需登录） */}
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/login" element={
            <PublicRoute>
              <LoginPage />
            </PublicRoute>
          } />
          
          <Route path="/register" element={
            <PublicRoute>
              <RegisterPage />
            </PublicRoute>
          } />

          {/* 受保护的路由（需要登录） */}
          <Route path="/" element={<Navigate to="/novels" replace />} />
          
          <Route path="/account" element={
            <ProtectedRoute>
              <AccountPage />
            </ProtectedRoute>
          } />
          
          <Route path="/model-config" element={
            <ProtectedRoute>
              <ModelConfigPage />
            </ProtectedRoute>
          } />
          
          <Route path="/novels" element={
            <ProtectedRoute>
              <NovelsPage />
            </ProtectedRoute>
          } />
          
          <Route path="/novels/:id" element={
            <ProtectedRoute>
              <WorkspacePage />
            </ProtectedRoute>
          } />
          
          <Route path="/novels/:id/read/:chapterId?" element={
            <ProtectedRoute>
              <ReaderPage />
            </ProtectedRoute>
          } />
          
          <Route path="/workshop" element={
            <ProtectedRoute>
              <WorkshopPage />
            </ProtectedRoute>
          } />

          {/* 404 重定向 */}
          <Route path="*" element={<Navigate to="/novels" replace />} />
        </Routes>
        </SetupGuard>
      </BrowserRouter>
      <Toaster richColors />
    </QueryClientProvider>
  )
}
