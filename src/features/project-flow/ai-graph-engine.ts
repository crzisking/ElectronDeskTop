/**
 * AI 改圖純引擎 — 無任何副作用(不碰 API / DOM / x6),全部是可單測的決策邏輯。
 *
 * 三件事:
 *  1. orderOps           — 把 LLM 給的操作排成「安全套用順序」(先建後連、最後刪)
 *  2. computeNewNodePositions — 為本批新節點算畫布座標(LLM 不負責座標)
 *  3. diffToSnapshot     — 回退核心:當前圖 vs 快照 → 還原操作清單(刪多的、補缺的、改回變的)
 *
 * 為什麼抽純函數:回退是「直接套用、不預覽」模式下唯一的安全網,邏輯最易錯,
 * 必須能被單測釘死(對齊本專案「測試是給 AI 看的規格」標準)。執行(調後端 API)
 * 的髒活在 ai-graph-apply.ts,本檔只算「該做什麼」。
 */

import type {AiGraphOp, EdgeResponse, NodeResponse} from '@shared/types/project-flow.types'

/** 既有圖的最小快照(回退比對用) */
export interface GraphSnapshot {
    nodes: NodeResponse[]
    edges: EdgeResponse[]
}

/**
 * 回退計劃 — diffToSnapshot 的產物,描述「把當前圖還原成快照」要做哪些後端操作。
 * 執行順序固定:先拆線、再刪節點、重建缺失節點(拿到新 id)、重建缺失連線(端點 id 重映射)、最後改回欄位。
 */
export interface RestorePlan {
    /** 當前有、快照沒有的連線 → 刪(AI 新增的) */
    deleteEdgeIds: number[]
    /** 當前有、快照沒有的節點 → 刪(AI 新增的) */
    deleteNodeIds: number[]
    /** 快照有、當前沒有的節點 → 重建(AI 刪掉的);重建會拿到新 nodeId */
    recreateNodes: NodeResponse[]
    /** 快照有、當前沒有的連線 → 重建;端點是「快照(舊)nodeId」,執行時按重建映射換成新 id */
    recreateEdges: { sourceNodeId: number; targetNodeId: number; label?: string }[]
    /** 兩邊都在但欄位被改過的節點 → 用快照版本改回 */
    updateNodes: NodeResponse[]
}

/** 端點引用是不是「本批臨時 id」:字串且非純數字(純數字字串視為既有 nodeId) */
export function isTempRef(ref: number | string): boolean {
    return typeof ref === 'string' && !/^\d+$/.test(ref)
}

/**
 * 把 ops 排成安全套用順序,純函式不改入參:
 *   0 deleteEdge → 1 addNode → 2 addEdge → 3 updateNode → 4 deleteNode
 * 理由:先拆掉要刪的線;先有節點才能連;連線在刪節點之前完成(不會連到剛被刪的);
 * 刪節點放最後,避免中途把後面 updateNode/addEdge 依賴的節點刪掉。
 */
export function orderOps(ops: AiGraphOp[]): AiGraphOp[] {
    const rank: Record<AiGraphOp['op'], number> = {
        deleteEdge: 0, addNode: 1, addEdge: 2, updateNode: 3, deleteNode: 4,
    }
    // 穩定排序:同 rank 保持原順序(addNode 之間的先後 = LLM 給的先後,鏈式 after 才解析得到)
    return ops
        .map((op, i) => ({op, i}))
        .sort((a, b) => rank[a.op.op] - rank[b.op.op] || a.i - b.i)
        .map((x) => x.op)
}

const NODE_W = 140
const ROW_GAP = 90   // 縱向:父 → 子
const COL_GAP = 180  // 橫向:同一錨點的兄弟之間 / fallback 列

/**
 * 為本批 addNode 算座標。回 Map<tempId, {x,y}>。純函式、確定性(同輸入同輸出)。
 *
 * 規則:
 *  - after 指向「既有節點」→ 放其正下方(y+ROW_GAP);同一錨點多個子節點往右錯開(x+n*COL_GAP)。
 *  - after 指向「本批 tempId」→ 接在那個剛排好的新節點下方(支援鏈式 A→B→C)。
 *  - 無 after / 解析不到 → 放在現有節點最低點下方,依序往下/往右堆,避免重疊。
 */
export function computeNewNodePositions(
    ops: AiGraphOp[],
    nodes: NodeResponse[],
): Map<string, { x: number; y: number }> {
    const posById = new Map<number, { x: number; y: number }>()
    for (const n of nodes) posById.set(n.nodeId, {x: n.positionX, y: n.positionY})

    // fallback 起點:現有節點最低處下方;空圖給個舒服的左上角
    const originX = nodes.length ? Math.min(...nodes.map((n) => n.positionX)) : 120
    const baseY = nodes.length ? Math.max(...nodes.map((n) => n.positionY)) + ROW_GAP : 60

    const result = new Map<string, { x: number; y: number }>()
    const siblingCount = new Map<string, number>() // 錨點 key → 已掛子節點數(橫向錯開)
    let fallbackIdx = 0

    for (const op of ops) {
        if (op.op !== 'addNode') continue
        let pos: { x: number; y: number } | null = null

        if (op.after !== undefined && op.after !== null) {
            const anchorKey = String(op.after)
            const base = isTempRef(op.after)
                ? result.get(String(op.after)) ?? null
                : posById.get(Number(op.after)) ?? null
            if (base) {
                const n = siblingCount.get(anchorKey) ?? 0
                siblingCount.set(anchorKey, n + 1)
                pos = {x: base.x + n * COL_GAP, y: base.y + ROW_GAP}
            }
        }

        if (!pos) {
            // 無錨點:在 fallback 列依序鋪開
            pos = {x: originX + fallbackIdx * COL_GAP, y: baseY}
            fallbackIdx++
        }

        result.set(op.tempId, pos)
    }
    return result
}

/**
 * 過濾 LLM 幻覺的操作(純函式)。LLM 可能引用不存在的 nodeId/edgeId,或用沒定義的 tempId 連線;
 * 這種 op 若送到後端會失敗、觸發整批回滾。先在這裡丟掉,讓有效的部分仍能套用。
 *
 * 規則:
 *  - addNode:保留;但 tempId 必須非空且本批唯一(重複的後者丟棄)。
 *  - updateNode / deleteNode:nodeId 必須是既有節點。
 *  - deleteEdge:edgeId 必須是既有連線。
 *  - addEdge:source/target 都要能解析(既有 nodeId,或本批已定義的 addNode tempId);不可自連。
 * 回 {ops: 保留的, dropped: 丟棄數}。
 */
export function sanitizeOps(
    ops: AiGraphOp[],
    nodes: { nodeId: number }[],
    edges: { edgeId: number }[],
): { ops: AiGraphOp[]; dropped: number } {
    const nodeIds = new Set(nodes.map((n) => n.nodeId))
    const edgeIds = new Set(edges.map((e) => e.edgeId))
    const tempIds = new Set<string>()
    const kept: AiGraphOp[] = []

    const refOk = (ref: number | string): boolean =>
        isTempRef(ref) ? tempIds.has(String(ref)) : nodeIds.has(Number(ref))

    for (const op of ops) {
        switch (op.op) {
            case 'addNode':
                if (!op.tempId || tempIds.has(op.tempId)) break
                tempIds.add(op.tempId)
                kept.push(op)
                continue
            case 'updateNode':
            case 'deleteNode':
                if (nodeIds.has(op.nodeId)) {
                    kept.push(op)
                    continue
                }
                break
            case 'deleteEdge':
                if (edgeIds.has(op.edgeId)) {
                    kept.push(op)
                    continue
                }
                break
            case 'addEdge':
                if (refOk(op.source) && refOk(op.target) && String(op.source) !== String(op.target)) {
                    kept.push(op)
                    continue
                }
                break
        }
    }
    return {ops: kept, dropped: ops.length - kept.length}
}

/** 解析 addEdge 端點:tempId → 重映射後的真實 nodeId;純數字 → 既有 nodeId。失敗回 null */
export function resolveRef(ref: number | string, tempIdMap: Map<string, number>): number | null {
    if (isTempRef(ref)) return tempIdMap.get(String(ref)) ?? null
    const n = Number(ref)
    return Number.isFinite(n) ? n : null
}

/** 節點上「使用者可改」的欄位是否與快照不同(只比這些,position 也算 —— AI 可能挪了節點) */
function nodeFieldsDiffer(a: NodeResponse, b: NodeResponse): boolean {
    return (
        a.title !== b.title ||
        a.status !== b.status ||
        (a.description ?? '') !== (b.description ?? '') ||
        (a.assigneeUserId ?? '') !== (b.assigneeUserId ?? '') ||
        (a.deadline ?? null) !== (b.deadline ?? null) ||
        a.priority !== b.priority ||
        a.positionX !== b.positionX ||
        a.positionY !== b.positionY
    )
}

/**
 * 回退核心(純函式):比對「當前圖」與「快照」,算出把當前還原成快照要做的操作清單。
 *
 * - 節點按 nodeId 比對:當前多的刪、快照多的重建、共有但欄位變的改回。
 * - 連線按 edgeId 比對:當前多的刪、快照多的重建。
 *   重建連線的端點用「快照 nodeId」;若該端點節點是被重建的(拿到新 id),執行層用映射換。
 *   注意:快照裡的連線端點必定是快照裡的節點 → 不會落在「被刪節點」上(被刪的都是 AI 新增、不在快照),所以安全。
 */
export function diffToSnapshot(current: GraphSnapshot, snapshot: GraphSnapshot): RestorePlan {
    const curNodeIds = new Set(current.nodes.map((n) => n.nodeId))
    const snapNodeById = new Map(snapshot.nodes.map((n) => [n.nodeId, n]))
    const curNodeById = new Map(current.nodes.map((n) => [n.nodeId, n]))

    const deleteNodeIds = current.nodes.filter((n) => !snapNodeById.has(n.nodeId)).map((n) => n.nodeId)
    const recreateNodes = snapshot.nodes.filter((n) => !curNodeIds.has(n.nodeId))
    const updateNodes = snapshot.nodes.filter((s) => {
        const c = curNodeById.get(s.nodeId)
        return c && nodeFieldsDiffer(c, s)
    })

    const curEdgeIds = new Set(current.edges.map((e) => e.edgeId))
    const snapEdgeIds = new Set(snapshot.edges.map((e) => e.edgeId))
    const deleteEdgeIds = current.edges.filter((e) => !snapEdgeIds.has(e.edgeId)).map((e) => e.edgeId)
    const recreateEdges = snapshot.edges
        .filter((e) => !curEdgeIds.has(e.edgeId))
        .map((e) => ({sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId, label: e.label}))

    return {deleteEdgeIds, deleteNodeIds, recreateNodes, recreateEdges, updateNodes}
}

export const __engineConst = {NODE_W, ROW_GAP, COL_GAP}
