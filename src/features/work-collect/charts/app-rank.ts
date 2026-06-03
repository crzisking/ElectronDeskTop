/**
 * 常用應用排名 — 橫向柱狀圖,Top N。
 *
 * 應用名來自 DB(系統實際 process name),不走 i18n。
 */

import {computed, type Ref} from 'vue'
import type {WorkRecord} from '../types'
import type {TooltipParam} from './_shared'

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

        /** Y 軸標籤過長截斷;hover tooltip 仍顯示完整名 */
        const LABEL_MAX = 14
        const truncate = (name: string): string =>
            name.length > LABEL_MAX ? name.slice(0, LABEL_MAX) + '…' : name

        return {
            tooltip: {
                // axis trigger + shadow pointer:整條 Y 軸列(含 label)都能觸發 tooltip
                trigger: 'axis' as const,
                axisPointer: {type: 'shadow' as const},
                formatter: (params: TooltipParam[]) => {
                    if (!params || !params.length) return ''
                    const p = params[0]
                    return `<strong>${p.name}</strong><br/>${p.marker} ${p.value}`
                },
            },
            grid: {top: 4, bottom: 4, left: 90, right: 40},
            xAxis: {type: 'value' as const, minInterval: 1},
            yAxis: {
                type: 'category' as const,
                data: sorted.map(([name]) => name),
                axisLabel: {
                    fontSize: 11,
                    // ECharts 內部仍存原值,tooltip / axisPointer 顯示時走原值
                    formatter: truncate,
                },
            },
            series: [{
                type: 'bar' as const,
                data: sorted.map(([_, count], i) => ({
                    value: count,
                    itemStyle: {color: appColors[i % appColors.length], borderRadius: [0, 4, 4, 0]},
                })),
                barMaxWidth: 24,
                label: {show: true, position: 'right' as const, fontSize: 11},
            }],
        }
    })
}
