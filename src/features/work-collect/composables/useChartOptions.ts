/**
 * 工作採集圖表 ECharts option 構建函式
 *
 * 將 WorkRecord 陣列轉換為各類 ECharts 圖表的 declarative option 物件。
 * 每個函式接收 records + 必要參數,回傳 ECharts option 配置(響應式 computed)。
 *
 * i18n 處理:
 *   每個 use*Option 內部呼叫 useI18n() 拿 t + locale;
 *   computed 內讀 `locale.value` 建立 reactive 依賴 —— 語言切換時 chart option 自動重算。
 */
import {computed, type Ref} from 'vue'
import {useI18n} from 'vue-i18n'
import {CATEGORY_COLOR, CATEGORY_LABEL_KEY, CATEGORY_ORDER} from '../category-colors'
import type {WorkCategory, WorkRecord} from '../types'

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

/** 獲取今天 00:00:00 的時間戳 */
function startOfToday(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 獲取過去一週第一天 00:00:00 的時間戳 */
function startOfWeek(): number {
  const d = new Date()
  d.setDate(d.getDate() - 6)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 篩選今天的紀錄 */
export function filterTodayRecords(records: WorkRecord[]): WorkRecord[] {
  const start = startOfToday()
  return records.filter(r => r.capturedAt >= start)
}

/** 篩選過去一週的紀錄 */
export function filterWeekRecords(records: WorkRecord[]): WorkRecord[] {
  const start = startOfWeek()
  return records.filter(r => r.capturedAt >= start)
}

/** 按天分組紀錄 */
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

/** 按天統計總數 */
function countByDay(records: WorkRecord[]): Map<string, number> {
  const groups = groupRecordsByDay(records)
  const result = new Map<string, number>()
  for (const [day, recs] of groups) {
    result.set(day, recs.length)
  }
  return result
}

/** 週檢視:每日總採集柱狀圖 option */
export function useWeekDailyBarOption(records: Ref<WorkRecord[]>) {
  const { t, locale } = useI18n()
  return computed(() => {
    void locale.value  // 建立 reactive 依賴,語言切換時觸發重算
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
        name: t('workCollect.chartCaptureCount'),
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

/** 週檢視:每日類別分布堆疊柱狀圖 option */
export function useWeekDailyStackedOption(records: Ref<WorkRecord[]>) {
  const { t, locale } = useI18n()
  return computed(() => {
    void locale.value
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
        data: CATEGORY_ORDER.map(c => t(CATEGORY_LABEL_KEY[c])),
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
        name: t(CATEGORY_LABEL_KEY[cat]),
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
  const { t, locale } = useI18n()
  return computed(() => {
    void locale.value
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
              html += `${p.marker} ${p.seriesName}: ${t('workCollect.chartTooltipRecord', { count: p.value })}<br/>`
            }
          }
          return html
        },
      },
      legend: {
        data: CATEGORY_ORDER.map(c => t(CATEGORY_LABEL_KEY[c])),
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
        name: t(CATEGORY_LABEL_KEY[cat]),
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
  const { t, locale } = useI18n()
  return computed(() => {
    void locale.value
    const counts = countByCategory(records.value)
    const data = CATEGORY_ORDER
      .filter(cat => counts[cat] > 0)
      .map(cat => ({
        name: t(CATEGORY_LABEL_KEY[cat]),
        value: counts[cat],
        itemStyle: { color: CATEGORY_COLOR[cat] },
      }))

    return {
      tooltip: {
        trigger: 'item' as const,
        formatter: (p: any) => t('workCollect.chartTooltipPercent', { value: `${p.name}: ${p.value}`, percent: p.percent }),
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
          text: `${records.value.length}\n${t('workCollect.chartTotalRecords')}`,
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
  const { t, locale } = useI18n()
  return computed(() => {
    void locale.value
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
        data: CATEGORY_ORDER.map(c => t(CATEGORY_LABEL_KEY[c])),
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
        name: t(CATEGORY_LABEL_KEY[cat]),
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
  const { t, locale } = useI18n()
  return computed(() => {
    void locale.value
    const dayLabels = [
      t('workCollect.weekdayMon'),
      t('workCollect.weekdayTue'),
      t('workCollect.weekdayWed'),
      t('workCollect.weekdayThu'),
      t('workCollect.weekdayFri'),
      t('workCollect.weekdaySat'),
      t('workCollect.weekdaySun'),
    ]
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
        formatter: (p: any) => t('workCollect.chartHeatmapTooltip', {
          day: dayLabels[p.value[1]],
          hour: hourLabels[p.value[0]],
          count: p.value[2],
        }),
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
    // 應用名來自 DB(系統實際 process name),不走 i18n
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

    /** Y 軸標籤過長時截斷顯示;hover 時 tooltip 仍顯示完整名 */
    const LABEL_MAX = 14
    const truncate = (name: string): string =>
        name.length > LABEL_MAX ? name.slice(0, LABEL_MAX) + '…' : name

    return {
      tooltip: {
        // axis trigger + shadow pointer:整條 Y 軸列(含 label)都能觸發 tooltip
        trigger: 'axis' as const,
        axisPointer: { type: 'shadow' as const },
        // 自定 formatter:p.name 是 yAxis 完整字串,不會被 truncate 影響
        formatter: (params: any[]) => {
          if (!params || !params.length) return ''
          const p = params[0]
          return `<strong>${p.name}</strong><br/>${p.marker} ${p.value}`
        },
      },
      grid: {top: 4, bottom: 4, left: 90, right: 40},
      xAxis: { type: 'value' as const, minInterval: 1 },
      yAxis: {
        type: 'category' as const,
        data: sorted.map(([name]) => name),
        axisLabel: {
          fontSize: 11,
          // 截斷邏輯;ECharts 內部仍存原值,tooltip / axisPointer 顯示時走原值
          formatter: truncate,
        },
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
