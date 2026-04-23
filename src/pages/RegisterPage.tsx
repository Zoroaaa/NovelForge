/**
 * @file RegisterPage.tsx
 * @description 用户注册页面（需要邀请码）
 * @version 1.0.1
 */
import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import { UserPlus, Loader2, AlertCircle } from 'lucide-react'

export default function RegisterPage() {
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [registrationEnabled, setRegistrationEnabled] = useState(true)
  
  const register = useAuthStore((state) => state.register)
  const navigate = useNavigate()

  useEffect(() => {
    let isMounted = true
    const checkStatus = async () => {
      try {
        const result = await api.systemSettings.getRegistrationStatus()
        if (isMounted) {
          setRegistrationEnabled(result.data.registrationEnabled)
        }
      } catch {
        if (isMounted) {
          toast.error('无法获取注册状态')
        }
      }
    }
    checkStatus()
    return () => { isMounted = false }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!username.trim() || !email.trim() || !password.trim()) {
      toast.error('请填写所有必填字段')
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

    setIsLoading(true)
    try {
      await register(
        username.trim(),
        email.trim(),
        password,
        inviteCode.trim()
      )
      toast.success('注册成功！欢迎加入 NovelForge')
      navigate('/novels', { replace: true })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '注册失败，请重试')
    } finally {
      setIsLoading(false)
    }
  }

  if (!registrationEnabled) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        <Card className="w-full max-w-md mx-4 bg-white/10 backdrop-blur-lg border-white/20 text-white">
          <CardContent className="pt-6">
            <div className="text-center space-y-4">
              <AlertCircle className="h-12 w-12 text-yellow-500 mx-auto" />
              <div>
                <h2 className="text-xl font-semibold">注册已关闭</h2>
                <p className="text-gray-400 mt-2">当前暂不开放新用户注册，请联系管理员获取邀请</p>
              </div>
              <Link to="/login">
                <Button variant="outline" className="border-white/20 text-white hover:bg-white/10">
                  返回登录
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 py-8">
      <div className="w-full max-w-md px-4">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">NovelForge</h1>
          <p className="text-gray-400">智能小说创作平台</p>
        </div>

        <Card className="bg-white/10 backdrop-blur-lg border-white/20 text-white">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl text-center">创建账号</CardTitle>
            <CardDescription className="text-gray-300 text-center">
              填写以下信息开始您的创作之旅
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username" className="text-gray-200">用户名 *</Label>
                <Input
                  id="username"
                  type="text"
                  placeholder="3-20位，支持字母数字下划线"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="bg-white/5 border-white/20 text-white placeholder:text-gray-500 focus:border-purple-500"
                  disabled={isLoading}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="email" className="text-gray-200">邮箱 *</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-white/5 border-white/20 text-white placeholder:text-gray-500 focus:border-purple-500"
                  disabled={isLoading}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-gray-200">密码 *</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="至少8位，含大小写字母和数字"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-white/5 border-white/20 text-white placeholder:text-gray-500 focus:border-purple-500"
                  disabled={isLoading}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-gray-200">确认密码 *</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="再次输入密码"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="bg-white/5 border-white/20 text-white placeholder:text-gray-500 focus:border-purple-500"
                  disabled={isLoading}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="inviteCode" className="text-gray-200">
                  邀请码 *
                </Label>
                <Input
                  id="inviteCode"
                  type="text"
                  placeholder="请输入邀请码"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  className="bg-white/5 border-white/20 text-white placeholder:text-gray-500 focus:border-purple-500"
                  disabled={isLoading}
                />
              </div>

              <Button 
                type="submit" 
                className="w-full bg-purple-600 hover:bg-purple-700 text-white"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    注册中...
                  </>
                ) : (
                  <>
                    <UserPlus className="mr-2 h-4 w-4" />
                    注册
                  </>
                )}
              </Button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-sm text-gray-400">
                已有账号？{' '}
                <Link to="/login" className="text-purple-400 hover:text-purple-300 underline">
                  立即登录
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
