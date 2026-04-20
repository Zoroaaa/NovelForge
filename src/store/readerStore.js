import { create } from 'zustand';
import { persist } from 'zustand/middleware';
export const useReaderStore = create()(persist((set) => ({
    fontSize: 18,
    theme: 'light',
    fontFamily: 'serif',
    lineHeight: 1.9,
    setFontSize: (n) => set({ fontSize: n }),
    setTheme: (t) => set({ theme: t }),
    setFontFamily: (f) => set({ fontFamily: f }),
}), { name: 'reader-settings' }));
