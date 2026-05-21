<script setup lang="ts">
/**
 * 類別佔比圓環圖(donut)— 純 SVG 自繪。
 *
 *  - 每個 category 一段 arc,角度 = 該類別佔比 × 360°
 *  - 中央顯示總筆數
 *  - 下方圖例:dot + 中文標籤 + 百分比
 *
 * 為什麼 path 用 arc command 而非 circle + stroke-dasharray:
 *   arc 對「不滿一圈 / 多段拼接」更直觀,後續若加 hover 高亮也好做。
 */
import {computed} from 'vue'
import {CATEGORY_COLOR, CATEGORY_LABEL, CATEGORY_ORDER} from '../category-colors'
import type {WorkCategory, WorkRecord} from '../types'

const props = defineProps<{
  records: WorkRecord[]
}>()

/** 各 category 計數 */
const counts = computed(() => {
  const c: Record<WorkCategory, number> = {
    coding: 0, documenting: 0, browsing: 0, communicating: 0,
    meeting: 0, designing: 0, idle: 0, other: 0,
  }
  for (const r of props.records) c[r.category]++
  return c
})

/** 排好的非零分段列表(按 CATEGORY_ORDER 順序) */
const segments = computed(() => {
  const total = props.records.length
  if (total === 0) return []
  let cumAngle = -Math.PI / 2 // 從 12 點鐘方向開始
  const result: Array<{
    cat: WorkCategory
    count: number
    ratio: number
    pathD: string
  }> = []
  for (const cat of CATEGORY_ORDER) {
    const count = counts.value[cat]
    if (count === 0) continue
    const ratio = count / total
    const angle = ratio * Math.PI * 2
    const pathD = arcPath(CX, CY, R_OUTER, R_INNER, cumAngle, cumAngle + angle)
    result.push({cat, count, ratio, pathD})
    cumAngle += angle
  }
  return result
})

// ── SVG 尺寸 ─────────────────────────────────────────────
const VB = 160         // viewBox 邊長
const CX = VB / 2
const CY = VB / 2
const R_OUTER = 70
const R_INNER = 45

/**
 * 產出 donut 一段的 SVG path d 屬性。
 * 由外圓 arc + 一條 line → 內圓 arc(反向)+ 一條 line 閉合。
 */
function arcPath(cx: number, cy: number, rOuter: number, rInner: number, a0: number, a1: number): string {
  const x0o = cx + rOuter * Math.cos(a0)
  const y0o = cy + rOuter * Math.sin(a0)
  const x1o = cx + rOuter * Math.cos(a1)
  const y1o = cy + rOuter * Math.sin(a1)
  const x0i = cx + rInner * Math.cos(a0)
  const y0i = cy + rInner * Math.sin(a0)
  const x1i = cx + rInner * Math.cos(a1)
  const y1i = cy + rInner * Math.sin(a1)
  const largeArc = a1 - a0 > Math.PI ? 1 : 0
  return [
    `M ${x0o} ${y0o}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x1o} ${y1o}`,
    `L ${x1i} ${y1i}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${x0i} ${y0i}`,
    'Z',
  ].join(' ')
}
</script>

<template>
  <div class="donut-card">
    <div class="donut-card__title">類別佔比</div>

    <div class="donut-card__body">
      <!-- Donut SVG -->
      <svg :viewBox="`0 0 ${VB} ${VB}`" class="donut-svg">
        <!-- 沒資料:畫底色圓環 -->
        <circle
          v-if="segments.length === 0"
          :cx="CX"
          :cy="CY"
          :r="(R_OUTER + R_INNER) / 2"
          fill="none"
          :stroke="'var(--el-fill-color-light)'"
          :stroke-width="R_OUTER - R_INNER"
        />
        <!-- 有資料:畫各 segment -->
        <path
          v-for="seg in segments"
          :key="seg.cat"
          :d="seg.pathD"
          :fill="CATEGORY_COLOR[seg.cat]"
        />
        <!-- 中央總數 -->
        <text :x="CX" :y="CY - 4" text-anchor="middle" class="donut-total">
          {{ records.length }}
        </text>
        <text :x="CX" :y="CY + 12" text-anchor="middle" class="donut-total-label">
          總筆數
        </text>
      </svg>

      <!-- 圖例 -->
      <div class="legend">
        <div v-for="seg in segments" :key="seg.cat" class="legend-row">
          <span class="legend-dot" :style="{background: CATEGORY_COLOR[seg.cat]}"/>
          <span class="legend-label">{{ CATEGORY_LABEL[seg.cat] }}</span>
          <span class="legend-value">{{ Math.round(seg.ratio * 100) }}%</span>
        </div>
        <div v-if="segments.length === 0" class="legend-empty">尚無資料</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.donut-card {
  padding: 16px 18px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
}

.donut-card__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 12px;
}

.donut-card__body {
  display: flex;
  align-items: center;
  gap: 16px;
  flex: 1;
}

.donut-svg {
  width: 140px;
  height: 140px;
  flex-shrink: 0;
}

.donut-total {
  font-size: 22px;
  font-weight: 600;
  fill: var(--el-text-color-primary);
}

.donut-total-label {
  font-size: 9px;
  fill: var(--el-text-color-secondary);
}

.legend {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.legend-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.legend-label {
  flex: 1;
  color: var(--el-text-color-regular);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.legend-value {
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.legend-empty {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  font-style: italic;
}
</style>
