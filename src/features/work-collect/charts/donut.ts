/**
 * 類別佔比 Donut — 中心顯示總筆數,環顯示各類別百分比。
 */

import {computed, type Ref} from 'vue'
import {useI18n} from 'vue-i18n'
import {getCategoryColor, getCategoryLabel} from '../category-colors'
import type {WorkRecord} from '../types'
import {countByCategory, type TooltipParam} from './_shared'

export function useDonutOption(records: Ref<WorkRecord[]>) {
    const {t, locale} = useI18n()
    return computed(() => {
        void locale.value
        const counts = countByCategory(records.value)
        // 直接按 counts 出現順序展示,降序排好看
        const data = Object.entries(counts)
            .filter(([, v]) => v > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([cat, v]) => ({
                name: getCategoryLabel(cat),
                value: v,
                itemStyle: {color: getCategoryColor(cat)},
            }))

        return {
            tooltip: {
                trigger: 'item' as const,
                formatter: (p: TooltipParam) => t('workCollect.chartTooltipPercent', {
                    value: `${p.name}: ${p.value}`,
                    percent: p.percent,
                }),
            },
            legend: {
                orient: 'vertical' as const,
                right: 0,
                top: 'center',
                textStyle: {fontSize: 11},
            },
            series: [{
                type: 'pie' as const,
                radius: ['45%', '70%'],
                center: ['38%', '50%'],
                avoidLabelOverlap: false,
                itemStyle: {borderRadius: 4, borderColor: '#fff', borderWidth: 2},
                label: {show: false},
                emphasis: {
                    label: {show: true, fontSize: 16, fontWeight: 'bold' as const},
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
