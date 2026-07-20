/**
 * 想法庫列表狀態(docs/21):tab(我的/部門)+ 篩選 + 分頁 + 後台完善完成即時刷新。
 */
import {onMounted, onUnmounted, reactive, ref} from 'vue'
import {IpcChannels} from '@shared/ipc-channels'
import type {
    IdeaListItem,
    IdeaListQuery,
    IdeaRefineStatus,
    IdeaStatus,
    IdeaType,
} from '@/features/idea-capture/types'
import {ideaLibraryApi} from '../api'

const PAGE_SIZE = 30

export type IdeaTab = 'my' | 'dept'

export function useIdeaLibrary() {
    const tab = ref<IdeaTab>('my')
    const items = ref<IdeaListItem[]>([])
    const total = ref(0)
    const pageIndex = ref(1)
    const loading = ref(false)
    const error = ref('')

    const filters = reactive<{ status?: IdeaStatus; ideaType?: IdeaType; tag?: string }>({})

    function buildQuery(): IdeaListQuery {
        return {
            pageIndex: pageIndex.value,
            pageSize: PAGE_SIZE,
            status: filters.status,
            ideaType: filters.ideaType,
            tag: filters.tag?.trim() || undefined,
        }
    }

    async function load() {
        loading.value = true
        error.value = ''
        try {
            const res = tab.value === 'my'
                ? await ideaLibraryApi.listMy(buildQuery())
                : await ideaLibraryApi.listDept(buildQuery())
            // 攔截器對「業務碼非 200」只彈 toast 不拋錯 → res 可能是 undefined,做兜底
            items.value = res?.list ?? []
            total.value = res?.total ?? 0
        } catch (e) {
            error.value = (e as Error).message
            items.value = []
            total.value = 0
        } finally {
            loading.value = false
        }
    }

    function switchTab(next: IdeaTab) {
        if (tab.value === next) return
        tab.value = next
        pageIndex.value = 1
        void load()
    }

    function applyFilters() {
        pageIndex.value = 1
        void load()
    }

    function goPage(p: number) {
        pageIndex.value = p
        void load()
    }

    // 後台完善完成 → 就地更新該卡的 AI 徽章(頁開著才收得到;主窗最小化時下次進頁重查)
    function onRefined(...args: unknown[]) {
        const p = args[0] as { clientId: string; refineStatus: IdeaRefineStatus }
        const it = items.value.find((x) => x.clientId === p.clientId)
        if (it) it.refineStatus = p.refineStatus
    }

    // 速記小窗新增了一筆(跨窗)→ 重載當前列表,不用跳頁
    function onCreated() {
        void load()
    }

    onMounted(() => {
        window.electronAPI.on(IpcChannels.IDEA_PUSH_REFINED, onRefined)
        window.electronAPI.on(IpcChannels.IDEA_PUSH_CREATED, onCreated)
        void load()
    })
    onUnmounted(() => {
        window.electronAPI.off(IpcChannels.IDEA_PUSH_REFINED, onRefined)
        window.electronAPI.off(IpcChannels.IDEA_PUSH_CREATED, onCreated)
    })

    return {tab, items, total, pageIndex, loading, error, filters, PAGE_SIZE, load, switchTab, applyFilters, goPage}
}

// ── 顯示用文案 ──
export const STATUS_LABEL: Record<IdeaStatus, string> = {
    inbox: '待整理', accepted: '採納', done: '已落實', archived: '歸檔',
}
export const TYPE_LABEL: Record<IdeaType, string> = {
    improve: '改進點', issue: '問題', inspiration: '靈感', todo: '待辦',
}
export const REFINE_LABEL: Partial<Record<IdeaRefineStatus, string>> = {
    pending: 'AI整理中…', done: '✨AI版', failed: '完善失敗',
}
