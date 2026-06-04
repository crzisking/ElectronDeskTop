/**
 * LLM 共用層 barrel — 對外只暴露 client + 兩種錯誤型別 + DTO。
 *
 * 呼叫端 import 走這條:
 *   import {LlmClient, LlmConfigError, LlmCallError} from '@main/services/llm'
 */

export {
    LlmClient,
    LlmConfigError,
    LlmCallError,
} from './client'
export type {
    LlmMessage,
    LlmCompleteOptions,
    LlmCompleteResult,
    LlmStreamEvent,
} from './client'
