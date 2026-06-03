/**
 * 週檢視:每日總採集柱狀圖。
 */

import {computed, type Ref} from 'vue'
import {useI18n} from 'vue-i18n'
import type {WorkRecord} from '../types'
import {buildWeekDayLabels, countByDay} from './_shared'

export function useWeekDailyBarOption(records: Ref<WorkRecord[]>) {
    const {t, locale} = useI18n()
    return computed(() => {
        void locale.value  // 建立 reactive 依賴,語言切換時觸發重算
        const dayCounts = countByDay(records.value)
        const days = buildWeekDayLabels()
        const data = days.map((day) => dayCounts.get(day) || 0)

        return {
            tooltip: {
                trigger: 'axis' as const,
                axisPointer: {type: 'shadow' as const},
            },
            grid: {top: 24, bottom: 24, left: 40, right: 12},
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
            series: [{
                name: t('workCollect.chartCaptureCount'),
                type: 'bar' as const,
                data,
                itemStyle: {
                    color: '#409EFF',
                    borderRadius: [4, 4, 0, 0],
                },
                label: {show: true, position: 'top' as const, fontSize: 10},
            }],
        }
    })
}
