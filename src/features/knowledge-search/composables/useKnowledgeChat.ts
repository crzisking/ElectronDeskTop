/**
 * useKnowledgeChat — 知識檢索問答的狀態機與動作(視圖層薄殼,邏輯全在這)。
 *
 * 職責:
 *  1. 載入該工號可見的知識庫,供選庫下拉(進頁時 loadKbs)。
 *  2. 維護一輪對話:訊息列表、conversation_id、自帶 history(persist=false,桌面自管)。
 *  3. 發問 → 串流接收 → 逐字累加到助手泡泡 → 掛引用來源。
 *  4. 中止(關頁 / 重新開對話 / 切庫)時 abort 正在進行的串流。
 *
 * 為什麼不用 pinia store:本功能只有單一頁面在用,狀態隨頁面生滅即可,composable 足夠;
 * 不引入跨頁共享的全域狀態(避免離頁後殘留一輪半截對話)。
 */

import {computed, ref} from 'vue'
import {ElMessage} from 'element-plus'
import {useAuthStore} from '@/stores/auth.store'
import {logger} from '@/shared/utils/logger'
import {fetchVisibility, streamKbChat} from '../api'
import type {ChatMessage, ChatTurn, KbBrief} from '../types'

export function useKnowledgeChat() {
    const authStore = useAuthStore()

    /** 可選知識庫(該工號有權進的)。 */
    const kbs = ref<KbBrief[]>([])
    /** 當前選中的知識庫代號(單一知識庫)。 */
    const selectedKbCode = ref<string>('')
    /** 選庫下拉載入中。 */
    const kbsLoading = ref(false)

    /** 對話訊息列表(渲染用)。 */
    const messages = ref<ChatMessage[]>([])
    /** 平台回傳的會話 ID:首問由服務端生成,後續追問帶回去接著聊。 */
    const conversationId = ref<string | null>(null)
    /** 串流進行中:true 時輸入框禁用、顯示「生成中」。 */
    const sending = ref(false)

    /** fetch 中止器:關頁 / 重開對話 / 切庫時 abort 掉正在進行的串流。 */
    let abort: AbortController | null = null

    /** 能否發送:選了庫、非空輸入、且沒有正在進行的串流(在 send 內再校驗輸入)。 */
    const canSend = computed(() => !!selectedKbCode.value && !sending.value)

    /**
     * 載入該工號可見的知識庫。無工號(未登入)時給出提示並留空。
     * 預設選中第一個庫,省去使用者每次手動選。
     */
    async function loadKbs(): Promise<void> {
        const employeeNo = authStore.userName
        if (!employeeNo) {
            ElMessage.warning('未取得登入工號,無法載入知識庫')
            return
        }
        kbsLoading.value = true
        try {
            const visibility = await fetchVisibility(employeeNo)
            kbs.value = visibility.knowledge_bases
            if (kbs.value.length > 0 && !selectedKbCode.value) {
                selectedKbCode.value = kbs.value[0].code
            }
        } catch (err) {
            logger.error('載入可見知識庫失敗', 'knowledge-search', err)
            ElMessage.error('載入知識庫失敗,請稍後重試')
        } finally {
            kbsLoading.value = false
        }
    }

    /** 把當前訊息列表(不含正在串流的半截)轉成平台要的 history。 */
    function buildHistory(): ChatTurn[] {
        return messages.value
            .filter((m) => !m.streaming)
            .map((m) => ({role: m.role, content: m.content}))
    }

    /**
     * 發送一個問題並開始串流接收。
     * 流程:推入使用者泡泡 + 空的助手泡泡 → fetch SSE → onToken 累加 → onSources 掛來源 → onDone 收尾。
     */
    async function send(text: string): Promise<void> {
        const question = text.trim()
        if (!question) return
        if (!selectedKbCode.value) {
            ElMessage.warning('請先選擇一個知識庫')
            return
        }
        const employeeNo = authStore.userName
        if (!employeeNo) {
            ElMessage.warning('未取得登入工號,無法提問')
            return
        }

        // history 要在推入本輪泡泡「之前」算好(否則會把本輪問題也算進歷史)。
        const history = buildHistory()
        messages.value.push({role: 'user', content: question})
        messages.value.push({role: 'assistant', content: '', streaming: true})
        // 關鍵:push 進 reactive 陣列後,必須拿「陣列裡的那個代理元素」來改,
        // 才會逐 token 觸發重渲染(做出串流打字機)。若沿用 push 前的原始物件引用去改,
        // 改的是 raw target、不走 proxy set,Vue 收不到通知 → 會等下次別的更新才一次性顯示。
        const assistant = messages.value[messages.value.length - 1]

        sending.value = true
        abort = new AbortController()
        try {
            await streamKbChat(
                {
                    message: question,
                    conversation_id: conversationId.value,
                    persist: false,
                    history,
                    employee_no: employeeNo,
                    kb_codes: [selectedKbCode.value],
                },
                {
                    onMeta: (id) => {
                        if (id) conversationId.value = id
                    },
                    onToken: (token) => {
                        assistant.content += token
                    },
                    onSources: (sources) => {
                        assistant.sources = sources
                    },
                    onDone: () => {
                        assistant.streaming = false
                    },
                },
                abort.signal,
            )
        } catch (err) {
            // 使用者主動取消(關頁 / 重開)不算錯,靜默。
            if (err instanceof Error && err.name === 'AbortError') {
                removeUnfinishedAssistant(assistant)
                return
            }
            logger.error('知識檢索問答失敗', 'knowledge-search', err)
            // 把錯誤訊息顯示在助手泡泡裡,讓使用者知道這輪失敗(而非空白)。
            assistant.content = assistant.content || (err instanceof Error ? err.message : '問答失敗,請稍後重試')
            assistant.streaming = false
        } finally {
            assistant.streaming = false
            sending.value = false
            abort = null
        }
    }

    /** 從列表移除一個(被取消而)沒內容的助手泡泡,避免留下空白氣泡。 */
    function removeUnfinishedAssistant(assistant: ChatMessage): void {
        if (assistant.content) return
        const idx = messages.value.indexOf(assistant)
        if (idx !== -1) messages.value.splice(idx, 1)
    }

    /** 開一個新對話:中止當前串流、清空訊息與會話 ID(選中的庫保留)。 */
    function newConversation(): void {
        abort?.abort()
        abort = null
        sending.value = false
        messages.value = []
        conversationId.value = null
    }

    /** 頁面卸載時呼叫:中止串流,避免背景繼續讀流。 */
    function dispose(): void {
        abort?.abort()
        abort = null
    }

    return {
        kbs,
        selectedKbCode,
        kbsLoading,
        messages,
        conversationId,
        sending,
        canSend,
        loadKbs,
        send,
        newConversation,
        dispose,
    }
}
