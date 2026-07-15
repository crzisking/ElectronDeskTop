/**
 * 工具訊息的顯示邏輯 —— 把 messages 裡連續的 tool 訊息折成一組(整組預設折疊,少一堆卡片)。
 * 純顯示,不碰 IPC;接 messages ref,回 computed + 一組展開/摘要 helpers。
 */
import {computed, ref, type Ref} from 'vue'
import type {DisplayItem, ToolGroup, ToolMsg, ViewMsg} from '../types'

export function useToolGroups(messages: Ref<ViewMsg[]>) {
    const groupOpen = ref<Record<string, boolean>>({})

    const displayItems = computed<DisplayItem[]>(() => {
        const out: DisplayItem[] = []
        let buf: ToolMsg[] = []
        const flush = () => {
            if (buf.length) {
                out.push({kind: 'tool-group', id: buf[0].id, tools: buf})
                buf = []
            }
        }
        for (const m of messages.value) {
            if (m.kind === 'tool') buf.push(m)
            else {
                flush()
                out.push(m)
            }
        }
        flush()
        return out
    })

    const isGroupOpen = (id: string) => !!groupOpen.value[id]
    const toggleGroup = (id: string) => {
        groupOpen.value[id] = !groupOpen.value[id]
    }
    const groupRunning = (g: ToolGroup) => g.tools.some((t) => t.running)
    const groupError = (g: ToolGroup) => g.tools.some((t) => t.isError)

    /** 折疊時的一行摘要:1 個顯示工具名,多個顯示「N 個工具:name…」 */
    function groupSummary(g: ToolGroup): string {
        const names = g.tools.map((t) => t.name)
        if (names.length === 1) return names[0]
        const uniq = [...new Set(names)]
        const head = uniq.slice(0, 3).join('、')
        return `${names.length} 個工具:${head}${uniq.length > 3 ? '…' : ''}`
    }

    /** 單一工具狀態小圓點 class */
    function statusClass(t: ToolMsg): string {
        if (t.running) return 'dot-running'
        return t.isError ? 'dot-error' : 'dot-ok'
    }

    // ── 工具 input/output 顯示格式化 ──
    function stringify(v: unknown): string {
        if (typeof v === 'string') return v
        try {
            return JSON.stringify(v, null, 2)
        } catch {
            return String(v)
        }
    }

    function shorten(s: string, max = 800): string {
        return s.length > max ? s.slice(0, max) + `…(+${s.length - max})` : s
    }

    return {
        displayItems,
        isGroupOpen,
        toggleGroup,
        groupRunning,
        groupError,
        groupSummary,
        statusClass,
        stringify,
        shorten,
    }
}
