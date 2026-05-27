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
} from '@shared/types/agent.types'

import type {AgentConfig, AgentMessage, ConversationSummary, ToolExecResult,} from '@shared/types/agent.types'

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
