/**
 * 首頁「今日活動」熱力 / 分佈 / 統計 —— 從 HomeView 抽出(view 只留佈局)。
 * 資料純本地(work-collect 聚合),掛載即載入。
 */
import {computed, onMounted, ref} from 'vue'
import {useI18n} from 'vue-i18n'
import {paceLevel} from '../dashboard-utils'
import {activityApi} from '@/features/activity/api'
import type {TodayActivitySummary} from '@/features/activity/types'

const DIST_COLORS = ['#3a5d96', '#5b8bc9', '#74a8e0', '#9cc2ec', '#c4d9f4', '#8492a6', '#b37feb', '#36cfc9']

export function useTodayActivity() {
    const {t} = useI18n()
    const activity = ref<TodayActivitySummary>({categories: [], hourly: new Array(24).fill(0)})

    const totalMinutes = computed(() => activity.value.categories.reduce((s, c) => s + c.minutes, 0))
    /** 質性「節奏」描述,氛圍感 > 監控感(閾值在 dashboard-utils.paceLevel) */
    const paceText = computed(() => t(`home.pace${paceLevel(totalMinutes.value)}`))
    const topCategory = computed(() => activity.value.categories[0]?.category ?? '—')
    const activeHours = computed(() => activity.value.hourly.filter((m) => m > 0).length)

    const distColor = (i: number) => DIST_COLORS[i % DIST_COLORS.length]
    const distWidth = (minutes: number) => `${Math.max(2, (minutes / Math.max(1, totalMinutes.value)) * 100)}%`

    async function load() {
        try {
            activity.value = await activityApi.todayActivity()
        } catch {
            /* 採集服務沒起來就顯示空熱力,不打擾 */
        }
    }

    onMounted(load)
    return {activity, totalMinutes, paceText, topCategory, activeHours, distColor, distWidth}
}
