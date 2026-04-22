/**
 * @file SetupPage.tsx
 * @description 系统初始化页面 - 首次部署时创建管理员账号
 * @version 1.0.0
 */
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, setToken } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import {
  Sparkles,
  Shield,
  User,
  Mail,
  Lock,
  Loader2,
  ArrowRight,
  CheckCircle,
} from 'lucide-react'

export default function SetupPage() {
  const navigate = useNavigate()
  const { login } = useAuthStore()

  const [isLoading, setIsLoading] = useState(true)
  const [isSetup, setIsSetup] = useState(true)
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  useEffect(() => {
    checkSetupStatus()
  }, [])

  async function checkSetupStatus() {
    try {
      const result = await api.setup.checkStatus()
      
      if (result.data.initialized && result.data.adminExists) {
        // 系统已初始化，跳转到登录页
        navigate('/login', { replace: true })
        return
      }
      
      setIsSetup(!result.data.initialized)
      setIsLoading(false)
    } catch (error) {
      toast.error('无法连接到服务器')
      setIsLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!username.trim() || !email.trim() || !password.trim()) {
      toast.error('请填写所有字段')
      return
    }

    if (username.length < 3 || username.length > 20) {
      toast.error('用户名长度应在3-20个字符之间')
      return
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      toast.error('用户名只能包含字母、数字和下划线')
      return
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error('请输入有效的邮箱地址')
      return
    }

    if (password.length < 8 || password.length > 64) {
      toast.error('密码长度应在8-64个字符之间')
      return
    }

    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
      toast.error('密码必须包含大小写字母和数字')
      return
    }

    if (password !== confirmPassword) {
      toast.error('两次输入的密码不一致')
      return
    }

    setIsCreating(true)
    try {
      const result = await api.setup.initialize({
        username: username.trim(),
        email: email.trim(),
        password,
      })
      
      // 自动登录
      setToken(result.data.token)
      await login(username.trim(), password)
      
      toast.success(result.message || '管理员账号创建成功！')
      navigate('/novels', { replace: true })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建失败，请重试')
    } finally {
      setIsCreating(false)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-purple-400 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-gray-300">正在检查系统状态...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 py-8 px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 shadow-lg shadow-purple-500/25 mb-4">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">NovelForge</h1>
          <p className="text-gray-400 mt-1">智能小说创作平台</p>
        </div>

        {/* 主卡片 */}
        <Card className="bg-white/10 backdrop-blur-lg border-white/20 text-white">
          <CardHeader className="space-y-2 text-center pb-2">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Shield className="w-6 h-6 text-yellow-400" />
              <CardTitle className="text-xl text-white">初始设置</CardTitle>
            </div>
            <CardDescription className="text-gray-300">
              {isSetup 
                ? '欢迎！创建您的管理员账号以开始使用 NovelForge'
                : '检测到系统中没有管理员账号，请创建一个'
              }
            </CardDescription>
          </CardHeader>
          
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* 提示信息 */}
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 text-sm text-blue-200">
                💡 此账号将拥有系统的<strong>管理员权限</strong>，
                可以管理邀请码、注册开关等系统配置。
              </div>

              {/* 用户名 */}
              <div className="space-y-2">
                <Label htmlFor="setup-username" className="text-gray-200 flex items-center gap-2">
                  <User className="w-4 h-4" />
                  管理员用户名
                </Label>
                <Input
                  id="setup-username"
                  type="text"
                  placeholder="admin"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="bg-white/5 border-white/20 text-white placeholder:text-gray-500 focus:border-purple-500"
                  disabled={isCreating}
                  autoComplete="new-username"
                />
              </div>
              
              {/* 邮箱 */}
              <div className="space-y-2">
                <Label htmlFor="setup-email" className="text-gray-200 flex items-center gap-2">
                  <Mail className="w-4 h-4" />
                  管理员邮箱
                </Label>
                <Input
                  id="setup-email"
                  type="email"
                  placeholder="admin@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-white/5 border-white/20 text-white placeholder:text-gray-500 focus:border-purple-500"
                  disabled={isCreating}
                  autoComplete="new-email"
                />
              </div>

              {/* 密码 */}
              <div className="space-y-2">
                <Label htmlFor="setup-password" className="text-gray-200 flex items-center gap-2">
                  <Lock className="w-4 h-4" />
                  管理员密码
                </Label>
                <Input
                  id="setup-password"
                  type="password"
                  placeholder="至少8位，含大小写字母和数字"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-white/5 border-white/20 text-white placeholder:text-gray-500 focus:border-purple-500"
                  disabled={isCreating}
                  autoComplete="new-password"
                />
              </div>

              {/* 确认密码 */}
              <div className="space-y-2">
                <Label htmlFor="setup-confirm" className="text-gray-200">确认密码</Label>
                <Input
                  id="setup-confirm"
                  type="password"
                  placeholder="再次输入密码"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="bg-white/5 border-white/20 text-white placeholder:text-gray-500 focus:border-purple-500"
                  disabled={isCreating}
                  autoComplete="new-password"
                />
              </div>

              {/* 提交按钮 */}
              <Button 
                type="submit" 
                className="w-full bg-gradient-to-r from-purple-600 to-violet-600 hover:from-purple-700 hover:to-violet-700 text-white shadow-lg shadow-purple-500/25"
                disabled={isCreating}
              >
                {isCreating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    正在创建...
                  </>
                ) : (
                  <>
                    创建管理员账号
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </form>

            {/* 安全提示 */}
            <div className="mt-6 pt-4 border-t border-white/10 text-xs text-gray-500 space-y-2">
              <p className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 mt-0.5 shrink-0 text-green-400" />
                <span>创建后您将自动登录并获得完整的管理员权限</span>
              </p>
              <p className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 mt-0.5 shrink-0 text-green-400" />
                <span>请妥善保管您的账号信息，建议后续在账号设置中修改密码</span>
              </p>
            </div>
          </CardContent>
        </Card>

        {/* 底部链接 */}
        <div className="text-center mt-6 text-sm text-gray-500">
          遇到问题？请检查服务器日志或联系技术支持
        </div>
      </div>
    </div>
  )
}
