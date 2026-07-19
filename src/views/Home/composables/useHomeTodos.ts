/**
 * 首頁「待辦」區塊 —— 從 HomeView 抽出。讀本地代辦、點圈完成、＋記一條開錄入窗;
 * 訂閱 PUSH_TODO_CHANGED 即時刷新。到期文案/配色複用 dashboard-utils。
 */
import {onMounted, onUnmounted, ref} from 'vue'
import {useI18n} from 'vue-i18n'
import {IpcChannels} from '@shared/ipc-channels'
import {dueDays, dueLevel} from '../dashboard-utils'
import type {Todo} from '@shared/types/todo.types'

const TODO_SHOW_LIMIT = 5

export function useHomeTodos() {
    const {t} = useI18n()
    const todos = ref<Todo[]>([])

    async function load() {
        try {
            const r = await window.electronAPI.todo.listOpen()
            const list = r.ok ? r.data : []
            todos.value = [...list]
                .sort((a, b) => (a.dueAt ?? Number.MAX_SAFE_INTEGER) - (b.dueAt ?? Number.MAX_SAFE_INTEGER))
                .slice(0, TODO_SHOW_LIMIT)
        } catch {
            /* 讀不到就顯示空狀態,不打擾 */
        }
    }

    async function completeTodo(id: string) {
        try {
            await window.electronAPI.todo.complete(id)
        } catch {
            /* 靜默 */
        }
        void load()
    }

    function openTodoCapture() {
        void window.electronAPI.todo.openCapture()
    }

    /** 到期文案:逾期 N 天 / 今天到期 / N 天後 / 無期限(按日曆日) */
    function dueText(due?: number | null): string {
        const d = dueDays(due ?? null, Date.now())
        if (d === null) return t('home.todoNoDue')
        if (d < 0) return t('home.todoOverdue', {n: -d})
        if (d === 0) return t('home.todoDueToday')
        return t('home.todoDueDays', {n: d})
    }

    /** 顏色等級 class:逾期紅 / 24h 內橙 / 其餘灰 */
    function dueClass(due?: number | null): string {
        return `lv-${dueLevel(due ?? null, Date.now())}`
    }

    const onChanged = () => void load()
    onMounted(() => {
        void load()
        window.electronAPI.on(IpcChannels.PUSH_TODO_CHANGED, onChanged)
    })
    onUnmounted(() => window.electronAPI.off(IpcChannels.PUSH_TODO_CHANGED, onChanged))

    return {todos, completeTodo, openTodoCapture, dueText, dueClass}
}
