/**
 * 後端(tmbom)根位址 —— 單一來源,取代散在各 feature 的
 * `import.meta.env.VITE_WORK_COLLECT_API_URL ?? 'http://localhost:5247'` 重複字面量。
 *
 * 註:repair 歷史上用獨立的 VITE_REPAIR_API_URL(見 repair/api.ts),當前指向同一台 tmbom;
 *     其餘功能(work-collect / project-flow / idea-capture / auth context)統一走這個。
 */
export const BACKEND_BASE_URL: string =
    (import.meta.env.VITE_WORK_COLLECT_API_URL as string | undefined) ?? 'http://localhost:5247'
