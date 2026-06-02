/**
 * Category 顯示用對照表 — 模板化後改成「動態 code + fallback 配色」。
 *
 * 模板化前:寫死 8 類(coding/documenting/...)
 * 模板化後:category 是模板裡定義的任意 code(BOM_MAINT 等);
 *           UI 沒有預載字典時用 hash 配色,有字典時讀模板 items.color。
 *
 * 舊資料(coding/documenting/...)沿用舊配色,保持歷史紀錄不變色。
 */
import type {WorkCategory} from './types'

/** 舊 8 類的固定配色 + label key,留作歷史資料相容 */
const LEGACY_LABEL_KEY: Record<string, string> = {
  coding: 'workCollect.categoryCoding',
  documenting: 'workCollect.categoryDocumenting',
  browsing: 'workCollect.categoryBrowsing',
  communicating: 'workCollect.categoryCommunicating',
  meeting: 'workCollect.categoryMeeting',
  designing: 'workCollect.categoryDesigning',
  idle: 'workCollect.categoryIdle',
  other: 'workCollect.categoryOther',
}

const LEGACY_COLOR: Record<string, string> = {
  coding: '#67C23A',
  documenting: '#409EFF',
  browsing: '#909399',
  communicating: '#E6A23C',
  meeting: '#F56C6C',
  designing: '#A78BFA',
  idle: '#C0C4CC',
  other: '#B1B3B8',
}

/** 新 code 的配色池 — 沒模板字典時用 hash 落到固定色,跨重啟穩定 */
const PALETTE = [
  '#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de',
  '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#67C23A',
]

function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** 取顯示色:OTHER 灰 → legacy 對表 → palette hash fallback */
export function getCategoryColor(code: WorkCategory): string {
  if (!code) return '#B1B3B8'
  if (code === 'OTHER') return '#B1B3B8'
  if (LEGACY_COLOR[code]) return LEGACY_COLOR[code]
  return PALETTE[hashCode(code) % PALETTE.length]
}

/** 取顯示 label:legacy 走 i18n key,新 code 沒字典就 raw code 自己 */
export function getCategoryLabel(code: WorkCategory, fallback?: string): string {
  if (!code) return fallback ?? '未分類'
  return fallback ?? code
}

// ── 向後相容:舊變數名繼續可用,但內容退化為 fallback 行為 ─────────────

/** @deprecated 模板化後 category 是動態 code,固定字典不再準確;新代碼用 getCategoryLabel/getCategoryColor */
export const CATEGORY_LABEL_KEY: Record<string, string> = LEGACY_LABEL_KEY

/** @deprecated 模板化後用 getCategoryColor */
export const CATEGORY_COLOR: Record<string, string> = LEGACY_COLOR

export const CATEGORY_TAG_TYPE: Record<string, 'success' | 'info' | 'warning' | 'danger' | 'primary'> = {
  coding: 'success',
  documenting: 'primary',
  browsing: 'info',
  communicating: 'warning',
  meeting: 'danger',
  designing: 'primary',
  idle: 'info',
  other: 'info',
  OTHER: 'info',
}

/** @deprecated 模板化後堆疊順序由模板 items.sortOrder 決定 */
export const CATEGORY_ORDER: string[] = [
  'coding', 'documenting', 'meeting', 'communicating',
  'designing', 'browsing', 'idle', 'other',
]
