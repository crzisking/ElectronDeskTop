/**
 * Agent v2 系統提示組裝(docs/19)。
 *
 * 對齊 opencode 的 prompt builder 思路,按序拼:
 *   基礎 prompt(使用者可用 agent.systemPrompt 覆蓋)
 *   + 環境資訊(OS / 日期 / workspace / 目錄內容)
 *   + 專案規則(workspace 下的 AGENTS.md / CLAUDE.md / CONTEXT.md,取第一個)
 *
 * 我們單一 OpenAI 相容端點,不做 opencode 的「provider 專屬 prompt 檔」與 provider header;
 * 自訂 agent(.md)也留待後續。單一扎實的基礎 prompt 足夠。
 */

import {readdir, readFile} from 'fs/promises'
import {join} from 'path'
import {logger} from '../utils/logger'

const TAG = 'AgentPrompts'

/** 內建基礎 prompt(使用者未在設定覆蓋時用) */
export const BUILTIN_BASE = `你是「ichia AI 助理」,一個運行在使用者 Windows 電腦上的內部桌面工具 agent。

## 能力
你可以呼叫工具來實際完成任務,而不是只用文字回答:
- 檔案:read(讀)/ write(覆寫)/ edit(替換片段)
- 瀏覽:list(列目錄)/ glob(找檔)/ grep(搜內容)
- 系統:bash(執行 shell 命令)
- 網路:webfetch(抓網頁)/ websearch(搜尋)

## 做事原則
- 需要看檔案或環境時,先用工具查清楚再回答,不要臆測。
- 改檔前先 read;edit 的 oldString 要夠獨特以唯一命中。
- 一個任務可連續呼叫多個工具;完成後用簡短一段話總結你做了什麼、結果如何。
- 相對路徑一律相對下方「工作目錄」解析。

## 安全
- 危險命令(刪除 / 格式化 / 關機等)會被系統擋下,不要嘗試繞過。
- 不確定就說不確定,絕不編造檔案內容或指令輸出。

## 回答風格
- 用繁體中文,精簡、實事求是。
- 適當用 Markdown(清單 / 表格 / 程式碼區塊);程式碼標明語言。`

export interface PromptEnv {
    platform: string
    date: string
    /** 工作資料夾清單(第一個為主目錄) */
    workspaces: string[]
    /** 主目錄頂層內容(檔案 / 目錄名),供模型快速了解專案 */
    entries: string[]
}

/** 蒐集環境資訊(OS / 日期 / 工作資料夾 + 主目錄頂層內容) */
export async function gatherEnv(workspaces: string[]): Promise<PromptEnv> {
    const primary = workspaces[0] ?? ''
    let entries: string[] = []
    if (primary) {
        try {
            const list = await readdir(primary, {withFileTypes: true})
            entries = list.slice(0, 100).map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        } catch {
            /* 讀不了給空 */
        }
    }
    return {
        platform: process.platform,
        date: new Date().toISOString().slice(0, 10),
        workspaces,
        entries,
    }
}

/** 讀 workspace 下的專案規則檔(AGENTS.md → CLAUDE.md → CONTEXT.md,取第一個存在的) */
export async function readRules(workspace: string): Promise<string | undefined> {
    for (const name of ['AGENTS.md', 'CLAUDE.md', 'CONTEXT.md']) {
        try {
            const text = await readFile(join(workspace, name), 'utf-8')
            if (text.trim()) {
                logger.debug(`載入專案規則:${name}`, TAG)
                return text.trim()
            }
        } catch {
            /* 不存在,試下一個 */
        }
    }
    return undefined
}

/** 組裝最終 system prompt */
export function buildSystemPrompt(base: string, env: PromptEnv, rules?: string): string {
    const parts: string[] = [base.trim()]

    parts.push(
        [
            '# 環境',
            `- 作業系統:${env.platform}`,
            `- 今天日期:${env.date}`,
            `- 主工作目錄(相對路徑基準):${env.workspaces[0] ?? '(無)'}`,
            env.workspaces.length > 1
                ? `- 其他工作資料夾(可讀寫):\n${env.workspaces.slice(1).map((w) => `  - ${w}`).join('\n')}`
                : '',
            env.entries.length ? `- 主目錄內容:\n${env.entries.map((e) => `  - ${e}`).join('\n')}` : '- 主目錄目前是空的',
        ].filter(Boolean).join('\n'),
    )

    if (rules) {
        parts.push(`# 專案規則(來自規則檔,務必遵守)\n${rules}`)
    }

    return parts.join('\n\n')
}
