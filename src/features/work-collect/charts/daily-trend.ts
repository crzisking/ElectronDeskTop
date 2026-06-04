/**
 * 每日趨勢堆疊面積 — 過去 N 天每日各類別分布。
 *
 * 堆疊面積排序:大值類別放最上層(series 末尾),legend / tooltip 仍按 DESC 顯示。
 */

import {computed, type Ref} from 'vue'
import {useI18n} from 'vue-i18n'
import {useWorkCollectStore} from '../store'
import type {WorkCategory, WorkRecord} from '../types'
import {type CategoryCounts, deriveCategories} from './_shared'

export function useDailyTrendOption(records: Ref<WorkRecord[]>, days: number = 7) {
    const {locale} = useI18n()
    const workStore = useWorkCollectStore()
    return computed(() => {
        void locale.value
        // 觸發 reactive 依賴,模板熱更新時 legend / series name / 配色自動跟著變
        void workStore.categoryLabels
        void workStore.categoryColors
        const cats = deriveCategories(records.value)
        const dateMap = new Map<string, CategoryCounts>()
        const now = new Date()
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date(now)
            d.setDate(d.getDate() - i)
            const key = `${d.getMonth() + 1}/${d.getDate()}`
            const init: CategoryCounts = {}
            for (const c of cats) init[c] = 0
            dateMap.set(key, init)
        }

        for (const r of records.value) {
            const d = new Date(r.capturedAt)
            const key = `${d.getMonth() + 1}/${d.getDate()}`
            const bucket = dateMap.get(key)
            if (bucket) bucket[r.category] = (bucket[r.category] ?? 0) + 1
        }

        const dates = [...dateMap.keys()]

        // 堆疊面積:大值類別放最上層(series 末尾),legend / tooltip 按 DESC 顯示
        const categoryTotals = new Map<WorkCategory, number>()
        for (const cat of cats) {
            let sum = 0
            for (const d of dates) sum += dateMap.get(d)?.[cat] ?? 0
            categoryTotals.set(cat, sum)
        }
        const stackOrder = [...cats].sort(
            (a, b) => (categoryTotals.get(a) ?? 0) - (categoryTotals.get(b) ?? 0),
        )
        const legendOrder = [...stackOrder].reverse()

        return {
            tooltip: {
                trigger: 'axis' as const,
                // 同一時間點 multi-series 按值降序;配合 stackOrder 反向,讓彈窗以大值類別在頂
                order: 'valueDesc' as const,
            },
            legend: {
                data: legendOrder.map((c) => workStore.labelOf(c)),
                // scroll 模式:項目多到一行放不下時自動分頁(右側出現 < > 按鈕),
                // 不再被擠成一坨。橫向標準排版,看得清楚。
                type: 'scroll' as const,
                bottom: 4,
                // 左右各留 20px,給 scroll 按鈕跟首尾標籤呼吸空間,免得按鈕貼邊難點
                left: 20,
                right: 20,
                textStyle: {fontSize: 11},
                // 預設 itemGap=10 偏緊;14+ 個類別時需要更明確的間隔才看得出邊界
                itemGap: 16,
                itemWidth: 14,
                itemHeight: 10,
            },
            // bottom 50 給 legend 約一行高度 + 8px 邊距;繪圖區仍有 ~260px 高度
            grid: {top: 16, bottom: 50, left: 44, right: 16},
            xAxis: {
                type: 'category' as const,
                data: dates,
                boundaryGap: false,
            },
            yAxis: {
                type: 'value' as const,
                minInterval: 1,
            },
            series: stackOrder.map((cat) => ({
                name: workStore.labelOf(cat),
                type: 'line' as const,
                stack: 'total',
                areaStyle: {opacity: 0.15},
                data: dates.map((d) => dateMap.get(d)?.[cat] ?? 0),
                color: workStore.colorOf(cat),
                smooth: true,
                symbol: 'circle' as const,
                symbolSize: 4,
            })),
        }
    })
}
