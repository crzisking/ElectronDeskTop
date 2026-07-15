/**
 * 工作分析 Dialog — 階段 1「配置」的狀態與準備邏輯。
 *
 * 從 AnalysisDialog.vue 抽出:時間範圍 + provider/model + 預設 prompt(可改)。
 * 不涉及串流 / 階段切換(那是 useAnalysisRun 的事),run 會讀本 composable 的值起 stream。
 */
import {computed, ref} from 'vue'
import {useI18n} from 'vue-i18n'
import {ElMessage} from 'element-plus'
import {useWorkAnalysisStore} from './store'
import type {LlmProviderConfig} from '@shared/types/llm.types'

function startOfToday(): Date {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
}

export function useAnalysisConfig() {
    const {t, locale} = useI18n()
    const analysisStore = useWorkAnalysisStore()

    const rangeStart = ref<Date>(startOfToday())
    const rangeEnd = ref<Date>(new Date())

    const providers = ref<LlmProviderConfig[]>([])
    const activeProviderId = ref<string | null>(null)
    /** 使用者覆寫的 model;為空字串時用 provider.model */
    const modelOverride = ref('')

    const systemPrompt = ref('')
    const userContent = ref('')
    const recordCount = ref(0)
    const preparing = ref(false)
    const promptsExpanded = ref(false)

    const selectedProvider = computed(() =>
        providers.value.find((p) => p.id === activeProviderId.value) ?? null,
    )

    const effectiveModel = computed(() =>
        modelOverride.value.trim() || selectedProvider.value?.model || '',
    )

    async function loadProviders(): Promise<void> {
        try {
            const cfg = await window.electronAPI.workAnalysis.readLlmConfig()
            providers.value = cfg.providers ?? []
            activeProviderId.value = cfg.activeProviderId ?? providers.value[0]?.id ?? null
            modelOverride.value = ''
        } catch {
            providers.value = []
            activeProviderId.value = null
        }
    }

    async function loadPrompts(): Promise<void> {
        preparing.value = true
        systemPrompt.value = ''
        userContent.value = ''
        recordCount.value = 0
        try {
            const result = await window.electronAPI.workAnalysis.prepare({
                rangeStart: rangeStart.value.getTime(),
                rangeEnd: rangeEnd.value.getTime(),
                locale: locale.value === 'en' ? 'en' : 'zh-TW',
            })
            if (result.ok) {
                systemPrompt.value = result.systemPrompt
                userContent.value = result.userContent
                recordCount.value = result.recordCount
            } else if (result.kind === 'no-records') {
                // 不在這裡彈 toast,讓使用者改時間範圍 — UI 內顯示提示即可
                systemPrompt.value = ''
                userContent.value = ''
                recordCount.value = 0
            } else {
                ElMessage.error(t('workAnalysis.prepareFailed'))
            }
        } finally {
            preparing.value = false
        }
    }

    /** dialog 開啟時初始化:provider 列表 + 重拉配額 + 預設 prompt */
    async function init(): Promise<void> {
        await loadProviders()
        await analysisStore.refreshQuota()
        await loadPrompts()
    }

    return {
        rangeStart,
        rangeEnd,
        providers,
        activeProviderId,
        modelOverride,
        systemPrompt,
        userContent,
        recordCount,
        preparing,
        promptsExpanded,
        selectedProvider,
        effectiveModel,
        loadPrompts,
        init,
    }
}

export type AnalysisConfig = ReturnType<typeof useAnalysisConfig>
