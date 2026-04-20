import { create } from 'zustand'

interface NovelStore {
  activeNovelId: string | null
  activeChapterId: string | null
  sidebarTab: 'outline' | 'chapters' | 'characters'
  setActiveNovel: (id: string) => void
  setActiveChapter: (id: string | null) => void
  setSidebarTab: (tab: NovelStore['sidebarTab']) => void
}

export const useNovelStore = create<NovelStore>((set) => ({
  activeNovelId: null,
  activeChapterId: null,
  sidebarTab: 'outline',
  setActiveNovel: (id) => set({ activeNovelId: id }),
  setActiveChapter: (id) => set({ activeChapterId: id }),
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
}))
