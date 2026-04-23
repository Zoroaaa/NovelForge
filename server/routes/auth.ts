/**
 * @file auth.ts
 * @description 用户认证API路由：登录、注册、修改密码、删除账号
 * @version 1.0.0
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import type { AppType } from '../lib/types'
import {
  hashPassword,
  verifyPassword,
  generateToken,
  getJwtSecret
} from '../lib/auth'

const app = new Hono<AppType>()

const loginSchema = z.object({
  username: z.string().min(1, '用户名不能为空'),
  password: z.string().min(1, '密码不能为空')
})

const registerSchema = z.object({
  username: z.string()
    .min(3, '用户名至少3个字符')
    .max(20, '用户名最多20个字符')
    .regex(/^[a-zA-Z0-9_]+$/, '用户名只能包含字母、数字和下划线'),
  email: z.string().email('请输入有效的邮箱地址'),
  password: z.string()
    .min(8, '密码至少8个字符')
    .max(64, '密码最多64个字符')
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, '密码必须包含大小写字母和数字'),
  inviteCode: z.string().min(1, '邀请码不能为空'),
})

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, '当前密码不能为空'),
  newPassword: z.string()
    .min(8, '新密码至少8个字符')
    .max(64, '新密码最多64个字符')
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, '新密码必须包含大小写字母和数字')
})

app.post('/login', zValidator('json', loginSchema), async (c) => {
  const { username, password } = c.req.valid('json')

  try {
    const user = await c.env.DB.prepare(
      `SELECT id, username, email, password_hash, role, status 
       FROM users 
       WHERE (username = ? OR email = ?) AND deleted_at IS NULL`
    ).bind(username, username).first<{
      id: string
      username: string
      email: string
      password_hash: string
      role: string
      status: string
    }>()

    if (!user) {
      return c.json({
        error: 'Unauthorized',
        code: 'INVALID_CREDENTIALS',
        message: '用户名或密码错误'
      }, 401)
    }

    if (user.status !== 'active') {
      return c.json({
        error: 'Forbidden',
        code: 'ACCOUNT_DISABLED',
        message: '账号已被禁用，请联系管理员'
      }, 403)
    }

    const isValidPassword = await verifyPassword(password, user.password_hash)
    if (!isValidPassword) {
      return c.json({
        error: 'Unauthorized',
        code: 'INVALID_CREDENTIALS',
        message: '用户名或密码错误'
      }, 401)
    }

    await c.env.DB.prepare(
      'UPDATE users SET last_login_at = unixepoch(), updated_at = unixepoch() WHERE id = ?'
    ).bind(user.id).run()

    const secret = await getJwtSecret(c.env)
    const token = await generateToken({
      userId: user.id,
      username: user.username,
      role: user.role
    }, secret)

    return c.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role
        }
      }
    })
  } catch (error) {
    console.error('Login error:', error)
    return c.json({
      error: 'Internal Server Error',
      code: 'LOGIN_FAILED',
      message: '登录失败，请稍后重试'
    }, 500)
  }
})

app.post('/register', zValidator('json', registerSchema), async (c) => {
  const { username, email, password, inviteCode } = c.req.valid('json')

  try {
    const registrationSetting = await c.env.DB.prepare(
      'SELECT value FROM system_settings WHERE key = ?'
    ).bind('registration_enabled').first<{ value: string }>()

    if (!registrationSetting || registrationSetting.value !== 'true') {
      return c.json({
        error: 'Forbidden',
        code: 'REGISTRATION_DISABLED',
        message: '注册功能已关闭'
      }, 403)
    }

    const existingUser = await c.env.DB.prepare(
      'SELECT id FROM users WHERE (username = ? OR email = ?) AND deleted_at IS NULL'
    ).bind(username, email).first()

    if (existingUser) {
      return c.json({
        error: 'Conflict',
        code: 'USER_EXISTS',
        message: '用户名或邮箱已被使用'
      }, 409)
    }

    let inviteCodeId: string | null = null

    if (inviteCode) {
      const validCode = await c.env.DB.prepare(
        `SELECT id, max_uses, used_count, expires_at, status 
         FROM invite_codes 
         WHERE code = ? AND status = 'active'`
      ).bind(inviteCode).first<{
        id: string
        max_uses: number
        used_count: number
        expires_at: number | null
        status: string
      }>()

      if (!validCode) {
        return c.json({
          error: 'Bad Request',
          code: 'INVALID_INVITE_CODE',
          message: '无效的邀请码'
        }, 400)
      }

      if (validCode.expires_at && validCode.expires_at < Math.floor(Date.now() / 1000)) {
        await c.env.DB.prepare(
          "UPDATE invite_codes SET status = 'expired', updated_at = unixepoch() WHERE id = ?"
        ).bind(validCode.id).run()

        return c.json({
          error: 'Bad Request',
          code: 'EXPIRED_INVITE_CODE',
          message: '邀请码已过期'
        }, 400)
      }

      if (validCode.used_count >= validCode.max_uses) {
        await c.env.DB.prepare(
          "UPDATE invite_codes SET status = 'used', updated_at = unixepoch() WHERE id = ?"
        ).bind(validCode.id).run()

        return c.json({
          error: 'Bad Request',
          code: 'USED_UP_INVITE_CODE',
          message: '邀请码已用完'
        }, 400)
      }

      inviteCodeId = validCode.id

      await c.env.DB.prepare(
        'UPDATE invite_codes SET used_count = used_count + 1, updated_at = unixepoch() WHERE id = ?'
      ).bind(validCode.id).run()
    }

    const passwordHash = await hashPassword(password)

    const userId = Array.from(crypto.getRandomValues(new Uint8Array(8)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')

    await c.env.DB.prepare(
      `INSERT INTO users (id, username, email, password_hash, role, invite_code_id, created_at, updated_at) 
       VALUES (?, ?, ?, ?, 'user', ?, unixepoch(), unixepoch())`
    ).bind(userId, username, email, passwordHash, inviteCodeId).run()

    const secret = await getJwtSecret(c.env)
    const token = await generateToken({
      userId,
      username,
      role: 'user'
    }, secret)

    return c.json({
      success: true,
      data: {
        token,
        user: {
          id: userId,
          username,
          email,
          role: 'user'
        }
      }
    })
  } catch (error) {
    console.error('Register error:', error)
    return c.json({
      error: 'Internal Server Error',
      code: 'REGISTER_FAILED',
      message: '注册失败，请稍后重试'
    }, 500)
  }
})

app.put('/password', async (c) => {
  const user = c.get('user')
  
  try {
    const body = await c.req.json()
    const parsed = changePasswordSchema.safeParse(body)

    if (!parsed.success) {
      return c.json({
        error: 'Validation Error',
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0].message
      }, 400)
    }

    const { currentPassword, newPassword } = parsed.data

    const currentUser = await c.env.DB.prepare(
      'SELECT password_hash FROM users WHERE id = ? AND deleted_at IS NULL'
    ).bind(user.userId).first<{ password_hash: string }>()

    if (!currentUser) {
      return c.json({
        error: 'Not Found',
        code: 'USER_NOT_FOUND',
        message: '用户不存在'
      }, 404)
    }

    const isValidCurrent = await verifyPassword(currentPassword, currentUser.password_hash)
    if (!isValidCurrent) {
      return c.json({
        error: 'Unauthorized',
        code: 'WRONG_CURRENT_PASSWORD',
        message: '当前密码错误'
      }, 401)
    }

    const newHashedPassword = await hashPassword(newPassword)

    await c.env.DB.prepare(
      'UPDATE users SET password_hash = ?, updated_at = unixepoch() WHERE id = ?'
    ).bind(newHashedPassword, user.userId).run()

    return c.json({
      success: true,
      message: '密码修改成功'
    })
  } catch (error) {
    console.error('Change password error:', error)
    return c.json({
      error: 'Internal Server Error',
      code: 'PASSWORD_CHANGE_FAILED',
      message: '密码修改失败，请稍后重试'
    }, 500)
  }
})

app.delete('/account', async (c) => {
  const user = c.get('user')

  try {
    const existingUser = await c.env.DB.prepare(
      'SELECT id FROM users WHERE id = ? AND deleted_at IS NULL'
    ).bind(user.userId).first()

    if (!existingUser) {
      return c.json({
        error: 'Not Found',
        code: 'USER_NOT_FOUND',
        message: '用户不存在'
      }, 404)
    }

    await c.env.DB.prepare(
      "UPDATE users SET status = 'deleted', deleted_at = unixepoch(), updated_at = unixepoch() WHERE id = ?"
    ).bind(user.userId).run()

    return c.json({
      success: true,
      message: '账号已成功删除'
    })
  } catch (error) {
    console.error('Delete account error:', error)
    return c.json({
      error: 'Internal Server Error',
      code: 'DELETE_ACCOUNT_FAILED',
      message: '账号删除失败，请稍后重试'
    }, 500)
  }
})

app.get('/me', async (c) => {
  const user = c.get('user')

  try {
    const userInfo = await c.env.DB.prepare(
      `SELECT id, username, email, role, status, created_at, last_login_at 
       FROM users 
       WHERE id = ? AND deleted_at IS NULL`
    ).bind(user.userId).first()

    if (!userInfo) {
      return c.json({
        error: 'Not Found',
        code: 'USER_NOT_FOUND',
        message: '用户不存在'
      }, 404)
    }

    return c.json({
      success: true,
      data: userInfo
    })
  } catch (error) {
    console.error('Get user info error:', error)
    return c.json({
      error: 'Internal Server Error',
      code: 'GET_USER_FAILED',
      message: '获取用户信息失败'
    }, 500)
  }
})

export default app
