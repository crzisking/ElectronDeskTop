/**
 * Category 顯示用對照表 — 顏色 + 中文標籤 + Element Plus tag type。
 *
 * 集中在這支讓所有圖表元件 + tag 共用同一份視覺映射,
 * 改色就改這一處,不會四散在多個 vue 檔內。
 */
import type {WorkCategory} from './types'

/** 中文標籤(UI 顯示用) */
export const CATEGORY_LABEL: Record<WorkCategory, string> = {
  coding: '編碼',
  documenting: '文件',
  browsing: '瀏覽',
  communicating: '溝通',
  meeting: '會議',
  designing: '設計',
  idle: '閒置',
  other: '其他',
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
