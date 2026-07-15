/**
 * 工作分析 Dialog — 階段切換 + 「流式(階段 2)/ 報告(階段 3)」的執行邏輯。
 *
 * 從 AnalysisDialog.vue 抽出。依賴 useAnalysisConfig 的配置值(systemPrompt / provider / 時間範圍)起 stream;
 * 串流走 vanilla DOM 的 StreamingController(不過 Vue reactive 全鏈路,對齊 docs/19 熱路徑)。
 */
import {computed, nextTick, onBeforeUnmount, ref} from 'vue'
import {useI18n} from 'vue-i18n'
import {ElMessage} from 'element-plus'
import {useWorkAnalysisStore} from './store'
import {type StreamEndEvent, StreamingController} from './streaming-controller'
import type {AnalysisConfig} from './useAnalysisConfig'
import type {AnalysisReport, AnalysisReportRow} from '@/types/electron/work-analysis'

type Stage = 'configure' | 'streaming' | 'result'

export function useAnalysisRun(config: AnalysisConfig) {
    const {t, locale} = useI18n()
    const analysisStore = useWorkAnalysisStore()

    const stage = ref<Stage>('configure')

    // ── 流式階段 state ──
    const streamRoot = ref<HTMLDivElement>()
    let controller: StreamingController | null = null
    const currentRunId = ref<string | null>(null)
    const streamError = ref<string | null>(null)

    // ── 報告階段 state ──
    const finalReport = ref<AnalysisReportRow | null>(null)
    const isStructured = ref(false)

    const canStart = computed(() => {
        if (config.preparing.value) return false
        if (!config.systemPrompt.value || !config.userContent.value) return false
        if (!config.activeProviderId.value) return false
        if (!config.effectiveModel.value) return false
        if (analysisStore.quota.used >= analysisStore.quota.limit) return false
        return true
    })

    const quotaTooltip = computed(() =>
        analysisStore.quota.used >= analysisStore.quota.limit
            ? t('workAnalysis.quotaTooltip', {limit: analysisStore.quota.limit})
            : '',
    )

    const parsedReport = computed<AnalysisReport | null>(() => {
        if (!finalReport.value || !isStructured.value) return null
        try {
            return JSON.parse(finalReport.value.reportJson) as AnalysisReport
        } catch {
            return null
        }
    })

    async function handleStart(): Promise<void> {
        if (!canStart.value) return
        if (!config.activeProviderId.value) return

        // 切階段
        stage.value = 'streaming'
        streamError.value = null
        // 等 DOM 更新出 streamRoot
        await nextTick()
        if (!streamRoot.value) {
            streamError.value = t('workAnalysis.domReady') as string
            return
        }

        // 先啟 controller 才呼 startStream,確保 push 不漏
        const result = await window.electronAPI.workAnalysis.startStream({
            systemPrompt: config.systemPrompt.value,
            userContent: config.userContent.value,
            rangeStart: config.rangeStart.value.getTime(),
            rangeEnd: config.rangeEnd.value.getTime(),
            providerId: config.activeProviderId.value,
            model: config.modelOverride.value.trim() || undefined,
            locale: locale.value === 'en' ? 'en' : 'zh-TW',
        })

        if (!result.ok) {
            handleStartFailure(result.kind, result.used, result.limit)
            stage.value = 'configure'
            return
        }

        currentRunId.value = result.runId
        controller = new StreamingController(streamRoot.value, result.runId)
        controller.onceEnd(handleStreamEnd)
    }

    function handleStartFailure(
        kind: 'busy' | 'quota' | 'bad-payload' | 'db',
        used?: number,
        limit?: number,
    ): void {
        switch (kind) {
            case 'busy':
                ElMessage.warning(t('workAnalysis.busy'))
                break
            case 'quota':
                ElMessage.warning(t('workAnalysis.quotaExhausted', {used: used ?? 0, limit: limit ?? 5}))
                break
            case 'bad-payload':
                ElMessage.error(t('workAnalysis.badPayload'))
                break
            case 'db':
                ElMessage.error(t('workAnalysis.dbFailed'))
                break
        }
    }

    async function handleStreamEnd(event: StreamEndEvent): Promise<void> {
        if (!event.ok) {
            streamError.value = describeStreamError(event)
            if (event.kind === 'no-provider') {
                // 立即引導到設定
                ElMessage.warning(t('workAnalysis.noProvider'))
            }
            return  // 留在 streaming 階段顯示錯誤,使用者按「返回」回 configure
        }

        // 成功 — 拉完整 row,進報告階段
        try {
            const row = await window.electronAPI.workAnalysis.get(event.reportId)
            finalReport.value = row
            isStructured.value = event.structured
            stage.value = 'result'
            // store 同步
            await analysisStore.refreshAfterStreamEnd()
        } catch (err) {
            streamError.value = String(err)
        }
    }

    function describeStreamError(event: Extract<StreamEndEvent, { ok: false }>): string {
        switch (event.kind) {
            case 'no-provider':
                return t('workAnalysis.noProvider')
            case 'llm-call':
                return t('workAnalysis.llmCallFailed', {error: event.error ?? ''})
            case 'db':
                return t('workAnalysis.dbFailed')
            case 'aborted':
                return t('workAnalysis.aborted')
        }
    }

    async function handleInterrupt(): Promise<void> {
        if (!currentRunId.value) return
        await window.electronAPI.workAnalysis.interrupt(currentRunId.value)
        // 不直接切階段,等 PUSH_END 帶 aborted 回來統一處理
    }

    function handleBackToConfigure(): void {
        teardownController()
        streamError.value = null
        stage.value = 'configure'
    }

    function teardownController(): void {
        controller?.dispose()
        controller = null
        currentRunId.value = null
    }

    /** dialog 關閉時重置(對齊原 watch close 分支) */
    function reset(): void {
        teardownController()
        stage.value = 'configure'
        streamError.value = null
        finalReport.value = null
    }

    onBeforeUnmount(() => {
        teardownController()
    })

    return {
        stage,
        streamRoot,
        streamError,
        finalReport,
        isStructured,
        canStart,
        quotaTooltip,
        parsedReport,
        handleStart,
        handleInterrupt,
        handleBackToConfigure,
        reset,
    }
}
