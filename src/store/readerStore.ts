/**
 * @file readerStore.ts
 * @description 阅读器状态管理Store，管理阅读器的字号、主题、字体、内容宽度、字间距等设置
 * @version 2.0.0
 * @modified 2026-04-28 - 添加内容宽度与字间距设置
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface ReaderStore {
  fontSize: number
  theme: 'light' | 'dark' | 'sepia'
  fontFamily: 'serif' | 'sans'
  lineHeight: number
  contentWidth: 'narrow' | 'medium' | 'wide'
  letterSpacing: number
  setFontSize: (n: number) => void
  setTheme: (t: ReaderStore['theme']) => void
  setFontFamily: (f: ReaderStore['fontFamily']) => void
  setContentWidth: (w: ReaderStore['contentWidth']) => void
  setLetterSpacing: (n: number) => void
}

export const useReaderStore = create<ReaderStore>()(
  persist(
    (set) => ({
      fontSize: 18,
      theme: 'light',
      fontFamily: 'serif',
      lineHeight: 1.9,
      contentWidth: 'medium',
      letterSpacing: 0.05,
      setFontSize: (n) => set({ fontSize: n }),
      setTheme: (t) => set({ theme: t }),
      setFontFamily: (f) => set({ fontFamily: f }),
      setContentWidth: (w) => set({ contentWidth: w }),
      setLetterSpacing: (n) => set({ letterSpacing: n }),
    }),
    { name: 'reader-settings' }
  )
)
