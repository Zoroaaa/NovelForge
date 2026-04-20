import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface ReaderStore {
  fontSize: number
  theme: 'light' | 'dark' | 'sepia'
  fontFamily: 'serif' | 'sans'
  lineHeight: number
  setFontSize: (n: number) => void
  setTheme: (t: ReaderStore['theme']) => void
  setFontFamily: (f: ReaderStore['fontFamily']) => void
}

export const useReaderStore = create<ReaderStore>()(
  persist(
    (set) => ({
      fontSize: 18,
      theme: 'light',
      fontFamily: 'serif',
      lineHeight: 1.9,
      setFontSize: (n) => set({ fontSize: n }),
      setTheme: (t) => set({ theme: t }),
      setFontFamily: (f) => set({ fontFamily: f }),
    }),
    { name: 'reader-settings' }
  )
)
