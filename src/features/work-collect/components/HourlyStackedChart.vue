<script setup lang="ts">
/**
 * 每小時活動分布堆疊柱狀圖(純 SVG,無第三方依賴)。
 *
 *  - X 軸:工時範圍(從 startHour 到 endHour - 1)
 *  - Y 軸:該小時的紀錄筆數;最大值由所有小時的最大值動態決定
 *  - 每柱內按 category 堆疊,色彩用 CATEGORY_COLOR
 *  - hover 顯示 tooltip(該小時各 category 筆數)
 */
import {computed, ref} from 'vue'
import {CATEGORY_COLOR, CATEGORY_LABEL, CATEGORY_ORDER} from '../category-colors'
import type {WorkCategory, WorkRecord} from '../types'

const props = defineProps<{
  records: WorkRecord[]
  startHour: number
  endHour: number
}>()

/** 把 records 分組成 hour → category → count 的二維 map */
const byHour = computed(() => {
  const map = new Map<number, Record<WorkCategory, number>>()
  for (let h = props.startHour; h < props.endHour; h++) {
    map.set(h, makeEmptyCategoryRecord())
  }
  for (const r of props.records) {
    const h = new Date(r.capturedAt).getHours()
    if (!map.has(h)) continue
    const slot = map.get(h)!
    slot[r.category] = (slot[r.category] ?? 0) + 1
  }
  return map
})

/** Y 軸最大值(取所有 hour 的總數最大值,且至少 5 避免 0 高度) */
const yMax = computed(() => {
  let max = 0
  for (const slot of byHour.value.values()) {
    const sum = Object.values(slot).reduce((a, b) => a + b, 0)
    if (sum > max) max = sum
  }
  return Math.max(5, max)
})

/** 小時陣列 */
const hours = computed(() => Array.from(byHour.value.keys()))

// ── SVG 座標常數 ─────────────────────────────────────────────
const W = 480        // viewBox 寬
const H = 200        // viewBox 高
const padL = 28      // 左邊留 Y 軸刻度
const padR = 8
const padT = 12
const padB = 24      // 下面留 X 軸標籤
const chartW = W - padL - padR
const chartH = H - padT - padB

/** 一柱的寬度(柱間留 30% 空隙) */
const barOuterW = computed(() => chartW / hours.value.length)
const barInnerW = computed(() => barOuterW.value * 0.65)

/** 取得某小時的堆疊段(返回每段 y / h / fill / count) */
function stackSegments(hour: number) {
  const slot = byHour.value.get(hour)!
  let cumulative = 0
  const segs: Array<{cat: WorkCategory; y: number; h: number; count: number}> = []
  for (const cat of CATEGORY_ORDER) {
    const count = slot[cat] ?? 0
    if (count === 0) continue
    const segH = (count / yMax.value) * chartH
    cumulative += count
    const segY = padT + chartH - (cumulative / yMax.value) * chartH
    segs.push({cat, y: segY, h: segH, count})
  }
  return segs
}

// ── tooltip 狀態 ─────────────────────────────────────────────
const hoverHour = ref<number | null>(null)
const hoverX = ref(0)
const hoverY = ref(0)

function onBarEnter(hour: number, ev: MouseEvent) {
  hoverHour.value = hour
  hoverX.value = ev.offsetX
  hoverY.value = ev.offsetY
}

function onBarLeave() {
  hoverHour.value = null
}

/** Y 軸刻度(5 等分) */
const yTicks = computed(() => {
  const step = yMax.value / 4
  return [0, 1, 2, 3, 4].map((i) => Math.round(step * i))
})

function makeEmptyCategoryRecord(): Record<WorkCategory, number> {
  return {coding: 0, documenting: 0, browsing: 0, communicating: 0, meeting: 0, designing: 0, idle: 0, other: 0}
}
</script>

<template>
  <div class="hourly-chart">
    <div class="hourly-chart__title">每小時活動分布</div>
    <svg :viewBox="`0 0 ${W} ${H}`" class="hourly-chart__svg">
      <!-- Y 軸刻度線 + 標籤 -->
      <g class="grid">
        <line
          v-for="(tick, i) in yTicks"
          :key="i"
          :x1="padL"
          :x2="W - padR"
          :y1="padT + chartH - (tick / yMax) * chartH"
          :y2="padT + chartH - (tick / yMax) * chartH"
        />
        <text
          v-for="(tick, i) in yTicks"
          :key="`t-${i}`"
          :x="padL - 6"
          :y="padT + chartH - (tick / yMax) * chartH + 3"
          text-anchor="end"
          class="axis-label"
        >{{ tick }}</text>
      </g>

      <!-- 柱狀 -->
      <g v-for="(hour, i) in hours" :key="hour">
        <!-- 透明 hit area,給 hover 用,覆蓋整柱範圍 -->
        <rect
          :x="padL + i * barOuterW"
          :y="padT"
          :width="barOuterW"
          :height="chartH"
          fill="transparent"
          @mousemove="(ev) => onBarEnter(hour, ev)"
          @mouseleave="onBarLeave"
        />
        <!-- 堆疊段 -->
        <rect
          v-for="seg in stackSegments(hour)"
          :key="seg.cat"
          :x="padL + i * barOuterW + (barOuterW - barInnerW) / 2"
          :y="seg.y"
          :width="barInnerW"
          :height="seg.h"
          :fill="CATEGORY_COLOR[seg.cat]"
          rx="2"
        />
        <!-- X 軸 hour 標籤 -->
        <text
          :x="padL + i * barOuterW + barOuterW / 2"
          :y="H - 6"
          text-anchor="middle"
          class="axis-label"
        >{{ hour }}</text>
      </g>
    </svg>

    <!-- Tooltip(absolute 定位,跟著鼠標) -->
    <div
      v-if="hoverHour !== null"
      class="hourly-chart__tooltip"
      :style="{left: hoverX + 'px', top: hoverY + 'px'}"
    >
      <div class="tooltip-title">{{ hoverHour }}:00 - {{ hoverHour + 1 }}:00</div>
      <div
        v-for="seg in stackSegments(hoverHour)"
        :key="seg.cat"
        class="tooltip-row"
      >
        <span class="dot" :style="{background: CATEGORY_COLOR[seg.cat]}"/>
        <span class="cat-name">{{ CATEGORY_LABEL[seg.cat] }}</span>
        <span class="cat-count">{{ seg.count }}</span>
      </div>
      <div v-if="stackSegments(hoverHour).length === 0" class="tooltip-empty">無紀錄</div>
    </div>
  </div>
</template>

<style scoped>
.hourly-chart {
  position: relative;
  padding: 16px 18px 8px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
}

.hourly-chart__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 10px;
}

.hourly-chart__svg {
  width: 100%;
  height: auto;
  display: block;
}

.grid line {
  stroke: var(--el-border-color-lighter);
  stroke-dasharray: 2 3;
}

.axis-label {
  font-size: 10px;
  fill: var(--el-text-color-secondary);
}

.hourly-chart__tooltip {
  position: absolute;
  pointer-events: none;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  transform: translate(12px, -50%);
  min-width: 140px;
  z-index: 10;
}

.tooltip-title {
  font-weight: 600;
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--el-text-color-primary);
}

.tooltip-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 3px 0;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.cat-name {
  flex: 1;
  color: var(--el-text-color-regular);
}

.cat-count {
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.tooltip-empty {
  color: var(--el-text-color-secondary);
  font-style: italic;
}
</style>
