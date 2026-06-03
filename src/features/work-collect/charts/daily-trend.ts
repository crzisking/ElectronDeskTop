/**
 * 每日趨勢堆疊面積 — 過去 N 天每日各類別分布。
 *
 * 堆疊面積排序:大值類別放最上層(series 末尾),legend / tooltip 仍按 DESC 顯示。
 */

import {computed, type Ref} from 'vue'
import {useI18n} from 'vue-i18n'
import {getCategoryColor} from '../category-colors'
import {useWorkCollectStore} from '../store'
import type {WorkCategory, WorkRecord} from '../types'
import {type CategoryCounts, deriveCategories} from './_shared'

export function useDailyTrendOption(records: Ref<WorkRecord[]>, days: number = 7) {
    const {locale} = useI18n()
    const workStore = useWorkCollectStore()
    return computed(() => {
        void locale.value
        void workStore.categoryLabels // 觸發 reactive 依賴,模板熱更新時 legend / series name 自動跟著變
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
                bottom: 0,
                textStyle: {fontSize: 10},
            },
            grid: {top: 12, bottom: 36, left: 40, right: 12},
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
                color: getCategoryColor(cat),
                smooth: true,
                symbol: 'circle' as const,
                symbolSize: 4,
            })),
        }
    })
}
