/**
 * @file authStore.ts
 * @description 用户认证状态管理，使用Zustand管理用户登录状态和Token
 * @version 1.0.0
 */
import { create } from 'zustand'
import { api, getToken, setToken, removeToken } from '@/lib/api'
import type { UserInfo } from '@/lib/api'

interface AuthState {
  user: UserInfo | null
  isAuthenticated: boolean
  isLoading: boolean
  
  login: (username: string, password: string) => Promise<void>
  register: (username: string, email: string, password: string, inviteCode?: string) => Promise<void>
  logout: () => void
  fetchUser: () => Promise<void>
  checkAuth: () => Promise<boolean>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: !!getToken(),
  isLoading: false,

  login: async (username: string, password: string) => {
    set({ isLoading: true })
    try {
      const response = await api.auth.login({ username, password })
      const { token, user } = response.data
      
      setToken(token)
      set({
        user,
        isAuthenticated: true,
        isLoading: false
      })
    } catch (error) {
      set({ isLoading: false })
      throw error
    }
  },

  register: async (username: string, email: string, password: string, inviteCode?: string) => {
    set({ isLoading: true })
    try {
      const response = await api.auth.register({ username, email, password, inviteCode })
      const { token, user } = response.data
      
      setToken(token)
      set({
        user,
        isAuthenticated: true,
        isLoading: false
      })
    } catch (error) {
      set({ isLoading: false })
      throw error
    }
  },

  logout: () => {
    removeToken()
    set({
      user: null,
      isAuthenticated: false
    })
    window.location.href = '/login'
  },

  fetchUser: async () => {
    try {
      const response = await api.auth.getMe()
      const user = response.data
      set({ user, isAuthenticated: true })
    } catch (error) {
      removeToken()
      set({ user: null, isAuthenticated: false })
      throw error
    }
  },

  checkAuth: async () => {
    const token = getToken()
    if (!token) {
      set({ user: null, isAuthenticated: false })
      return false
    }

    await get().fetchUser()
    return get().isAuthenticated
  }
}))
