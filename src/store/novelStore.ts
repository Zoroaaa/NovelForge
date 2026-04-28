/**
 * @file novelStore.ts
 * @description 小说状态管理Store，使用Zustand管理当前活动小说、章节和侧边栏状态
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { create } from 'zustand'

/**
 * 小说状态管理接口
 */
interface NovelStore {
  /** 当前活动小说ID */
  activeNovelId: string | null
  /** 当前活动章节ID */
  activeChapterId: string | null
  /** 侧边栏当前标签页 */
  sidebarTab: 'outline' | 'chapters' | 'characters' | 'settings' | 'rules' | 'volumes' | 'foreshadowing' | 'power-level' | 'entity-tree' | 'graph' | 'trash'
  /** 设置当前活动小说 */
  setActiveNovel: (id: string) => void
  /** 设置当前活动章节 */
  setActiveChapter: (id: string | null) => void
  /** 设置侧边栏标签页 */
  setSidebarTab: (tab: NovelStore['sidebarTab']) => void
}

/**
 * 小说状态管理Store
 * @description 使用Zustand管理全局小说状态
 */
export const useNovelStore = create<NovelStore>((set) => ({
  activeNovelId: null,
  activeChapterId: null,
  sidebarTab: 'chapters',
  setActiveNovel: (id) => set({ activeNovelId: id }),
  setActiveChapter: (id) => set({ activeChapterId: id }),
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
}))
