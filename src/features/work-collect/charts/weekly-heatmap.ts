/**
 * 每週熱力圖 — 週一~週日 × 各小時的活動密度。
 */

import {computed, type Ref} from 'vue'
import {useI18n} from 'vue-i18n'
import type {WorkRecord} from '../types'
import type {TooltipParam} from './_shared'

export function useWeeklyHeatmapOption(
    records: Ref<WorkRecord[]>,
    startHour: number,
    endHour: number,
) {
    const {t, locale} = useI18n()
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
        const hourLabels = Array.from({length: endHour - startHour}, (_, i) => `${startHour + i}:00`)

        const data: [number, number, number][] = []
        const matrix: number[][] = hourLabels.map(() => new Array(7).fill(0))

        for (const r of records.value) {
            const d = new Date(r.capturedAt)
            const dayIdx = (d.getDay() + 6) % 7
            const h = d.getHours()
            const hourIdx = hourLabels.findIndex((label) => parseInt(label) === h)
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
                formatter: (p: TooltipParam) => {
                    // heatmap value 是 [xIndex, yIndex, count] 三元
                    const v = Array.isArray(p.value) ? p.value : [0, 0, 0]
                    return t('workCollect.chartHeatmapTooltip', {
                        day: dayLabels[Number(v[1]) || 0],
                        hour: hourLabels[Number(v[0]) || 0],
                        count: Number(v[2]) || 0,
                    })
                },
            },
            grid: {top: 8, bottom: 24, left: 48, right: 12},
            xAxis: {
                type: 'category' as const,
                data: hourLabels,
                axisLabel: {fontSize: 10, rotate: 45},
                splitArea: {show: true},
            },
            yAxis: {
                type: 'category' as const,
                data: dayLabels,
                axisLabel: {fontSize: 11},
            },
            visualMap: {
                show: false,
                min: 0,
                max: Math.max(1, ...data.map((d) => d[2])),
                inRange: {color: ['#f0f5ff', '#409EFF', '#1a3a6b']},
            },
            series: [{
                type: 'heatmap' as const,
                data,
                label: {show: data.length <= 70, fontSize: 9},
                emphasis: {itemStyle: {shadowBlur: 8, shadowColor: 'rgba(0,0,0,0.3)'}},
            }],
        }
    })
}
