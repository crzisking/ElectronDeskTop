/**
 * Category 顯示用對照表 — 顏色 + 中文標籤 + Element Plus tag type。
 *
 * 集中在這支讓所有圖表元件 + tag 共用同一份視覺映射,
 * 改色就改這一處,不會四散在多個 vue 檔內。
 */
import type {WorkCategory} from './types'

/**
 * Category → i18n key 對應。
 * 使用端走 `t(CATEGORY_LABEL_KEY[category])` 拿到當前語言顯示文字。
 *
 * 為什麼不存「翻譯後字串」:i18n 切換語言時,const 內字串不會更新;
 * 改存 key 讓使用端動態解析,跟著語言切換即時 reactive。
 */
export const CATEGORY_LABEL_KEY: Record<WorkCategory, string> = {
  coding: 'workCollect.categoryCoding',
  documenting: 'workCollect.categoryDocumenting',
  browsing: 'workCollect.categoryBrowsing',
  communicating: 'workCollect.categoryCommunicating',
  meeting: 'workCollect.categoryMeeting',
  designing: 'workCollect.categoryDesigning',
  idle: 'workCollect.categoryIdle',
  other: 'workCollect.categoryOther',
}

/** 圖表用 hex 色 — 跟下面 tag type 對齊 Element Plus 標準色 */
export const CATEGORY_COLOR: Record<WorkCategory, string> = {
  coding: '#67C23A',        // success / green
  documenting: '#409EFF',   // primary / blue
  browsing: '#909399',      // info / grey
  communicating: '#E6A23C', // warning / orange
  meeting: '#F56C6C',       // danger / red
  designing: '#A78BFA',     // 自定紫(設計類用)
  idle: '#C0C4CC',          // 淺灰
  other: '#B1B3B8',         // 更淺灰
}

/** Element Plus el-tag 的 type prop */
export const CATEGORY_TAG_TYPE: Record<WorkCategory, 'success' | 'info' | 'warning' | 'danger' | 'primary'> = {
  coding: 'success',
  documenting: 'primary',
  browsing: 'info',
  communicating: 'warning',
  meeting: 'danger',
  designing: 'primary',
  idle: 'info',
  other: 'info',
}

/** 所有 category 的固定排序(圖表堆疊順序 / 圖例順序) */
export const CATEGORY_ORDER: WorkCategory[] = [
  'coding',
  'documenting',
  'meeting',
  'communicating',
  'designing',
  'browsing',
  'idle',
  'other',
]
