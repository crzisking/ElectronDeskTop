/**
 * Agent 窗口內部型別 — 純 re-export 跨進程契約 + 全域 window.agentAPI 宣告。
 *
 * 型別本體在 `@shared/types/agent.types`,主進程與渲染端共用同一份,避免兩邊手動同步。
 * 本檔只負責:
 *   1. re-export 給 src/agent/** 內既有 import 路徑不用改
 *   2. 宣告 contextBridge 暴露的 `window.agentAPI` 介面(只在渲染端有意義)
 */

export type {
  AgentConfig,
  AgentMessage,
  OpenAIToolCall,
  ToolExecResult,
  ConversationSummary,
  ProviderConfig,
} from '@shared/types/agent.types'

import type {
  AgentConfig,
  AgentMessage,
  ConversationSummary,
  OpenAIToolCall,
  ToolExecResult,
} from '@shared/types/agent.types'

// ── 渲染端專屬:Message Block 模型(對應 doc 17 §2.2) ──────────────────
// 從 AgentMessage(平鋪 string + toolCalls 陣列)轉成的 view model,
// 讓 MessageRenderer 用 discriminated union 路由到對應 component。
//
// 為何只放在渲染端而不放進 @shared/types/:
//   - 純 view model,不參與 IPC 傳輸 / DB 落地
//   - 主進程不關心訊息怎麼分塊渲染
//   - 將來新增 block type(thinking / citation / mermaid ...)只動本檔,
//     不擴大 @shared/types/ 的契約面

/** 工具執行結果(渲染卡片用)— 對齊 AgentMessage.toolDisplay */
export interface ToolResult {
  ok: boolean
  /** 短預覽,< 400 字;screenshot 為 base64 dataURL */
  preview: string
}

export type MessageBlock =
    | { type: 'text'; content: string }
    | { type: 'tool_call'; toolCall: OpenAIToolCall; result?: ToolResult }
    // ↓ 預留 block type,目前 MessageRenderer 不路由;未來啟用時新增 component + v-else-if 即可
    | { type: 'thinking'; content: string }
    | { type: 'citation'; refs: Array<{ title: string; url: string; snippet: string }> }
    | { type: 'mermaid'; code: string }
    | { type: 'file'; url: string; mime: string }

declare global {
  interface Window {
    agentAPI: {
      execTool(name: string, args: Record<string, unknown>): Promise<ToolExecResult>
      readConfig(): Promise<AgentConfig>
      writeConfig(partial: AgentConfig): Promise<boolean>
      clearConfig(): Promise<boolean>
      listMessages(conversationId: string, limit?: number): Promise<AgentMessage[]>
      saveMessage(msg: AgentMessage): Promise<boolean>
      clearMessages(conversationId?: string): Promise<boolean>
      listConversations(): Promise<ConversationSummary[]>
    }
  }
}

export {}
