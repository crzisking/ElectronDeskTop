import {describe, expect, it} from 'vitest'
import {
    computeNewNodePositions,
    diffToSnapshot,
    isTempRef,
    orderOps,
    resolveRef,
    sanitizeOps,
} from '@/features/project-flow/ai-graph-engine'
import type {AiGraphOp, EdgeResponse, NodeResponse} from '@shared/types/project-flow.types'

// 造一個 NodeResponse,只填關心的欄位,其餘給合理預設
function node(p: Partial<NodeResponse> & { nodeId: number }): NodeResponse {
    return {
        projectId: 1, title: `n${p.nodeId}`, status: 'not_started', priority: 0,
        positionX: 0, positionY: 0, width: 140, height: 48, nodeType: 'task',
        sortOrder: 0, updatedAt: 0, ...p,
    }
}

function edge(edgeId: number, source: number, target: number): EdgeResponse {
    return {edgeId, projectId: 1, sourceNodeId: source, targetNodeId: target}
}

describe('isTempRef(端點是臨時 id 還是既有 nodeId)', () => {
    it('純數字(字串或數字)= 既有 nodeId', () => {
        expect(isTempRef(42)).toBe(false)
        expect(isTempRef('42')).toBe(false)
    })
    it('非純數字字串 = 本批臨時 id', () => {
        expect(isTempRef('n1')).toBe(true)
        expect(isTempRef('temp-a')).toBe(true)
    })
})

describe('orderOps(安全套用順序:先建後連、最後刪)', () => {
    it('打亂的 ops 會排成 deleteEdge→addNode→addEdge→updateNode→deleteNode', () => {
        const ops: AiGraphOp[] = [
            {op: 'deleteNode', nodeId: 9},
            {op: 'addEdge', source: 'n1', target: 'n2'},
            {op: 'addNode', tempId: 'n1', title: 'A', nodeType: 'task'},
            {op: 'updateNode', nodeId: 5, title: 'X'},
            {op: 'deleteEdge', edgeId: 3},
            {op: 'addNode', tempId: 'n2', title: 'B', nodeType: 'test'},
        ]
        expect(orderOps(ops).map((o) => o.op)).toEqual([
            'deleteEdge', 'addNode', 'addNode', 'addEdge', 'updateNode', 'deleteNode',
        ])
    })

    it('同類 op 保持原順序(addNode 鏈式 after 才解析得到)', () => {
        const ops: AiGraphOp[] = [
            {op: 'addNode', tempId: 'first', title: 'A', nodeType: 'task'},
            {op: 'addNode', tempId: 'second', title: 'B', nodeType: 'task'},
        ]
        expect(orderOps(ops).map((o) => (o as { tempId: string }).tempId)).toEqual(['first', 'second'])
    })

    it('不改原陣列', () => {
        const ops: AiGraphOp[] = [{op: 'deleteNode', nodeId: 1}, {
            op: 'addNode',
            tempId: 't',
            title: 'A',
            nodeType: 'task'
        }]
        const copy = [...ops]
        orderOps(ops)
        expect(ops).toEqual(copy)
    })
})

describe('computeNewNodePositions(新節點座標)', () => {
    it('after 指既有節點 → 放其正下方', () => {
        const nodes = [node({nodeId: 1, positionX: 200, positionY: 100})]
        const ops: AiGraphOp[] = [{op: 'addNode', tempId: 'a', title: 'A', nodeType: 'task', after: 1}]
        const pos = computeNewNodePositions(ops, nodes)
        expect(pos.get('a')).toEqual({x: 200, y: 190}) // y+90
    })

    it('同一錨點的多個子節點橫向錯開', () => {
        const nodes = [node({nodeId: 1, positionX: 0, positionY: 0})]
        const ops: AiGraphOp[] = [
            {op: 'addNode', tempId: 'a', title: 'A', nodeType: 'task', after: 1},
            {op: 'addNode', tempId: 'b', title: 'B', nodeType: 'task', after: 1},
        ]
        const pos = computeNewNodePositions(ops, nodes)
        expect(pos.get('a')).toEqual({x: 0, y: 90})
        expect(pos.get('b')).toEqual({x: 180, y: 90}) // 第二個 +COL_GAP
    })

    it('鏈式 after 指向本批前一個新節點', () => {
        const nodes = [node({nodeId: 1, positionX: 0, positionY: 0})]
        const ops: AiGraphOp[] = [
            {op: 'addNode', tempId: 'a', title: 'A', nodeType: 'task', after: 1},
            {op: 'addNode', tempId: 'b', title: 'B', nodeType: 'task', after: 'a'},
        ]
        const pos = computeNewNodePositions(ops, nodes)
        expect(pos.get('a')).toEqual({x: 0, y: 90})
        expect(pos.get('b')).toEqual({x: 0, y: 180}) // 接在 a 下方
    })

    it('無 after → 落在現有節點最低處下方,依序往右鋪', () => {
        const nodes = [node({nodeId: 1, positionX: 50, positionY: 300})]
        const ops: AiGraphOp[] = [
            {op: 'addNode', tempId: 'a', title: 'A', nodeType: 'task'},
            {op: 'addNode', tempId: 'b', title: 'B', nodeType: 'task'},
        ]
        const pos = computeNewNodePositions(ops, nodes)
        expect(pos.get('a')).toEqual({x: 50, y: 390})  // originX=50, baseY=300+90
        expect(pos.get('b')).toEqual({x: 230, y: 390}) // +COL_GAP
    })

    it('空圖也能排(不靠現有節點)', () => {
        const ops: AiGraphOp[] = [{op: 'addNode', tempId: 'a', title: 'A', nodeType: 'start'}]
        const pos = computeNewNodePositions(ops, [])
        expect(pos.get('a')).toEqual({x: 120, y: 60})
    })
})

describe('resolveRef(端點 → 真實 nodeId)', () => {
    const map = new Map<string, number>([['n1', 1001]])
    it('tempId 透過映射換成新 id', () => {
        expect(resolveRef('n1', map)).toBe(1001)
    })
    it('既有 nodeId 原樣回', () => {
        expect(resolveRef(42, map)).toBe(42)
        expect(resolveRef('42', map)).toBe(42)
    })
    it('映射不到的 tempId → null', () => {
        expect(resolveRef('unknown', map)).toBeNull()
    })
})

describe('diffToSnapshot(回退核心:當前圖 → 還原成快照)', () => {
    it('AI 新增的節點/連線 → 回退時刪掉', () => {
        const snapshot = {nodes: [node({nodeId: 1})], edges: []}
        const current = {
            nodes: [node({nodeId: 1}), node({nodeId: 2})],
            edges: [edge(10, 1, 2)],
        }
        const plan = diffToSnapshot(current, snapshot)
        expect(plan.deleteNodeIds).toEqual([2])
        expect(plan.deleteEdgeIds).toEqual([10])
        expect(plan.recreateNodes).toEqual([])
        expect(plan.recreateEdges).toEqual([])
    })

    it('AI 刪掉的節點/連線 → 回退時重建(連線帶舊端點 id)', () => {
        const snapshot = {
            nodes: [node({nodeId: 1}), node({nodeId: 2})],
            edges: [edge(10, 1, 2)],
        }
        const current = {nodes: [node({nodeId: 1})], edges: []}
        const plan = diffToSnapshot(current, snapshot)
        expect(plan.recreateNodes.map((n) => n.nodeId)).toEqual([2])
        expect(plan.recreateEdges).toEqual([{sourceNodeId: 1, targetNodeId: 2, label: undefined}])
        expect(plan.deleteNodeIds).toEqual([])
    })

    it('AI 改了欄位 → 回退時用快照版本改回', () => {
        const snapshot = {nodes: [node({nodeId: 1, title: '原標題', status: 'not_started'})], edges: []}
        const current = {nodes: [node({nodeId: 1, title: 'AI改的', status: 'completed'})], edges: []}
        const plan = diffToSnapshot(current, snapshot)
        expect(plan.updateNodes).toHaveLength(1)
        expect(plan.updateNodes[0].title).toBe('原標題')
        expect(plan.updateNodes[0].status).toBe('not_started')
    })

    it('沒動過的節點不進 updateNodes', () => {
        const same = [node({nodeId: 1, title: 'X', positionX: 5, positionY: 6})]
        const plan = diffToSnapshot({nodes: same, edges: []}, {nodes: same.map((n) => ({...n})), edges: []})
        expect(plan.updateNodes).toEqual([])
    })

    it('位置被挪動也算改動(要還原座標)', () => {
        const snapshot = {nodes: [node({nodeId: 1, positionX: 0, positionY: 0})], edges: []}
        const current = {nodes: [node({nodeId: 1, positionX: 999, positionY: 999})], edges: []}
        const plan = diffToSnapshot(current, snapshot)
        expect(plan.updateNodes).toHaveLength(1)
        expect(plan.updateNodes[0].positionX).toBe(0)
    })

    it('混合場景:同時有新增、刪除、改動', () => {
        const snapshot = {
            nodes: [node({nodeId: 1, title: 'A'}), node({nodeId: 2, title: 'B'})],
            edges: [edge(10, 1, 2)],
        }
        const current = {
            nodes: [node({nodeId: 1, title: 'A改'}), node({nodeId: 3, title: 'C新增'})],
            edges: [edge(20, 1, 3)],
        }
        const plan = diffToSnapshot(current, snapshot)
        expect(plan.deleteNodeIds).toEqual([3])          // 3 是 AI 新增
        expect(plan.recreateNodes.map((n) => n.nodeId)).toEqual([2]) // 2 被 AI 刪
        expect(plan.updateNodes.map((n) => n.nodeId)).toEqual([1])   // 1 被改
        expect(plan.deleteEdgeIds).toEqual([20])
        expect(plan.recreateEdges).toEqual([{sourceNodeId: 1, targetNodeId: 2, label: undefined}])
    })

    it('完全沒變 → 空計劃(冪等)', () => {
        const g = {nodes: [node({nodeId: 1})], edges: [edge(10, 1, 1)]}
        const plan = diffToSnapshot({nodes: [node({nodeId: 1})], edges: [edge(10, 1, 1)]}, g)
        expect(plan).toEqual({
            deleteEdgeIds: [], deleteNodeIds: [], recreateNodes: [], recreateEdges: [], updateNodes: [],
        })
    })
})

describe('sanitizeOps(丟棄 LLM 幻覺的操作)', () => {
    const nodes = [{nodeId: 1}, {nodeId: 2}]
    const edges = [{edgeId: 10}]

    it('updateNode/deleteNode 引用不存在的節點 → 丟', () => {
        const ops: AiGraphOp[] = [
            {op: 'updateNode', nodeId: 1, title: 'ok'},
            {op: 'updateNode', nodeId: 999, title: '幻覺'},
            {op: 'deleteNode', nodeId: 888},
        ]
        const r = sanitizeOps(ops, nodes, edges)
        expect(r.ops).toHaveLength(1)
        expect(r.dropped).toBe(2)
    })

    it('deleteEdge 引用不存在的連線 → 丟', () => {
        const r = sanitizeOps([{op: 'deleteEdge', edgeId: 999}], nodes, edges)
        expect(r.ops).toEqual([])
        expect(r.dropped).toBe(1)
    })

    it('addEdge 端點解析得到(既有 nodeId + 本批 tempId)才保留', () => {
        const ops: AiGraphOp[] = [
            {op: 'addNode', tempId: 'a', title: 'A', nodeType: 'task'},
            {op: 'addEdge', source: 1, target: 'a'},      // 既有→新 ✓
            {op: 'addEdge', source: 'a', target: 'ghost'}, // 指向未定義 tempId ✗
            {op: 'addEdge', source: 7, target: 1},         // 來源不存在 ✗
        ]
        const r = sanitizeOps(ops, nodes, edges)
        expect(r.ops.map((o) => o.op)).toEqual(['addNode', 'addEdge'])
        expect(r.dropped).toBe(2)
    })

    it('addEdge 自連(source===target)→ 丟', () => {
        const r = sanitizeOps([{op: 'addEdge', source: 1, target: 1}], nodes, edges)
        expect(r.ops).toEqual([])
    })

    it('重複 tempId → 後者丟棄', () => {
        const ops: AiGraphOp[] = [
            {op: 'addNode', tempId: 'a', title: 'A', nodeType: 'task'},
            {op: 'addNode', tempId: 'a', title: 'A2', nodeType: 'task'},
        ]
        const r = sanitizeOps(ops, nodes, edges)
        expect(r.ops).toHaveLength(1)
        expect(r.dropped).toBe(1)
    })
})
