/**
 * @file system-settings.ts
 * @description 系统设置API路由：注册开关、系统配置管理
 * @version 1.0.0
 */

import { Hono } from 'hono'
import { z } from 'zod'
import type { Env } from '../lib/types'

const app = new Hono<{ Bindings: Env }>()

app.get('/', async (c) => {
  try {
    const settings = await c.env.DB.prepare(
      'SELECT key, value, description, updated_at FROM system_settings ORDER BY key'
    ).all()

    return c.json({
      success: true,
      data: settings.results
    })
  } catch (error) {
    console.error('Get system settings error:', error)
    return c.json({
      error: 'Internal Server Error',
      code: 'GET_SETTINGS_FAILED',
      message: '获取系统设置失败'
    }, 500)
  }
})

app.get('/registration', async (c) => {
  try {
    const setting = await c.env.DB.prepare(
      "SELECT value FROM system_settings WHERE key = 'registration_enabled'"
    ).first<{ value: string }>()

    return c.json({
      success: true,
      data: {
        registrationEnabled: setting?.value === 'true'
      }
    })
  } catch (error) {
    console.error('Get registration status error:', error)
    return c.json({
      error: 'Internal Server Error',
      code: 'GET_REGISTRATION_STATUS_FAILED',
      message: '获取注册状态失败'
    }, 500)
  }
})

app.put('/registration', async (c) => {
  try {
    const body = await c.req.json()
    const { enabled } = body

    if (typeof enabled !== 'boolean') {
      return c.json({
        error: 'Validation Error',
        code: 'INVALID_VALUE',
        message: 'enabled 必须是布尔值'
      }, 400)
    }

    await c.env.DB.prepare(
      "UPDATE system_settings SET value = ?, updated_at = unixepoch() WHERE key = 'registration_enabled'"
    ).bind(enabled ? 'true' : 'false').run()

    return c.json({
      success: true,
      data: {
        registrationEnabled: enabled
      },
      message: `注册功能已${enabled ? '开启' : '关闭'}`
    })
  } catch (error) {
    console.error('Update registration status error:', error)
    return c.json({
      error: 'Internal Server Error',
      code: 'UPDATE_REGISTRATION_FAILED',
      message: '更新注册状态失败'
    }, 500)
  }
})

export default app
