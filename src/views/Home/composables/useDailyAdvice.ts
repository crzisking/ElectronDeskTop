/**
 * 首頁「每日學習建議」—— 從 HomeView 抽出。查狀態 / 立即生成 / 訂閱 PUSH_DAILY_ADVICE。
 */
import {computed, onMounted, onUnmounted, ref} from 'vue'
import {ElMessage} from 'element-plus'
import {IpcChannels} from '@shared/ipc-channels'
import type {DailyAdviceContent, DailyAdviceRow, DailyAdviceStatus} from '@/types/electron/daily-advice'

export function useDailyAdvice() {
    const loading = ref(false)
    const generating = ref(false)
    const status = ref<DailyAdviceStatus | null>(null)

    const ready = computed(() => !!status.value?.templateBound && !!status.value?.llmConfigured)
    const content = computed<DailyAdviceContent | null>(() => {
        const json = status.value?.today?.contentJson
        if (!json) return null
        try {
            return JSON.parse(json) as DailyAdviceContent
        } catch {
            return null
        }
    })

    function onPush(...args: unknown[]) {
        const row = args[0] as DailyAdviceRow
        if (status.value) status.value.today = row
    }

    async function load() {
        loading.value = true
        try {
            const r = await window.electronAPI.dailyAdvice.status()
            if (r.ok) status.value = r.data
            else ElMessage.error(r.error)
        } finally {
            loading.value = false
        }
    }

    async function onGenerate() {
        generating.value = true
        try {
            const r = await window.electronAPI.dailyAdvice.generate()
            if (r.ok) {
                if (status.value) status.value.today = r.data
            } else {
                ElMessage.error(r.error)
            }
        } finally {
            generating.value = false
        }
    }

    onMounted(() => {
        void load()
        window.electronAPI.on(IpcChannels.PUSH_DAILY_ADVICE, onPush)
    })
    onUnmounted(() => window.electronAPI.off(IpcChannels.PUSH_DAILY_ADVICE, onPush))

    return {loading, generating, status, ready, content, onGenerate}
}
