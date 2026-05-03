/**
 * API 類型統一出口（Barrel）
 *
 * 此文件只做 re-export，不定義任何類型。
 * 按功能拆分到各子文件，從這裡統一導出以保持向下兼容：
 *
 *  auth.types.ts     — ApiError、LoginCredentials、LoginResponse、UserProfile
 *  ai.types.ts       — TextProcessRequest、SummarizeRequest、QaRequest、AiResponse
 *  repair.types.ts   — RepairAttachment、RepairCreateRequest、RepairListItem、RepairDetail…
 */

export * from './auth.types'
export * from './ai.types'
export * from './repair.types'
