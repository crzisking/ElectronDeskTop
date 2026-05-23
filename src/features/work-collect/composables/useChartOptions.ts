/**
 * 工作採集圖表 ECharts option 構建函式
 *
 * 將 WorkRecord 陣列轉換為各類 ECharts 圖表的 declarative option 物件。
 * 每個函式接收 records + 必要參數，回傳 ECharts 的 option 配置。
 */
import { computed, type Ref } from 'vue'
import { CATEGORY_COLOR, CATEGORY_LABEL, CATEGORY_ORDER } from '../category-colors'
import type { WorkCategory, WorkRecord } from '../types'

type CategoryCounts = Record<WorkCategory, number>

function emptyCategoryCounts(): CategoryCounts {
  return { coding: 0, documenting: 0, browsing: 0, communicating: 0, meeting: 0, designing: 0, idle: 0, other: 0 }
}

/** records → category → count */
function countByCategory(records: WorkRecord[]): CategoryCounts {
  const counts = emptyCategoryCounts()
  for (const r of records) counts[r.category]++
  return counts
}

/** 获取今天 00:00:00 的时间戳 */
function startOfToday(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 获取过去一周第一天 00:00:00 的时间戳 */
function startOfWeek(): number {
  const d = new Date()
  d.setDate(d.getDate() - 6)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 筛选今天的记录 */
export function filterTodayRecords(records: WorkRecord[]): WorkRecord[] {
  const start = startOfToday()
  return records.filter(r => r.capturedAt >= start)
}

/** 筛选过去一周的记录 */
export function filterWeekRecords(records: WorkRecord[]): WorkRecord[] {
  const start = startOfWeek()
  return records.filter(r => r.capturedAt >= start)
}

/** 按天分组记录 */
function groupRecordsByDay(records: WorkRecord[]): Map<string, WorkRecord[]> {
  const groups = new Map<string, WorkRecord[]>()
  for (const r of records) {
    const d = new Date(r.capturedAt)
    const key = `${d.getMonth() + 1}/${d.getDate()}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(r)
  }
  return groups
}

/** 按天统计总数 */
function countByDay(records: WorkRecord[]): Map<string, number> {
  const groups = groupRecordsByDay(records)
  const result = new Map<string, number>()
  for (const [day, recs] of groups) {
    result.set(day, recs.length)
  }
  return result
}

/** 周检视：每日总采集柱状图 option */
export function useWeekDailyBarOption(records: Ref<WorkRecord[]>) {
  return computed(() => {
    const dayCounts = countByDay(records.value)
    const now = new Date()
    const days: string[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      days.push(`${d.getMonth() + 1}/${d.getDate()}`)
    }
    const data = days.map(day => dayCounts.get(day) || 0)

    return {
      tooltip: {
        trigger: 'axis' as const,
        axisPointer: { type: 'shadow' as const },
      },
      grid: { top: 24, bottom: 24, left: 40, right: 12 },
      xAxis: {
        type: 'category' as const,
        data: days,
        axisLabel: { fontSize: 10 },
      },
      yAxis: {
        type: 'value' as const,
        minInterval: 1,
        axisLabel: { fontSize: 10 },
      },
      series: [{
        name: '採集筆數',
        type: 'bar' as const,
        data,
        itemStyle: {
          color: '#409EFF',
          borderRadius: [4, 4, 0, 0],
        },
        label: { show: true, position: 'top' as const, fontSize: 10 },
      }],
    }
  })
}

/** 周检视：每日类别分布堆叠柱状图 option */
export function useWeekDailyStackedOption(records: Ref<WorkRecord[]>) {
  return computed(() => {
    const now = new Date()
    const days: string[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      days.push(`${d.getMonth() + 1}/${d.getDate()}`)
    }

    const matrix: Record<WorkCategory, number[]> = {} as any
    for (const cat of CATEGORY_ORDER) matrix[cat] = new Array(days.length).fill(0)

    for (const r of records.value) {
      const d = new Date(r.capturedAt)
      const dayKey = `${d.getMonth() + 1}/${d.getDate()}`
      const idx = days.indexOf(dayKey)
      if (idx >= 0) matrix[r.category][idx]++
    }

    return {
      tooltip: {
        trigger: 'axis' as const,
        axisPointer: { type: 'shadow' as const },
      },
      legend: {
        data: CATEGORY_ORDER.map(c => CATEGORY_LABEL[c]),
        top: 0,
        textStyle: { fontSize: 11 },
      },
      grid: { top: 32, bottom: 24, left: 40, right: 12 },
      xAxis: {
        type: 'category' as const,
        data: days,
        axisLabel: { fontSize: 10 },
      },
      yAxis: {
        type: 'value' as const,
        minInterval: 1,
        axisLabel: { fontSize: 10 },
      },
      series: CATEGORY_ORDER.map(cat => ({
        name: CATEGORY_LABEL[cat],
        type: 'bar' as const,
        stack: 'total',
        data: matrix[cat],
        color: CATEGORY_COLOR[cat],
        emphasis: { focus: 'series' as const },
        itemStyle: { borderRadius: [2, 2, 0, 0] },
      })),
    }
  })
}

/** 每小時堆疊柱狀 option */
export function useHourlyStackedOption(
  records: Ref<WorkRecord[]>,
  startHour: number,
  endHour: number,
) {
  return computed(() => {
    const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i)
    const matrix: Record<WorkCategory, number[]> = {} as any
    for (const cat of CATEGORY_ORDER) matrix[cat] = new Array(hours.length).fill(0)

    for (const r of records.value) {
      const h = new Date(r.capturedAt).getHours()
      const idx = hours.indexOf(h)
      if (idx >= 0) matrix[r.category][idx]++
    }

    return {
      tooltip: {
        trigger: 'axis' as const,
        axisPointer: { type: 'shadow' as const },
        formatter: (params: any[]) => {
          const hour = params[0].axisValue
          let html = `<strong>${hour}:00 - ${parseInt(hour) + 1}:00</strong><br/>`
          for (const p of params) {
            if (p.value > 0) {
              html += `${p.marker} ${p.seriesName}: ${p.value} 筆<br/>`
            }
          }
          return html
        },
      },
      legend: {
        data: CATEGORY_ORDER.map(c => CATEGORY_LABEL[c]),
        top: 0,
        textStyle: { fontSize: 11 },
      },
      grid: { top: 32, bottom: 24, left: 40, right: 12 },
      xAxis: {
        type: 'category' as const,
        data: hours.map(h => `${h}:00`),
        axisLabel: { fontSize: 10 },
      },
      yAxis: {
        type: 'value' as const,
        minInterval: 1,
        axisLabel: { fontSize: 10 },
      },
      series: CATEGORY_ORDER.map(cat => ({
        name: CATEGORY_LABEL[cat],
        type: 'bar' as const,
        stack: 'total',
        data: matrix[cat],
        color: CATEGORY_COLOR[cat],
        emphasis: { focus: 'series' as const },
        itemStyle: { borderRadius: [2, 2, 0, 0] },
      })),
    }
  })
}

/** 類別佔比 Donut option */
export function useDonutOption(records: Ref<WorkRecord[]>) {
  return computed(() => {
    const counts = countByCategory(records.value)
    const data = CATEGORY_ORDER
      .filter(cat => counts[cat] > 0)
      .map(cat => ({
        name: CATEGORY_LABEL[cat],
        value: counts[cat],
        itemStyle: { color: CATEGORY_COLOR[cat] },
      }))

    return {
      tooltip: {
        trigger: 'item' as const,
        formatter: '{b}: {c} 筆 ({d}%)',
      },
      legend: {
        orient: 'vertical' as const,
        right: 0,
        top: 'center',
        textStyle: { fontSize: 11 },
      },
      series: [{
        type: 'pie' as const,
        radius: ['45%', '70%'],
        center: ['38%', '50%'],
        avoidLabelOverlap: false,
        itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
        label: { show: false },
        emphasis: {
          label: { show: true, fontSize: 16, fontWeight: 'bold' as const },
          scaleSize: 8,
        },
        data,
      }],
      graphic: [{
        type: 'text' as const,
        left: '30%',
        top: 'center',
        style: {
          text: `${records.value.length}\n總筆數`,
          textAlign: 'center' as const,
          fill: '#303133',
          fontSize: 14,
          lineHeight: 20,
        },
      }],
    }
  })
}

/** 每日趨勢堆疊面積 option */
export function useDailyTrendOption(records: Ref<WorkRecord[]>, days: number = 7) {
  return computed(() => {
    const dateMap = new Map<string, CategoryCounts>()
    const now = new Date()
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      const key = `${d.getMonth() + 1}/${d.getDate()}`
      dateMap.set(key, emptyCategoryCounts())
    }

    for (const r of records.value) {
      const d = new Date(r.capturedAt)
      const key = `${d.getMonth() + 1}/${d.getDate()}`
      if (dateMap.has(key)) dateMap.get(key)![r.category]++
    }

    const dates = [...dateMap.keys()]

    return {
      tooltip: { trigger: 'axis' as const },
      legend: {
        data: CATEGORY_ORDER.map(c => CATEGORY_LABEL[c]),
        bottom: 0,
        textStyle: { fontSize: 10 },
      },
      grid: { top: 12, bottom: 36, left: 40, right: 12 },
      xAxis: {
        type: 'category' as const,
        data: dates,
        boundaryGap: false,
      },
      yAxis: {
        type: 'value' as const,
        minInterval: 1,
      },
      series: CATEGORY_ORDER.map(cat => ({
        name: CATEGORY_LABEL[cat],
        type: 'line' as const,
        stack: 'total',
        areaStyle: { opacity: 0.15 },
        data: dates.map(d => dateMap.get(d)![cat] || 0),
        color: CATEGORY_COLOR[cat],
        smooth: true,
        symbol: 'circle' as const,
        symbolSize: 4,
      })),
    }
  })
}

/** 每週熱力圖 option */
export function useWeeklyHeatmapOption(
  records: Ref<WorkRecord[]>,
  startHour: number,
  endHour: number,
) {
  return computed(() => {
    const dayLabels = ['週一', '週二', '週三', '週四', '週五', '週六', '週日']
    const hourLabels = Array.from({ length: endHour - startHour }, (_, i) => `${startHour + i}:00`)

    const data: [number, number, number][] = []
    const matrix: number[][] = hourLabels.map(() => new Array(7).fill(0))

    for (const r of records.value) {
      const d = new Date(r.capturedAt)
      const dayIdx = (d.getDay() + 6) % 7
      const h = d.getHours()
      const hourIdx = hourLabels.findIndex(label => parseInt(label) === h)
      if (hourIdx >= 0) matrix[hourIdx][dayIdx]++
    }

    for (let hi = 0; hi < hourLabels.length; hi++) {
      for (let di = 0; di < 7; di++) {
        if (matrix[hi][di] > 0) data.push([hi, di, matrix[hi][di]])
      }
    }

    return {
      tooltip: {
        position: 'top' as const,
        formatter: (p: any) => `${dayLabels[p.value[1]]} ${hourLabels[p.value[0]]}: ${p.value[2]} 筆`,
      },
      grid: { top: 8, bottom: 24, left: 48, right: 12 },
      xAxis: {
        type: 'category' as const,
        data: hourLabels,
        axisLabel: { fontSize: 10, rotate: 45 },
        splitArea: { show: true },
      },
      yAxis: {
        type: 'category' as const,
        data: dayLabels,
        axisLabel: { fontSize: 11 },
      },
      visualMap: {
        show: false,
        min: 0,
        max: Math.max(1, ...data.map(d => d[2])),
        inRange: { color: ['#f0f5ff', '#409EFF', '#1a3a6b'] },
      },
      series: [{
        type: 'heatmap' as const,
        data,
        label: { show: data.length <= 70, fontSize: 9 },
        emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0,0,0,0.3)' } },
      }],
    }
  })
}

/** 常用應用排名 option */
export function useAppRankOption(records: Ref<WorkRecord[]>, topN: number = 5) {
  return computed(() => {
    const appCounts = new Map<string, number>()
    for (const r of records.value) {
      if (!r.activeApp) continue
      const name = r.activeApp.replace(/\.exe$/i, '')
      appCounts.set(name, (appCounts.get(name) ?? 0) + 1)
    }

    const sorted = [...appCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .reverse()

    const appColors = ['#409EFF', '#67C23A', '#E6A23C', '#F56C6C', '#A78BFA']

    return {
      tooltip: {
        trigger: 'axis' as const,
        axisPointer: { type: 'shadow' as const },
      },
      grid: { top: 4, bottom: 4, left: 80, right: 40 },
      xAxis: { type: 'value' as const, minInterval: 1 },
      yAxis: {
        type: 'category' as const,
        data: sorted.map(([name]) => name),
        axisLabel: { fontSize: 11 },
      },
      series: [{
        type: 'bar' as const,
        data: sorted.map(([_, count], i) => ({
          value: count,
          itemStyle: { color: appColors[i % appColors.length], borderRadius: [0, 4, 4, 0] },
        })),
        barMaxWidth: 24,
        label: { show: true, position: 'right' as const, fontSize: 11 },
      }],
    }
  })
}
