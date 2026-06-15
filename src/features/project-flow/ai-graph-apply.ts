/**
 * AI 改圖執行器(渲染端,有副作用)— 把純引擎算出的「該做什麼」真正調後端做掉。
 *
 *  - applyAiPlan        :過濾幻覺 → 排序 → 算座標 → 逐操作打後端,建 tempId→真實 nodeId 映射。
 *  - reconcileToSnapshot:回退 / 失敗回滾 —— diffToSnapshot 算出還原計劃後逐步執行,
 *                         重建節點時建「舊 id → 新 id」映射,讓重建的連線端點對得上。
 *
 * 設計:任何單步失敗就往上拋,由 caller 走「refetch 真實狀態 → reconcileToSnapshot 回到快照」收尾,
 * 確保不留半套用爛狀態(直接套用模式下,這是唯一安全網)。決策邏輯全在 ai-graph-engine(已單測)。
 */

import {projectFlowApi} from './api'
import {
    computeNewNodePositions,
    diffToSnapshot,
    type GraphSnapshot,
    orderOps,
    resolveRef,
    sanitizeOps,
} from './ai-graph-engine'
import type {AiGraphOp, NodeResponse} from './types'

export interface ApplyResult {
    /** 實際送到後端執行的操作數 */
    applied: number
    /** 被當作幻覺丟棄的操作數(引用不存在的 id / tempId 等) */
    dropped: number
}

/**
 * 套用 AI 操作清單到後端。失敗往上拋(caller 負責回滾到快照)。
 * @param current 套用前的當前圖,供 sanitize(對齊真實 id)+ 排版參考
 */
export async function applyAiPlan(
    projectId: number,
    rawOps: AiGraphOp[],
    current: GraphSnapshot,
): Promise<ApplyResult> {
    const {ops, dropped} = sanitizeOps(rawOps, current.nodes, current.edges)
    const ordered = orderOps(ops)
    const positions = computeNewNodePositions(ordered, current.nodes)
    const tempIdMap = new Map<string, number>() // tempId → 後端真實 nodeId

    for (const op of ordered) {
        switch (op.op) {
            case 'addNode': {
                const pos = positions.get(op.tempId) ?? {x: 120, y: 120}
                const r = await projectFlowApi.createNode(projectId, {
                    title: op.title,
                    nodeType: op.nodeType,
                    positionX: pos.x,
                    positionY: pos.y,
                    ...(op.description ? {description: op.description} : {}),
                })
                tempIdMap.set(op.tempId, r.nodeId)
                break
            }
            case 'addEdge': {
                const src = resolveRef(op.source, tempIdMap)
                const tgt = resolveRef(op.target, tempIdMap)
                if (src == null || tgt == null) break // sanitize 已過濾,保險
                await projectFlowApi.createEdge(projectId, {sourceNodeId: src, targetNodeId: tgt})
                break
            }
            case 'updateNode': {
                const body: Record<string, unknown> = {}
                if (op.title !== undefined) body.title = op.title
                if (op.description !== undefined) body.description = op.description
                if (op.assigneeUserId !== undefined) body.assigneeUserId = op.assigneeUserId
                if (op.priority !== undefined) body.priority = op.priority
                if (Object.keys(body).length) await projectFlowApi.updateNode(op.nodeId, body)
                // 狀態走專屬端點(會寫 NodeProgress 時間線)
                if (op.status !== undefined) await projectFlowApi.patchNodeStatus(op.nodeId, {status: op.status})
                break
            }
            case 'deleteNode':
                await projectFlowApi.deleteNode(op.nodeId)
                break
            case 'deleteEdge':
                await projectFlowApi.deleteEdge(op.edgeId)
                break
        }
    }

    return {applied: ordered.length, dropped}
}

/** 重建一個節點(含還原非預設欄位);回 {oldId, newId} 供連線端點重映射 */
async function recreateNode(projectId: number, n: NodeResponse): Promise<{ oldId: number; newId: number }> {
    const r = await projectFlowApi.createNode(projectId, {
        title: n.title,
        nodeType: n.nodeType,
        positionX: n.positionX,
        positionY: n.positionY,
        ...(n.description ? {description: n.description} : {}),
    })
    const newId = r.nodeId
    const body: Record<string, unknown> = {}
    if (n.assigneeUserId) body.assigneeUserId = n.assigneeUserId
    if (n.priority) body.priority = n.priority
    if (n.deadline != null) body.deadlineMs = n.deadline // 後端更新欄位是 deadlineMs
    if (Object.keys(body).length) await projectFlowApi.updateNode(newId, body)
    if (n.status && n.status !== 'not_started') await projectFlowApi.patchNodeStatus(newId, {status: n.status})
    return {oldId: n.nodeId, newId}
}

/**
 * 把當前圖還原成快照(回退 / 失敗回滾通用)。
 * @param current 當前真實圖(caller 應先 refetch 拿到最新,再傳進來)
 * @param snapshot 要還原到的目標(套用前存的快照)
 */
export async function reconcileToSnapshot(
    projectId: number,
    current: GraphSnapshot,
    snapshot: GraphSnapshot,
): Promise<void> {
    const plan = diffToSnapshot(current, snapshot)

    // 1. 先拆 AI 新增的連線,再刪 AI 新增的節點
    for (const edgeId of plan.deleteEdgeIds) await projectFlowApi.deleteEdge(edgeId)
    for (const nodeId of plan.deleteNodeIds) await projectFlowApi.deleteNode(nodeId)

    // 2. 重建 AI 刪掉的節點,記錄舊→新 id 映射
    const idMap = new Map<number, number>()
    for (const n of plan.recreateNodes) {
        const {oldId, newId} = await recreateNode(projectId, n)
        idMap.set(oldId, newId)
    }

    // 3. 重建 AI 刪掉的連線,端點按映射換(節點沒被重建的端點 id 不變)
    for (const e of plan.recreateEdges) {
        await projectFlowApi.createEdge(projectId, {
            sourceNodeId: idMap.get(e.sourceNodeId) ?? e.sourceNodeId,
            targetNodeId: idMap.get(e.targetNodeId) ?? e.targetNodeId,
        })
    }

    // 4. 把被改過欄位的節點改回快照值
    for (const n of plan.updateNodes) {
        await projectFlowApi.updateNode(n.nodeId, {
            title: n.title,
            description: n.description ?? '',
            assigneeUserId: n.assigneeUserId ?? '',
            priority: n.priority,
            positionX: n.positionX,
            positionY: n.positionY,
            deadlineMs: n.deadline ?? null,
        })
        await projectFlowApi.patchNodeStatus(n.nodeId, {status: n.status})
    }
}
