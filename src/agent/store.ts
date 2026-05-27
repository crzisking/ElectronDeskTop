/**
 * Agent 窗口 Pinia store。
 *
 * 持有:
 *  - config:API Key / baseUrl / model / systemPrompt / 等
 *  - messages:當前對話的訊息列表(LLM 消費的 + UI 顯示的同一份)
 *  - status:idle | running | error 用於禁用輸入框 / 顯示中止按鈕
 *  - conversationId:當前對話 UUID,寫入 agent_messages 表時帶上
 */

import {defineStore} from 'pinia'
import {computed, ref} from 'vue'
import type {AgentConfig, AgentMessage} from './types'
import {DEFAULT_SYSTEM_PROMPT} from './prompts'

function uuid(): string {
    // 內網應用,UUID 不需要 cryptographically strong;若 crypto.randomUUID 可用就用,否則 fallback
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
    return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

const DEFAULT_CONFIG: Required<AgentConfig> = {
    apiKey: '',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    temperature: 0.7,
    maxTurns: 10,
}

export const useAgentStore = defineStore('agent', () => {
    const config = ref<Required<AgentConfig>>({...DEFAULT_CONFIG})
    const messages = ref<AgentMessage[]>([])
    const conversationId = ref<string>(uuid())
    const status = ref<'idle' | 'running' | 'error'>('idle')
    const errorMessage = ref<string>('')

    /** 是否已具備發送請求的最低條件(API Key 不可空) */
    const isReady = computed(() => !!config.value.apiKey)

    /** UI 顯示用:過濾掉 system / 純 tool 消息(由 ToolCallCard 從 assistant 消息內顯示) */
    const visibleMessages = computed(() =>
        messages.value.filter((m) => m.role === 'user' || m.role === 'assistant')
    )

    function setConfig(partial: AgentConfig): void {
        config.value = {...config.value, ...partial}
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
        isReady,
        visibleMessages,
        setConfig,
        addMessage,
        updateLastMessage,
        startNewConversation,
        loadConversation,
    }
})

export {uuid}
export {DEFAULT_CONFIG}
