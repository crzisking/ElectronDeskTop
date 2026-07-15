/**
 * Agent 權限彈框(Stage 2)—— 工具要執行時,依 ask 規則問使用者。
 * 訂閱 AGENT_PUSH_PERMISSION_ASK,收到就開彈框;使用者決定後回覆主進程。
 */
import {computed, onMounted, onUnmounted, ref} from 'vue'
import {IpcChannels} from '@shared/ipc-channels'
import {agentApi} from '../api'
import type {PermReq} from '../types'

export function useAgentPermissions() {
    const pendingPerm = ref<PermReq | null>(null)

    const alwaysLabel = computed(() => {
        const p = pendingPerm.value
        if (!p) return ''
        return p.tool === 'bash' ? p.suggestedPattern : p.tool
    })

    function onPermissionAsk(...args: unknown[]) {
        pendingPerm.value = args[0] as PermReq
    }

    /** decision: allow-once / allow-always / deny-once / deny-always */
    function respondPerm(decision: string) {
        const p = pendingPerm.value
        if (!p) return
        const pattern = decision.endsWith('always') ? p.suggestedPattern : undefined
        void agentApi.permissionRespond(p.approvalId, decision, pattern)
        pendingPerm.value = null
    }

    onMounted(() => window.electronAPI.on(IpcChannels.AGENT_PUSH_PERMISSION_ASK, onPermissionAsk))
    onUnmounted(() => window.electronAPI.off(IpcChannels.AGENT_PUSH_PERMISSION_ASK, onPermissionAsk))

    return {pendingPerm, alwaysLabel, respondPerm}
}
