/**
 * Agent 窗口 Pinia store。
 *
 * 持有:
 *  - config:providers / activeProviderId / systemPrompt / 等
 *  - messages:當前對話的訊息列表(LLM 消費的 + UI 顯示的同一份)
 *  - status:idle | running | error 用於禁用輸入框 / 顯示中止按鈕
 *  - conversationId:當前對話 UUID,寫入 agent_messages 表時帶上
 *
 * 多 provider 設計(對應 doc 18 後續擴充):
 *  - `config.providers` 是廠商清單,每個都有自己的 apiKey/baseUrl/model
 *  - `config.activeProviderId` 指向當前用哪個(發起請求時取對應的 provider)
 *  - 啟動時若 DB 內無 providers 但有 legacy apiKey,service 端會自動遷移
 *  - 計算屬性 `activeProvider` / `isReady` 集中處理「當前 provider 是否可用」邏輯
 */

import {defineStore} from 'pinia'
import {computed, ref} from 'vue'
import {uuid} from '@/utils/uuid'
import type {AgentConfig, AgentMessage, ProviderConfig} from './types'
import {DEFAULT_SYSTEM_PROMPT} from './prompts'

/**
 * 出廠模板:首次啟動 / SQLite 全空時用。
 * 兩家都不填 apiKey,引導使用者手動填或等 TMBOM 後端拉取覆蓋。
 *
 * model 留空字串,進設定後從 `GET {baseUrl}/models` 拉一份讓使用者挑,避免硬編碼一個
 * 未來可能下架的 model 名字。
 */
const DEFAULT_PROVIDERS: ProviderConfig[] = [
    {
        id: 'deepseek',
        label: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        apiKey: '',
        model: 'deepseek-chat',
    },
    {
        id: 'qwen',
        label: '通義千問',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        apiKey: '',
        model: '',
    },
]

const DEFAULT_CONFIG: Required<AgentConfig> = {
    providers: DEFAULT_PROVIDERS,
    activeProviderId: 'deepseek',
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    temperature: 0.7,
    maxTurns: 10,
    // Thinking mode — 默認關閉,使用者在設定裡按需開啟
    thinkingEnabled: false,
    reasoningEffort: 'high',
    // legacy(不寫進 DB,僅給型別齊全)
    apiKey: '',
    baseUrl: '',
    model: '',
}

export const useAgentStore = defineStore('agent', () => {
    const config = ref<Required<AgentConfig>>({...DEFAULT_CONFIG, providers: [...DEFAULT_PROVIDERS]})
    const messages = ref<AgentMessage[]>([])
    const conversationId = ref<string>(uuid())
    const status = ref<'idle' | 'running' | 'error'>('idle')
    const errorMessage = ref<string>('')

    /**
     * 當前選用的 provider。
     *
     * 找不到 activeProviderId 對應的 → fallback 用第一個;providers 為空 → 返回 null。
     * 寫入路徑:UI 改 active provider 時,先確認該 id 在 providers 內存在。
     */
    const activeProvider = computed<ProviderConfig | null>(() => {
        const list = config.value.providers ?? []
        if (!list.length) return null
        const active = list.find((p) => p.id === config.value.activeProviderId)
        return active ?? list[0]
    })

    /** 是否已具備發送請求的最低條件(active provider 存在且 apiKey + model 都填了) */
    const isReady = computed(() => {
        const p = activeProvider.value
        return !!(p && p.apiKey && p.model)
    })

    /** UI 顯示用:過濾掉 system / 純 tool 消息(由 ToolCallCard 從 assistant 消息內顯示) */
    const visibleMessages = computed(() =>
        messages.value.filter((m) => m.role === 'user' || m.role === 'assistant')
    )

    function setConfig(partial: AgentConfig): void {
        config.value = {...config.value, ...partial}
    }

    /**
     * 替換 providers 整個列表(添加 / 編輯 / 刪除都走這條;UI 端先算好新 list 再傳)。
     * 若新 list 中沒有當前 active id → 自動切到第一個。
     */
    function setProviders(list: ProviderConfig[]): void {
        config.value.providers = list
        if (!list.find((p) => p.id === config.value.activeProviderId)) {
            config.value.activeProviderId = list[0]?.id ?? ''
        }
    }

    /** 切換 active provider(對應 settings 的下拉選擇) */
    function setActiveProviderId(id: string): void {
        config.value.activeProviderId = id
    }

    /** 修改當前 active provider 的某個欄位(常用:model / apiKey) */
    function updateActiveProvider(patch: Partial<ProviderConfig>): void {
        const list = config.value.providers ?? []
        const idx = list.findIndex((p) => p.id === config.value.activeProviderId)
        if (idx < 0) return
        list[idx] = {...list[idx], ...patch}
        // 觸發 reactive(Vue 對 array index 替換的偵測有時不靈;顯式重指派一份)
        config.value.providers = [...list]
    }

    function addMessage(msg: AgentMessage): void {
        messages.value.push(msg)
    }

    function updateLastMessage(patch: Partial<AgentMessage>): void {
        const last = messages.value[messages.value.length - 1]
        if (!last) return
        Object.assign(last, patch)
    }

    function startNewConversation(): void {
        conversationId.value = uuid()
        messages.value = []
        status.value = 'idle'
        errorMessage.value = ''
    }

    /** 切換到既有對話 — 由 UI 從對話列表載入歷史後呼叫 */
    function loadConversation(id: string, msgs: AgentMessage[]): void {
        conversationId.value = id
        messages.value = msgs
        status.value = 'idle'
        errorMessage.value = ''
    }

    return {
        config,
        messages,
        conversationId,
        status,
        errorMessage,
        activeProvider,
        isReady,
        visibleMessages,
        setConfig,
        setProviders,
        setActiveProviderId,
        updateActiveProvider,
        addMessage,
        updateLastMessage,
        startNewConversation,
        loadConversation,
    }
})

export {DEFAULT_CONFIG, DEFAULT_PROVIDERS}
