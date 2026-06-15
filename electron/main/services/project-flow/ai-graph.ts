/**
 * AI 改圖 — 自然語言需求 → 結構化操作清單(本地 LlmClient,不消耗後端配額)。
 *
 * 跟 ai-local.ts 同範式:json_object + safeParseJson;prompt 在 client(main)組裝。
 * 本檔只負責「LLM → 計劃」,不執行;執行(逐操作調後端 + 失敗回滾)在 renderer 的
 * ai-graph-apply.ts,身分/座標/幻覺過濾都在 renderer 對著權威圖(detail)做。
 *
 * 安全:LLM 產出可能引用不存在的 id 或亂用 nodeType,這裡只做基本形狀校正;
 * 語義過濾(sanitizeOps)交給 renderer,因為那邊握有當前圖的真實 id 集合。
 */

import type {LlmClient} from '../llm'
import type {AiGraphOp, AiGraphPlan} from '../../../shared/types/project-flow.types'
import {safeParseJson} from './ai-local'

/** renderer 傳來的當前圖(精簡欄位,夠 LLM 理解結構即可,不傳座標/描述省 token) */
export interface GraphPlanInput {
    instruction: string
    nodes: { nodeId: number; title: string; nodeType: string; status: string }[]
    edges: { edgeId: number; sourceNodeId: number; targetNodeId: number }[]
}

/** 節點類型清單(給 LLM 的詞彙表)— 與前端 NodeType / 畫布配色一致 */
const NODE_TYPE_HINT =
    'start(啟動) requirement(需求) design(設計) task(任務) test(測試) ' +
    'review(評審驗收) milestone(里程碑) finish(結項) decision(決策) risk(風險)'

const VALID_OPS = new Set(['addNode', 'updateNode', 'deleteNode', 'addEdge', 'deleteEdge'])

function graphText(input: GraphPlanInput): string {
    const nodeLines = input.nodes.length
        ? input.nodes.map((n) => `- #${n.nodeId} [${n.nodeType}/${n.status}] ${n.title}`).join('\n')
        : '(目前沒有節點)'
    const edgeLines = input.edges.length
        ? input.edges.map((e) => `- #${e.edgeId}: ${e.sourceNodeId} → ${e.targetNodeId}`).join('\n')
        : '(目前沒有連線)'
    return `節點:\n${nodeLines}\n\n連線(來源 → 目標):\n${edgeLines}`
}

export async function generateGraphPlan(
    llm: LlmClient | null,
    input: GraphPlanInput,
): Promise<AiGraphPlan> {
    if (!llm) throw new Error('LLM provider 尚未配置(請先到設定頁設定)')
    if (!input.instruction?.trim()) throw new Error('請描述你想怎麼改這個流程圖')

    const result = await llm.complete({
        responseFormat: 'json_object',
        temperature: 0.2, // 改圖要穩,別發散
        messages: [
            {
                role: 'system',
                content:
                    '你是項目流程圖編輯助手。根據使用者的自然語言需求,把對流程圖的修改拆成一串結構化操作(JSON)。\n' +
                    '規則:\n' +
                    `1. nodeType 只能用:${NODE_TYPE_HINT}。\n` +
                    '2. 新增節點用 addNode,給一個本批唯一的 tempId(如 "n1");要連到剛新增的節點時,addEdge 端點填該 tempId。\n' +
                    '3. 既有節點/連線一律用它們的數字 id(nodeId / edgeId),絕不要發明 id;只對「目前圖裡存在的」做 update/delete。\n' +
                    '4. 不要輸出座標(系統自動排版);用 after 提示新節點接在哪個節點之後(填既有 nodeId 或本批 tempId)。\n' +
                    '5. 改動要最小、精準貼合需求,不要自作主張加無關節點。看不懂或無法執行就回空 ops。\n' +
                    '只輸出 JSON,不要解釋。',
            },
            {
                role: 'user',
                content:
                    `目前流程圖:\n${graphText(input)}\n\n我的需求:${input.instruction.trim()}\n\n` +
                    '回 JSON:{"summary":"一句話中文總結這批改動","ops":[...]}\n' +
                    'ops 每條是下列之一:\n' +
                    '{"op":"addNode","tempId":"n1","title":"標題","nodeType":"task","description":"可省","after":既有nodeId或tempId或省略}\n' +
                    '{"op":"updateNode","nodeId":1,"title":"可省","status":"可省(not_started/in_progress/blocked/completed/cancelled)","description":"可省","assigneeUserId":"可省","priority":可省0-2}\n' +
                    '{"op":"deleteNode","nodeId":1}\n' +
                    '{"op":"addEdge","source":既有nodeId或tempId,"target":既有nodeId或tempId}\n' +
                    '{"op":"deleteEdge","edgeId":10}',
            },
        ],
    })

    const parsed = safeParseJson<{ summary?: string; ops?: unknown }>(result.content, 'graph-plan')
    const rawOps = Array.isArray(parsed.ops) ? parsed.ops : []
    // 基本形狀過濾:必須是物件且 op 在白名單內(語義/id 過濾在 renderer)
    const ops = rawOps.filter(
        (o): o is AiGraphOp => !!o && typeof o === 'object' && VALID_OPS.has((o as { op?: string }).op ?? ''),
    )
    return {summary: typeof parsed.summary === 'string' ? parsed.summary : '', ops}
}
