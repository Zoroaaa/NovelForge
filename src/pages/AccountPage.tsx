/**
 * @file AccountPage.tsx
 * @description 账号管理页面：用户信息、密码修改、邀请码管理、系统设置
 * @version 1.0.2
 * @modified 2026-04-22 - 集成MainLayout布局系统
 */
import { useState, useEffect, useCallback } from 'react'
import { useAuthStore } from '@/store/authStore'
import { api } from '@/lib/api'
import type { InviteCode } from '@/lib/api'
import { MainLayout } from '@/components/layout/MainLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import {
  User, Key, Trash2, Plus, Copy, CheckCircle, XCircle,
  Loader2, Shield, Settings, LogOut,
  ToggleLeft, ToggleRight
} from 'lucide-react'

export default function AccountPage() {
  const { user, logout } = useAuthStore()

  const [activeTab, setActiveTab] = useState('profile')
  
  // 密码修改状态
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [isChangingPassword, setIsChangingPassword] = useState(false)
  
  // 邀请码管理状态（管理员）
  const [inviteCodes, setInviteCodes] = useState<InviteCode[]>([])
  const [isLoadingCodes, setIsLoadingCodes] = useState(false)
  const [isCreatingCode, setIsCreatingCode] = useState(false)
  const [newCodeMaxUses, setNewCodeMaxUses] = useState(1)
  const [newCodeExpiresInDays, setNewCodeExpiresInDays] = useState<number | undefined>(undefined)
  
  // 注册开关状态（管理员）
  const [registrationEnabled, setRegistrationEnabled] = useState(false)
  const [isUpdatingRegistration, setIsUpdatingRegistration] = useState(false)

  // 定义所有处理函数（在useEffect之前）
  const fetchInviteCodes = useCallback(async () => {
    setIsLoadingCodes(true)
    try {
      const result = await api.inviteCodes.list({ pageSize: 50 })
      setInviteCodes(result.data.items)
    } catch {
      toast.error('获取邀请码列表失败')
    } finally {
      setIsLoadingCodes(false)
    }
  }, [])

  const fetchRegistrationStatus = useCallback(async () => {
    try {
      const result = await api.systemSettings.getRegistrationStatus()
      setRegistrationEnabled(result.data.registrationEnabled)
    } catch {
      toast.error('获取注册状态失败')
    }
  }, [])

  useEffect(() => {
    if (user?.role === 'admin') {
      fetchInviteCodes()
      fetchRegistrationStatus()
    }
  }, [user, fetchInviteCodes, fetchRegistrationStatus])

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    
    if (!currentPassword || !newPassword || !confirmNewPassword) {
      toast.error('请填写所有字段')
      return
    }

    if (newPassword.length < 8 || newPassword.length > 64) {
      toast.error('新密码长度应在8-64个字符之间')
      return
    }

    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(newPassword)) {
      toast.error('新密码必须包含大小写字母和数字')
      return
    }

    if (newPassword !== confirmNewPassword) {
      toast.error('两次输入的新密码不一致')
      return
    }

    setIsChangingPassword(true)
    try {
      await api.auth.changePassword({ currentPassword, newPassword })
      toast.success('密码修改成功')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmNewPassword('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '密码修改失败')
    } finally {
      setIsChangingPassword(false)
    }
  }

  async function handleDeleteAccount() {
    try {
      await api.auth.deleteAccount()
      toast.success('账号已删除')
      logout()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败')
    }
  }

  async function handleCreateInviteCode() {
    setIsCreatingCode(true)
    try {
      const newCode = await api.inviteCodes.create({
        maxUses: newCodeMaxUses,
        expiresInDays: newCodeExpiresInDays || undefined
      })
      setInviteCodes([newCode, ...inviteCodes])
      toast.success('邀请码创建成功')
      setNewCodeMaxUses(1)
      setNewCodeExpiresInDays(undefined)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建邀请码失败')
    } finally {
      setIsCreatingCode(false)
    }
  }

  async function handleToggleInviteCode(id: string, currentStatus: string) {
    const newStatus = currentStatus === 'active' ? 'disabled' : 'active'
    try {
      await api.inviteCodes.updateStatus(id, newStatus)
      setInviteCodes(inviteCodes.map(code =>
        code.id === id ? { ...code, status: newStatus } : code
      ))
      toast.success(`邀请码已${newStatus === 'active' ? '启用' : '禁用'}`)
    } catch {
      toast.error('更新状态失败')
    }
  }

  async function handleDeleteInviteCode(id: string) {
    try {
      await api.inviteCodes.delete(id)
      setInviteCodes(inviteCodes.filter(code => code.id !== id))
      toast.success('邀请码已删除')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败')
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text)
    toast.success('已复制到剪贴板')
  }

  async function handleToggleRegistration() {
    setIsUpdatingRegistration(true)
    try {
      const result = await api.systemSettings.updateRegistrationStatus(!registrationEnabled)
      setRegistrationEnabled(result.data.registrationEnabled)
      toast.success(result.message)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新失败')
    } finally {
      setIsUpdatingRegistration(false)
    }
  }

  if (!user) return null

  const isAdmin = user.role === 'admin'

  // 顶栏右侧操作（角色徽章 + 退出登录）
  const headerActions = (
    <div className="flex items-center gap-3">
      <Badge variant={isAdmin ? "default" : "secondary"} className={isAdmin ? "bg-purple-600" : ""}>
        {isAdmin ? <Shield className="w-3 h-3 mr-1" /> : <User className="w-3 h-3 mr-1" />}
        {isAdmin ? '管理员' : '用户'}
      </Badge>
      
      <Button variant="outline" size="sm" onClick={logout} className="gap-2">
        <LogOut className="w-4 h-4" />
        退出
      </Button>
    </div>
  )

  return (
    <MainLayout
      headerTitle="账号设置"
      headerSubtitle={`管理您的个人信息和安全设置`}
      headerActions={headerActions}
    >
      <div className="p-6 lg:p-8 max-w-4xl mx-auto space-y-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-2 lg:w-auto lg:inline-grid">
            <TabsTrigger value="profile">
              <User className="w-4 h-4 mr-2" />
              个人信息
            </TabsTrigger>
            <TabsTrigger value="security">
              <Key className="w-4 h-4 mr-2" />
              安全设置
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger value="admin">
                <Settings className="w-4 h-4 mr-2" />
                管理面板
              </TabsTrigger>
            )}
          </TabsList>

          {/* 个人信息 */}
          <TabsContent value="profile">
            <Card>
              <CardHeader>
                <CardTitle>个人信息</CardTitle>
                <CardDescription>查看和编辑您的个人资料</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>用户名</Label>
                    <Input value={user.username} disabled className="bg-gray-100" />
                  </div>
                  <div className="space-y-2">
                    <Label>邮箱</Label>
                    <Input value={user.email} disabled className="bg-gray-100" />
                  </div>
                  <div className="space-y-2">
                    <Label>角色</Label>
                    <Input value={user.role === 'admin' ? '管理员' : '普通用户'} disabled className="bg-gray-100" />
                  </div>
                  <div className="space-y-2">
                    <Label>注册时间</Label>
                    <Input 
                      value={new Date(user.created_at * 1000).toLocaleDateString('zh-CN')} 
                      disabled 
                      className="bg-gray-100" 
                    />
                  </div>
                  {user.last_login_at && (
                    <div className="space-y-2 md:col-span-2">
                      <Label>最后登录时间</Label>
                      <Input 
                        value={new Date(user.last_login_at * 1000).toLocaleString('zh-CN')} 
                        disabled 
                        className="bg-gray-100" 
                      />
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 安全设置 */}
          <TabsContent value="security">
            <div className="space-y-6">
              {/* 修改密码 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Key className="w-5 h-5" />
                    修改密码
                  </CardTitle>
                  <CardDescription>定期更换密码可以提高账号安全性</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleChangePassword} className="space-y-4 max-w-md">
                    <div className="space-y-2">
                      <Label htmlFor="currentPassword">当前密码</Label>
                      <Input
                        id="currentPassword"
                        type="password"
                        placeholder="输入当前密码"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        disabled={isChangingPassword}
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="newPassword">新密码</Label>
                      <Input
                        id="newPassword"
                        type="password"
                        placeholder="至少8位，含大小写字母和数字"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        disabled={isChangingPassword}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="confirmNewPassword">确认新密码</Label>
                      <Input
                        id="confirmNewPassword"
                        type="password"
                        placeholder="再次输入新密码"
                        value={confirmNewPassword}
                        onChange={(e) => setConfirmNewPassword(e.target.value)}
                        disabled={isChangingPassword}
                      />
                    </div>

                    <Button type="submit" disabled={isChangingPassword}>
                      {isChangingPassword && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      修改密码
                    </Button>
                  </form>
                </CardContent>
              </Card>

              {/* 危险操作 */}
              <Card className="border-red-200 dark:border-red-800">
                <CardHeader>
                  <CardTitle className="text-red-600 flex items-center gap-2">
                    <Trash2 className="w-5 h-5" />
                    危险区域
                  </CardTitle>
                  <CardDescription>以下操作不可逆，请谨慎操作</CardDescription>
                </CardHeader>
                <CardContent>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive">
                        <Trash2 className="w-4 h-4 mr-2" />
                        删除账号
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>确定要删除账号吗？</AlertDialogTitle>
                        <AlertDialogDescription>
                          此操作将永久删除您的账号和所有相关数据，且无法恢复。
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDeleteAccount} className="bg-red-600 hover:bg-red-700">
                          确认删除
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* 管理员面板 */}
          {isAdmin && (
            <TabsContent value="admin">
              <div className="space-y-6">
                {/* 注册开关 */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Settings className="w-5 h-5" />
                      系统设置
                    </CardTitle>
                    <CardDescription>管理系统级别的配置选项</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <p className="font-medium">用户注册</p>
                        <p className="text-sm text-gray-500">
                          {registrationEnabled ? '当前允许新用户注册' : '当前禁止新用户注册'}
                        </p>
                      </div>
                      
                      <Button
                        variant="outline"
                        size="lg"
                        onClick={handleToggleRegistration}
                        disabled={isUpdatingRegistration}
                        className={
                          registrationEnabled
                            ? 'border-green-500 text-green-600 hover:bg-green-50'
                            : 'border-gray-300 text-gray-500'
                        }
                      >
                        {isUpdatingRegistration ? (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        ) : registrationEnabled ? (
                          <>
                            <ToggleRight className="w-5 h-5 mr-2" />
                            已开启
                          </>
                        ) : (
                          <>
                            <ToggleLeft className="w-5 h-5 mr-2" />
                            已关闭
                          </>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* 邀请码管理 */}
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2">
                          <Plus className="w-5 h-5" />
                          邀请码管理
                        </CardTitle>
                        <CardDescription>生成和管理用户注册邀请码</CardDescription>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min="1"
                          max="100"
                          value={newCodeMaxUses}
                          onChange={(e) => setNewCodeMaxUses(Number(e.target.value))}
                          className="w-20"
                          placeholder="次数"
                        />
                        <Input
                          type="number"
                          min="0"
                          max="365"
                          value={newCodeExpiresInDays ?? ''}
                          onChange={(e) => setNewCodeExpiresInDays(e.target.value ? Number(e.target.value) : undefined)}
                          className="w-24"
                          placeholder="有效期(天)"
                        />
                        
                        <Button onClick={handleCreateInviteCode} disabled={isCreatingCode}>
                          {isCreatingCode ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Plus className="w-4 h-4" />
                          )}
                          生成
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {isLoadingCodes ? (
                      <div className="flex justify-center py-8">
                        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                      </div>
                    ) : inviteCodes.length === 0 ? (
                      <div className="text-center py-8 text-gray-500">
                        暂无邀请码，点击上方按钮生成
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {inviteCodes.map((code) => (
                          <div
                            key={code.id}
                            className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg"
                          >
                            <div className="flex-1 space-y-1">
                              <div className="flex items-center gap-2">
                                <code className="font-mono font-semibold text-purple-600 bg-purple-50 px-2 py-1 rounded">
                                  {code.code}
                                </code>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => copyToClipboard(code.code)}
                                >
                                  <Copy className="w-3 h-3" />
                                </Button>
                                <Badge variant={code.status === 'active' ? 'default' : 'secondary'}>
                                  {code.status === 'active' ? (
                                    <><CheckCircle className="w-3 h-3 mr-1" />可用</>
                                  ) : code.status === 'used' ? (
                                    <><XCircle className="w-3 h-3 mr-1" />已用完</>
                                  ) : code.status === 'expired' ? (
                                    <><XCircle className="w-3 h-3 mr-1" />已过期</>
                                  ) : (
                                    <><XCircle className="w-3 h-3 mr-1" />已禁用</>
                                  )}
                                </Badge>
                              </div>
                              
                              <div className="text-sm text-gray-500 flex gap-4">
                                <span>使用次数: {code.used_count}/{code.max_uses}</span>
                                {code.expires_at && (
                                  <span>
                                    过期时间: {new Date(code.expires_at * 1000).toLocaleDateString('zh-CN')}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-2 ml-4">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleToggleInviteCode(code.id, code.status)}
                                disabled={code.status === 'used' || code.status === 'expired'}
                              >
                                {code.status === 'active' ? '禁用' : '启用'}
                              </Button>
                              
                              {(code.used_count === 0) && (
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => handleDeleteInviteCode(code.id)}
                                >
                                  删除
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          )}
        </Tabs>
      </div>
    </MainLayout>
  )
}
