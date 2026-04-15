/**
 * API 類型統一出口（Barrel）
 *
 * 此文件只做 re-export，不定義任何類型。
 * 按功能拆分到各子文件，從這裡統一導出以保持向下兼容：
 *
 *  auth.types.ts     — ApiError、LoginCredentials、LoginResponse、UserProfile
 *  ai.types.ts       — TextProcessRequest、SummarizeRequest、QaRequest、AiResponse
 *  business.types.ts — FlowNodeType、FlowNodeData、FlowEdgeData、Pipeline、BusinessOwner…
 *  repair.types.ts   — RepairAttachment、RepairCreateRequest、RepairListItem、RepairDetail…
 *
 * 新代碼建議直接從對應子文件導入，讓依賴關係更清晰：
 *   import type { UserProfile } from '@/types/auth.types'
 *   import type { RepairDetail } from '@/types/repair.types'
 *
 * 舊代碼仍可繼續從此文件導入，不需要改動：
 *   import type { UserProfile } from '@/types/api.types'   ← 仍然有效
 */

export * from './auth.types'
export * from './ai.types'
export * from './business.types'
export * from './repair.types'
