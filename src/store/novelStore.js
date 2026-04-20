import { create } from 'zustand';
export const useNovelStore = create((set) => ({
    activeNovelId: null,
    activeChapterId: null,
    sidebarTab: 'outline',
    setActiveNovel: (id) => set({ activeNovelId: id }),
    setActiveChapter: (id) => set({ activeChapterId: id }),
    setSidebarTab: (tab) => set({ sidebarTab: tab }),
}));
