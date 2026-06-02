/**
 * 工作採集 — 動態 Prompt 組裝(docs/23 Phase A)。
 *
 * 模板移到 client 後,prompt 組裝邏輯從 server 搬到這裡。
 * tick 內讀 work_template_cache → buildSystemPrompt() → 透過 IPC 隨 jpeg 一起傳給 renderer →
 *   HTTP analyze 把 prompt + allowedCodes 帶上 → server 只當 AI 代理。
 *
 * SYSTEM_PROMPT 內容跟 server 端 WorkCollectService.systemPrompt 對齊(動的話兩邊一起改)。
 */

import type {CachedTemplateDetail} from './db/features/work-collect/template-cache.service'

/** 寫死的角色 + 原則指令,跟 server 端 systemPrompt 對齊 */
const SYSTEM_PROMPT = `你是一個企業級「工作任務意圖識別引擎」，專門從螢幕截圖與前台應用資訊中識別員工正在執行的具體工作任務。
你的輸出不是描述工具，而是判斷「正在進行的工作行為」。
---
## 一、核心任務
基於以下資訊進行判斷：
- 前台視窗標題
- 應用程式名稱
- 同時可見視窗
- 螢幕截圖內容（UI文字、表格、程式碼、文件內容）
推斷該使用者正在執行的「具體工作動作」。
---
## 二、關鍵原則（非常重要）
### 1. 禁止工具導向推理
不要因為看到 Excel / VSCode / Chrome 就直接分類。
必須分析「內容語義」，例如：
- Excel ≠ DataAnalysis（可能是填寫表單）
- Chrome ≠ Browsing（可能是填寫後台）
- VSCode ≠ Coding（可能是看log）
---
### 2. 必須基於證據
只允許使用畫面中可見資訊：
- 表格欄位名稱
- SQL / 程式碼
- 郵件標題
- ERP欄位
- 網頁標題
禁止推測公司、專案、客戶背景。
---
### 3. 不確定必須誠實
若資訊不足：
→ category = OTHER
→ confidence < 0.5
禁止硬分類。
---
## 三、輸出格式
description 必須描述「具體動作」，格式：
✔ 正在 + 動作 + 對象
例：
- 正在查詢ERP系統中的維修工單狀態
- 正在編輯Excel表格中的成本與庫存數據
禁止：
✘ 正在做數據分析
✘ 正在使用Excel
---
## 四、reason 規則
只描述「視覺證據」，不得推論業務背景。
---
## 五、confidence 規則
- 0.9~1.0：明確看到內容語義
- 0.6~0.8：部分可推斷
- <0.5：不確定，應標 OTHER
`

/**
 * 組完整 system prompt:寫死指令 + 動態業務分類塊。
 * 結果直接放進 analyze 請求的 `prompt` 欄位。
 */
export function buildSystemPrompt(tpl: CachedTemplateDetail): string {
    const lines: string[] = []
    lines.push('---')
    lines.push('## 業務分類約束(必須遵守)')
    lines.push(
        `目前分析對象屬於「${tpl.name}」崗位` +
        (tpl.description ? `(${tpl.description})` : '') +
        '。',
    )
    lines.push('此崗位的業務分類如下,請從中選一個填入 category 欄位:')
    lines.push('')

    // active items only,sortOrder asc
    const items = (tpl.items ?? [])
        .filter(i => i.isActive)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.itemId - b.itemId)

    for (const it of items) {
        lines.push(`- code: "${it.code}"`)
        lines.push(`  label: "${it.label}"`)
        if (it.description) lines.push(`  description: "${it.description}"`)
        if (it.examples && it.examples.length > 0) {
            const ex = it.examples
                .slice()
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map(e => `"${e.content}"`)
                .join(', ')
            lines.push(`  examples: [${ex}]`)
        }
        lines.push('')
    }
    lines.push('若畫面對應不到上述任何分類,category 填 "OTHER",description 自由說明實際在做什麼。')

    if (tpl.promptSnippet) {
        lines.push('')
        lines.push('補充指令:')
        lines.push(tpl.promptSnippet)
    }

    return SYSTEM_PROMPT + '\n\n' + lines.join('\n')
}

/**
 * 算 allowedCodes 白名單(模板 items.code + "OTHER")。
 * server 端 json_schema 的 category enum 由此生成。
 */
export function collectAllowedCodes(tpl: CachedTemplateDetail): string[] {
    const codes = new Set<string>()
    for (const it of tpl.items ?? []) {
        if (it.isActive) codes.add(it.code)
    }
    codes.add('OTHER')
    return [...codes]
}
