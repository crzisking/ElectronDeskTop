/**
 * 週檢視:每日類別分布堆疊柱狀圖。
 */

import {computed, type Ref} from 'vue'
import {useI18n} from 'vue-i18n'
import {getCategoryColor} from '../category-colors'
import {useWorkCollectStore} from '../store'
import type {WorkRecord} from '../types'
import {buildWeekDayLabels, deriveCategories} from './_shared'

export function useWeekDailyStackedOption(records: Ref<WorkRecord[]>) {
    const {locale} = useI18n()
    const workStore = useWorkCollectStore()
    return computed(() => {
        void locale.value
        void workStore.categoryLabels // reactive 依賴,模板熱更新時 legend / series name 跟著變
        const days = buildWeekDayLabels()
        const cats = deriveCategories(records.value)
        const matrix: Record<string, number[]> = {}
        for (const cat of cats) matrix[cat] = new Array(days.length).fill(0)

        for (const r of records.value) {
            const d = new Date(r.capturedAt)
            const dayKey = `${d.getMonth() + 1}/${d.getDate()}`
            const idx = days.indexOf(dayKey)
            if (idx >= 0 && matrix[r.category]) matrix[r.category][idx]++
        }

        return {
            tooltip: {
                trigger: 'axis' as const,
                axisPointer: {type: 'shadow' as const},
            },
            legend: {
                data: cats.map((c) => workStore.labelOf(c)),
                top: 0,
                textStyle: {fontSize: 11},
            },
            grid: {top: 32, bottom: 24, left: 40, right: 12},
            xAxis: {
                type: 'category' as const,
                data: days,
                axisLabel: {fontSize: 10},
            },
            yAxis: {
                type: 'value' as const,
                minInterval: 1,
                axisLabel: {fontSize: 10},
            },
            series: cats.map((cat) => ({
                name: workStore.labelOf(cat),
                type: 'bar' as const,
                stack: 'total',
                data: matrix[cat],
                color: getCategoryColor(cat),
                emphasis: {focus: 'series' as const},
                itemStyle: {borderRadius: [2, 2, 0, 0]},
            })),
        }
    })
}
