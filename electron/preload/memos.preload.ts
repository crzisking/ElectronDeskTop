/**
 * 備忘錄子視窗 preload。
 *
 * 暴露的能力:
 *   - electronAPI.projectFlow.*:跟主窗同一套 bridge,但所有方法的 ctx 參數可傳空,
 *     主進程 handler 會 fallback 到 main authContext(主窗登入時推進來)
 *   - electronAPI.on/off:訂閱 project-flow.* 推送(SignalR action 轉發),
 *     收到 feedback-new / 自身相關事件時主動 refresh
 *
 * ⚠️ channel 字串內聯不走 @shared/ipc-channels:
 *   sandbox: true 下 Electron 不解析 chunks/;3 個 preload 共用模組會被 Rollup 抽 chunk。
 *   照 log-viewer / floating-ball 同樣處理。
 *
 * **必須跟 electron/shared/ipc-channels/project-flow.ts 對齊**(常數是 'pf:*' 前綴)。
 * 哪裡改了那邊也要動。
 */

import {contextBridge, ipcRenderer} from 'electron'

const IPC = {
    // 對齊 ProjectFlowChannels(electron/shared/ipc-channels/project-flow.ts)
    PF_LIST_PROJECTS: 'pf:list-projects',
    PF_GET_PROJECT: 'pf:get-project',
    PF_CREATE_PROJECT: 'pf:create-project',
    PF_UPDATE_PROJECT: 'pf:update-project',
    PF_DELETE_PROJECT: 'pf:delete-project',
    PF_CREATE_NODE: 'pf:create-node',
    PF_UPDATE_NODE: 'pf:update-node',
    PF_DELETE_NODE: 'pf:delete-node',
    PF_PATCH_NODE_STATUS: 'pf:patch-node-status',
    PF_GET_NODE_PROGRESS: 'pf:get-node-progress',
    PF_LIST_NODE_REPORT_ITEMS: 'pf:list-node-report-items',
    PF_CREATE_EDGE: 'pf:create-edge',
    PF_UPDATE_EDGE: 'pf:update-edge',
    PF_DELETE_EDGE: 'pf:delete-edge',
    PF_LIST_REPORTS: 'pf:list-reports',
    PF_GET_REPORT: 'pf:get-report',
    PF_CREATE_REPORT: 'pf:create-report',
    PF_UPDATE_REPORT: 'pf:update-report',
    PF_SUBMIT_REPORT: 'pf:submit-report',
    PF_DELETE_REPORT: 'pf:delete-report',
    PF_LIST_MEMOS: 'pf:list-memos',
    PF_CREATE_MEMO: 'pf:create-memo',
    PF_UPDATE_MEMO: 'pf:update-memo',
    PF_SET_MEMO_STATUS: 'pf:set-memo-status',
    PF_DELETE_MEMO: 'pf:delete-memo',
    PF_CREATE_FEEDBACK: 'pf:create-feedback',
    PF_LIST_FEEDBACK_BY_TARGET: 'pf:list-feedback-by-target',
    PF_LIST_MY_UNREAD: 'pf:list-my-unread',
    PF_COUNT_MY_UNREAD: 'pf:count-my-unread',
    PF_MARK_FEEDBACK_READ: 'pf:mark-feedback-read',
    PF_LIST_SUBORDINATES: 'pf:list-subordinates',
    PF_LIST_SUB_REPORTS: 'pf:list-sub-reports',
    PF_LIST_SUB_MEMOS: 'pf:list-sub-memos',
    PF_AI_PROJECT_SUMMARY: 'pf:ai-project-summary',
    PF_AI_TEAM_SUMMARY: 'pf:ai-team-summary',
    PF_AI_QUOTA: 'pf:ai-quota',
    PF_MY_NODES: 'pf:my-nodes',
    PF_AI_REPORT_ADVICE: 'pf:ai-report-advice',
    PF_AI_MEMO_SUGGEST: 'pf:ai-memo-suggest',

    PUSH_PROJECT_FLOW_EVENT: 'push:project-flow-event',
} as const

const ALLOWED_PUSH_CHANNELS: readonly string[] = [IPC.PUSH_PROJECT_FLOW_EVENT]

// 對齊主窗 bridge 的 envelope:{ok:true, data}|{ok:false, error}
type Ok<T> = { ok: true; data: T }
type Err = { ok: false; error: string }
type Result<T> = Ok<T> | Err

/**
 * 不需要 ctx — 主進程 handler 會 fallback 到 main authContext。
 * 仍把 ctx 留作 stub 物件傳遞,符合既有 handler 解析格式。
 */
const c = <T = unknown>(action: string, args: object = {}) =>
    ipcRenderer.invoke(action, {ctx: undefined, ...args}) as Promise<Result<T>>

const listenerMap = new WeakMap<(...a: unknown[]) => void, (e: Electron.IpcRendererEvent, ...a: unknown[]) => void>()

contextBridge.exposeInMainWorld('electronAPI', {
    projectFlow: {
        listProjects: (_ctx: unknown, query: object) => c(IPC.PF_LIST_PROJECTS, {query}),
        getProject: (_ctx: unknown, projectId: number) => c(IPC.PF_GET_PROJECT, {projectId}),
        createProject: (_ctx: unknown, body: object) => c(IPC.PF_CREATE_PROJECT, {body}),
        updateProject: (_ctx: unknown, projectId: number, body: object) => c(IPC.PF_UPDATE_PROJECT, {projectId, body}),
        deleteProject: (_ctx: unknown, projectId: number) => c(IPC.PF_DELETE_PROJECT, {projectId}),

        createNode: (_ctx: unknown, projectId: number, body: object) => c(IPC.PF_CREATE_NODE, {projectId, body}),
        updateNode: (_ctx: unknown, nodeId: number, body: object) => c(IPC.PF_UPDATE_NODE, {nodeId, body}),
        deleteNode: (_ctx: unknown, nodeId: number) => c(IPC.PF_DELETE_NODE, {nodeId}),
        patchNodeStatus: (_ctx: unknown, nodeId: number, body: object) => c(IPC.PF_PATCH_NODE_STATUS, {nodeId, body}),
        getNodeProgress: (_ctx: unknown, nodeId: number) => c(IPC.PF_GET_NODE_PROGRESS, {nodeId}),
        listNodeReportItems: (_ctx: unknown, nodeId: number) => c(IPC.PF_LIST_NODE_REPORT_ITEMS, {nodeId}),

        createEdge: (_ctx: unknown, projectId: number, body: object) => c(IPC.PF_CREATE_EDGE, {projectId, body}),
        updateEdge: (_ctx: unknown, edgeId: number, body: object) => c(IPC.PF_UPDATE_EDGE, {edgeId, body}),
        deleteEdge: (_ctx: unknown, edgeId: number) => c(IPC.PF_DELETE_EDGE, {edgeId}),

        listReports: (_ctx: unknown, query: object) => c(IPC.PF_LIST_REPORTS, {query}),
        getReport: (_ctx: unknown, reportId: number) => c(IPC.PF_GET_REPORT, {reportId}),
        createReport: (_ctx: unknown, body: object) => c(IPC.PF_CREATE_REPORT, {body}),
        updateReport: (_ctx: unknown, reportId: number, body: object) => c(IPC.PF_UPDATE_REPORT, {reportId, body}),
        submitReport: (_ctx: unknown, reportId: number) => c(IPC.PF_SUBMIT_REPORT, {reportId}),
        deleteReport: (_ctx: unknown, reportId: number) => c(IPC.PF_DELETE_REPORT, {reportId}),

        listMemos: (_ctx: unknown, query: object) => c(IPC.PF_LIST_MEMOS, {query}),
        createMemo: (_ctx: unknown, body: object) => c(IPC.PF_CREATE_MEMO, {body}),
        updateMemo: (_ctx: unknown, memoId: number, body: object) => c(IPC.PF_UPDATE_MEMO, {memoId, body}),
        setMemoStatus: (_ctx: unknown, memoId: number, body: object) => c(IPC.PF_SET_MEMO_STATUS, {memoId, body}),
        deleteMemo: (_ctx: unknown, memoId: number) => c(IPC.PF_DELETE_MEMO, {memoId}),

        createFeedback: (_ctx: unknown, body: object) => c(IPC.PF_CREATE_FEEDBACK, {body}),
        listFeedbackByTarget: (_ctx: unknown, targetType: string, targetId: number) =>
            c(IPC.PF_LIST_FEEDBACK_BY_TARGET, {targetType, targetId}),
        listMyUnread: (_ctx: unknown) => c(IPC.PF_LIST_MY_UNREAD, {}),
        countMyUnread: (_ctx: unknown) => c(IPC.PF_COUNT_MY_UNREAD, {}),
        markFeedbackRead: (_ctx: unknown, feedbackId: number) => c(IPC.PF_MARK_FEEDBACK_READ, {feedbackId}),

        listSubordinates: (_ctx: unknown) => c(IPC.PF_LIST_SUBORDINATES, {}),
        listSubReports: (_ctx: unknown, userId: string, query: object) =>
            c(IPC.PF_LIST_SUB_REPORTS, {userId, query}),
        listSubMemos: (_ctx: unknown, userId: string) => c(IPC.PF_LIST_SUB_MEMOS, {userId}),

        aiProjectSummary: (_ctx: unknown, body: object) => c(IPC.PF_AI_PROJECT_SUMMARY, {body}),
        aiTeamSummary: (_ctx: unknown, body: object) => c(IPC.PF_AI_TEAM_SUMMARY, {body}),
        getQuota: (_ctx: unknown) => c(IPC.PF_AI_QUOTA, {}),
        listMyNodes: (_ctx: unknown) => c(IPC.PF_MY_NODES, {}),
        aiReportAdvice: (_ctx: unknown, body: object) => c(IPC.PF_AI_REPORT_ADVICE, {body}),
        aiMemoSuggest: (_ctx: unknown, body: object) => c(IPC.PF_AI_MEMO_SUGGEST, {body}),
    },

    /** 訂閱主進程推送(目前只白名單 project-flow 事件) */
    on(channel: string, callback: (...args: unknown[]) => void) {
        if (!ALLOWED_PUSH_CHANNELS.includes(channel)) return
        const existing = listenerMap.get(callback)
        if (existing) ipcRenderer.off(channel, existing)
        const wrapper = (_e: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args)
        listenerMap.set(callback, wrapper)
        ipcRenderer.on(channel, wrapper)
    },
    off(channel: string, callback: (...args: unknown[]) => void) {
        const wrapper = listenerMap.get(callback)
        if (wrapper) {
            ipcRenderer.off(channel, wrapper)
            listenerMap.delete(callback)
        }
    },
})
