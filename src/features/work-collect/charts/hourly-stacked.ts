/**
 * 每小時堆疊柱狀 — 顯示工作日每小時各類別分布。
 */

import {computed, type Ref} from 'vue'
import {useI18n} from 'vue-i18n'
import {getCategoryColor} from '../category-colors'
import {useWorkCollectStore} from '../store'
import type {WorkRecord} from '../types'
import {deriveCategories, type TooltipParam} from './_shared'

export function useHourlyStackedOption(
    records: Ref<WorkRecord[]>,
    startHour: number,
    endHour: number,
) {
    const {t, locale} = useI18n()
    const workStore = useWorkCollectStore()
    return computed(() => {
        void locale.value
        void workStore.categoryLabels // reactive 依賴,模板熱更新時 legend / series name 跟著變
        const hours = Array.from({length: endHour - startHour}, (_, i) => startHour + i)
        const cats = deriveCategories(records.value)
        const matrix: Record<string, number[]> = {}
        for (const cat of cats) matrix[cat] = new Array(hours.length).fill(0)

        for (const r of records.value) {
            const h = new Date(r.capturedAt).getHours()
            const idx = hours.indexOf(h)
            if (idx >= 0 && matrix[r.category]) matrix[r.category][idx]++
        }

        return {
            tooltip: {
                trigger: 'axis' as const,
                axisPointer: {type: 'shadow' as const},
                formatter: (params: TooltipParam[]) => {
                    // axisValue 在 ECharts 型別裡 optional,實際 trigger:'axis' 必有,?? '' 兜底
                    const hour = params[0].axisValue ?? ''
                    let html = `<strong>${hour}:00 - ${parseInt(hour) + 1}:00</strong><br/>`
                    for (const p of params) {
                        const v = typeof p.value === 'number' ? p.value : 0
                        if (v > 0) {
                            html += `${p.marker} ${p.seriesName}: ${t('workCollect.chartTooltipRecord', {count: v})}<br/>`
                        }
                    }
                    return html
                },
            },
            legend: {
                data: cats.map((c) => workStore.labelOf(c)),
                top: 0,
                textStyle: {fontSize: 11},
            },
            grid: {top: 32, bottom: 24, left: 40, right: 12},
            xAxis: {
                type: 'category' as const,
                data: hours.map((h) => `${h}:00`),
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
