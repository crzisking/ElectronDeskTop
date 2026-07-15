/**
 * Agent 對話管理 —— 對話列表 / 當前對話 / 工作資料夾 / 歷史訊息懶加載。
 *
 * 擁有 messages、activeConvId、scrollEl 等「當前對話」核心狀態,並提供 scrollBottom;
 * useAgentStream 會接收這些共享 ref 往裡追加串流內容。
 */
import {nextTick, ref} from 'vue'
import {ElMessage} from 'element-plus'
import type {ConversationSummary} from '@shared/types/agent.types'
import {agentApi} from '../api'
import type {RawRow, ViewMsg} from '../types'

// 懶加載:先載最近 PAGE 則,往上滾再載更舊(上下文長也不卡)
const PAGE = 30

function mapRows(rows: RawRow[]): ViewMsg[] {
    return rows
        .filter((r) => r.role === 'user' || r.role === 'assistant')
        .map((r) => ({
            id: r.id,
            kind: r.role as 'user' | 'assistant',
            content: r.content,
            reasoning: r.reasoningContent
        }))
}

/** 路徑 → 顯示用的資料夾名(最後一段) */
export function folderName(p: string): string {
    const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/)
    return parts[parts.length - 1] || p
}

export function useAgentConversations() {
    const conversations = ref<ConversationSummary[]>([])
    const activeConvId = ref<string>('')
    /** 當前對話綁定的工作資料夾清單(可多個,第一個為主目錄) */
    const activeWorkspaces = ref<string[]>([])
    const messages = ref<ViewMsg[]>([])
    const scrollEl = ref<HTMLDivElement | null>(null)
    const hasMore = ref(false)
    const loadingMore = ref(false)
    let oldestTs: number | null = null

    function scrollBottom() {
        void nextTick(() => {
            const el = scrollEl.value
            if (el) el.scrollTop = el.scrollHeight
        })
    }

    async function loadConversations() {
        try {
            conversations.value = await agentApi.listConversations()
        } catch {
            conversations.value = []
        }
    }

    async function selectConversation(id: string) {
        activeConvId.value = id
        activeWorkspaces.value = conversations.value.find((c) => c.conversationId === id)?.workspaces ?? []
        try {
            const rows = await agentApi.listMessages(id, PAGE)
            messages.value = mapRows(rows)
            oldestTs = rows.length ? rows[0].timestamp : null
            hasMore.value = rows.length >= PAGE
            scrollBottom()
        } catch {
            messages.value = []
            hasMore.value = false
        }
    }

    /** 往上滾到頂 → 載更舊一頁,並補回 scrollTop 保持視覺位置 */
    async function loadOlder() {
        if (loadingMore.value || !hasMore.value || oldestTs == null || !activeConvId.value) return
        const el = scrollEl.value
        if (!el) return
        loadingMore.value = true
        const prevH = el.scrollHeight
        const prevTop = el.scrollTop
        try {
            const rows = await agentApi.listMessages(activeConvId.value, PAGE, oldestTs)
            if (rows.length) {
                oldestTs = rows[0].timestamp
                hasMore.value = rows.length >= PAGE
                messages.value = [...mapRows(rows), ...messages.value]
                await nextTick()
                el.scrollTop = el.scrollHeight - prevH + prevTop
            } else {
                hasMore.value = false
            }
        } catch {
            hasMore.value = false
        } finally {
            loadingMore.value = false
        }
    }

    function onScroll() {
        const el = scrollEl.value
        if (el && el.scrollTop < 60) void loadOlder()
    }

    async function newChat() {
        try {
            // opencode 式:新對話先選工作資料夾;取消就不建
            const picked = await agentApi.pickWorkspace()
            if (!picked.path) return
            const r = await agentApi.newConversation(picked.path)
            activeConvId.value = r.conversationId
            activeWorkspaces.value = r.workspaces
            messages.value = []
            oldestTs = null
            hasMore.value = false
            await loadConversations()
        } catch (err) {
            ElMessage.error((err as Error).message)
        }
    }

    /** 加一個工作資料夾(chip 條的「+」) */
    async function addWorkspace() {
        if (!activeConvId.value) return
        try {
            const picked = await agentApi.pickWorkspace()
            if (!picked.path || activeWorkspaces.value.includes(picked.path)) return
            const next = [...activeWorkspaces.value, picked.path]
            const r = await agentApi.setWorkspaces(activeConvId.value, next)
            activeWorkspaces.value = r.workspaces
            await loadConversations()
        } catch (err) {
            ElMessage.error((err as Error).message)
        }
    }

    /** 移除一個工作資料夾(chip 的 ×) */
    async function removeWorkspace(path: string) {
        if (!activeConvId.value) return
        try {
            const next = activeWorkspaces.value.filter((w) => w !== path)
            const r = await agentApi.setWorkspaces(activeConvId.value, next)
            activeWorkspaces.value = r.workspaces
            await loadConversations()
        } catch (err) {
            ElMessage.error((err as Error).message)
        }
    }

    async function removeConversation(id: string) {
        try {
            await agentApi.deleteConversation(id)
            if (id === activeConvId.value) {
                activeConvId.value = ''
                messages.value = []
            }
            await loadConversations()
        } catch (err) {
            ElMessage.error((err as Error).message)
        }
    }

    return {
        conversations,
        activeConvId,
        activeWorkspaces,
        messages,
        scrollEl,
        hasMore,
        loadingMore,
        scrollBottom,
        loadConversations,
        selectConversation,
        loadOlder,
        onScroll,
        newChat,
        addWorkspace,
        removeWorkspace,
        removeConversation,
    }
}
