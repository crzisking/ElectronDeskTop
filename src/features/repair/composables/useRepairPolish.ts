/**
 * useRepairPolish — AI 潤色（Dify SSE 串流）Composable
 *
 * 職責邊界：
 *  1. 彈窗顯示狀態（polishVisible）
 *  2. SSE 串流接收：fetch + ReadableStream + 行緩衝拼接
 *  3. polishResult 逐字累積（打字機效果）
 *  4. AbortController 中止：用戶關閉彈窗時立即停止 fetch
 *  5. 計次限制（POLISH_LIMIT），達到上限提示用戶修改描述
 *  6. applyPolish：把 AI 結果回填到編輯器，並保留原 HTML 中的圖片
 *
 * 為何不用 axios：
 *   axios 等響應完整接收後才 resolve，無法處理 SSE 持續流。
 *   只有 fetch + ReadableStream 才能逐 chunk 讀取。
 *
 * Dify 端點與 API Key 從環境變量讀取，避免硬編碼到源碼。
 */
import {computed, ref} from 'vue'
import {ElMessage} from 'element-plus'
import {useAuthStore} from '@/stores/auth.store'
import {i18n} from '@/locales'
import {logger} from '@/shared/utils/logger'
import {plainTextToHtml} from './useRepairForm'

/** 模塊級 i18n helper（composable 在 setup 內呼叫，但回調在 setup 外執行） */
const t = (key: string, named?: Record<string, unknown>) =>
  named ? i18n.global.t(key, named) : i18n.global.t(key)

const DIFY_URL = import.meta.env.VITE_DIFY_URL as string
const DIFY_API_KEY = import.meta.env.VITE_DIFY_API_KEY as string

/**
 * 同一份描述允許 AI 整理的最大次數。
 * 超過後按鈕變灰，需修改描述內容後計數才重置。
 * export 出去供模板顯示「剩餘 x 次」。
 */
export const POLISH_LIMIT = 5

interface UseRepairPolishOptions {
    /** 表單對象，讀寫 description（讀原文 / 寫 AI 結果） */
    submitForm: { description: string }
    /** Quill 空內容標準化（避免 '<p><br></p>' 被當有效內容） */
    normalizeEditorHtml: (html: string) => string
    /** HTML→純文字（給 AI 的 prompt 不能帶 HTML 標籤） */
    getPlainText: (html: string) => string
}

export function useRepairPolish(opts: UseRepairPolishOptions) {
    const authStore = useAuthStore()

    /** 彈窗顯示狀態（與 RepairPolishDialog 的 v-model 雙向綁定） */
    const polishVisible = ref(false)

    /** 串流接收中：true 時彈窗顯示「生成中…」、AI 整理按鈕 loading */
    const polishLoading = ref(false)

    /** 串流逐字累積的潤色結果，用戶可在彈窗手動微調後再採用 */
    const polishResult = ref('')

    /** 本次描述已使用 AI 整理的次數（提交成功或描述有變化會重置） */
    const polishUsedCount = ref(0)

    /** 是否已達整理上限（>= POLISH_LIMIT），到上限後按鈕禁用 */
    const polishLimitReached = computed(() => polishUsedCount.value >= POLISH_LIMIT)

    /**
     * fetch 的 AbortController。
     * 用戶關閉彈窗時調 abort() 停止串流；
     * 請求結束（finally）置 null 防殘留誤調用。
     */
    let polishAbort: AbortController | null = null

    /**
     * 觸發 AI 潤色。
     *
     * 前置：描述非空 + 未達上限。
     *
     * SSE 流程：
     *  - fetch streaming，逐 chunk decode，行緩衝跨 chunk 拼接
     *  - 每行找 'data: ' 前綴，解析 JSON 取 event=='message'/'agent_message' 的 answer
     *  - 累加到 polishResult，模板自動隨 ref 變化逐字渲染
     *
     * 只傳純文字給 AI，圖片在 applyPolish 時從原 HTML 提取後重新附加。
     */
    async function polishDescription(): Promise<void> {
        const plainDescription = opts.getPlainText(opts.normalizeEditorHtml(opts.submitForm.description))
        if (!plainDescription) {
            // 原文：請先填寫問題描述
            ElMessage.warning(t('repair.polishNeedDesc'))
            return
        }
        if (polishLimitReached.value) {
            // 原文：同一問題描述最多整理 N 次，請修改描述後再試
            ElMessage.warning(t('repair.polishLimitReached', {limit: POLISH_LIMIT}))
            return
        }

        // 先加計數，防止用戶在串流進行時連續點擊
        polishUsedCount.value++

        polishVisible.value = true
        polishLoading.value = true
        polishResult.value = ''
        polishAbort = new AbortController()

        // Prompt 是給 AI 看的，固定中文不走 i18n（後端 AI 與語言無關）
        const prompt =
            `請幫我潤色以下 IT 報修問題描述，讓表達更清晰、完整、專業，` +
            `保留所有原始資訊和細節，語言與原文保持一致：\n\n${plainDescription}`

        try {
            const response = await fetch(DIFY_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${DIFY_API_KEY}`
                },
                body: JSON.stringify({
                    inputs: {},
                    query: prompt,
                    response_mode: 'streaming',
                    user: authStore.user?.userName ?? 'desktop-user'
                }),
                signal: polishAbort.signal
            })

            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            // 原文：響應體為空（內部錯誤訊息，不直接顯示給用戶，保持中文便於日誌追溯）
            if (!response.body) throw new Error('Empty response body')

            const reader = response.body.getReader()
            const decoder = new TextDecoder('utf-8')

            /** 跨 chunk 行緩衝：最後一段可能是不完整的行，留到下個 chunk 再拼 */
            let lineBuffer = ''

            function processLine(line: string): void {
                if (!line.startsWith('data: ')) return
                const raw = line.slice(6).trim()
                if (!raw) return
                try {
                    const parsed = JSON.parse(raw) as { event: string; answer?: string }
                    if ((parsed.event === 'message' || parsed.event === 'agent_message') && parsed.answer) {
                        polishResult.value += parsed.answer
                    }
                } catch {
                    // 忽略非 JSON 心跳包等
                }
            }

            while (true) {
                const {done, value} = await reader.read()
                if (done) {
                    if (lineBuffer) processLine(lineBuffer)
                    break
                }
                const parts = (lineBuffer + decoder.decode(value, {stream: true})).split('\n')
                lineBuffer = parts.pop() ?? ''
                for (const line of parts) processLine(line)
            }
        } catch (e) {
            // AbortError 是用戶關彈窗主動取消，不算錯
            if (e instanceof Error && e.name === 'AbortError') return

            logger.error('AI 潤色串流失敗', 'useRepairPolish', e)
            // 原文：AI 整理失敗，請確認服務是否可用
            ElMessage.error(t('repair.polishFailedHint'))
            polishVisible.value = false
        } finally {
            polishLoading.value = false
            polishAbort = null
        }
    }

    /**
     * 採用 AI 結果並回填編輯器。
     *
     * 為何要單獨處理圖片：
     *   AI 拿到的是純文字（不含 HTML / 圖片），polishResult 也是純文字，
     *   直接賦值會丟失原 HTML 中的圖片。
     *
     * 步驟：
     *  1. 從原 description 的 HTML 提取 <img> 節點
     *  2. polishResult 純文字 → HTML 段落
     *  3. 圖片各包 <p> 追加到文字後（圖放最後最保險，因 AI 重組後文字結構可能與原文完全不同）
     *  4. 賦值 description，Quill 通過 v-model 自動更新；text-change 觸發附件同步
     */
    function applyPolish(): void {
        const container = document.createElement('div')
        container.innerHTML = opts.submitForm.description
        const images = Array.from(container.querySelectorAll('img'))

        let newHtml = plainTextToHtml(polishResult.value)
        if (images.length > 0) {
            newHtml += images.map((img) => `<p>${img.outerHTML}</p>`).join('')
        }

        opts.submitForm.description = newHtml
        polishVisible.value = false
    }

    /**
     * 關閉潤色彈窗。
     * 若串流仍在進行，立即 abort()，避免後台繼續處理無意義的數據。
     */
    function closePolish(): void {
        polishAbort?.abort()
        polishVisible.value = false
        polishResult.value = ''
    }

    /**
     * 重置潤色計數（提交成功後新工單從 0 開始）。
     */
    function resetPolishCount(): void {
        polishUsedCount.value = 0
    }

    return {
        polishVisible,
        polishLoading,
        polishResult,
        polishUsedCount,
        polishLimitReached,
        polishDescription,
        applyPolish,
        closePolish,
        resetPolishCount
    }
}
