/**
 * Agent 工具註冊中心。
 *
 * 每個工具自包含三件事(對標設計文件 §4.1):
 *   - definition:OpenAI Function Calling JSON schema(LLM 看到的能力描述)
 *   - location:'renderer' 直接執行 / 'main' 走 IPC
 *   - execute:實際產生副作用的函式
 *
 * 設計取捨:
 *  - 工具數量 ≤ 10,全部硬編碼;不做動態註冊或權限矩陣
 *  - description 字串會直接餵給 LLM,需精心撰寫
 */

import type {ToolExecResult} from './types'

type ToolLocation = 'renderer' | 'main'

interface ToolDefinition {
    type: 'function'
    function: {
        name: string
        description: string
        parameters: Record<string, unknown>
    }
}

export interface AgentTool {
    definition: ToolDefinition
    location: ToolLocation
    /** location='renderer' 時直接執行;'main' 時忽略,由 dispatcher 走 IPC */
    execute?: (args: Record<string, unknown>) => Promise<ToolExecResult> | ToolExecResult
}

// ── 工具註冊 ──────────────────────────────────────────────────────

export const AGENT_TOOLS: AgentTool[] = [
    {
        location: 'main',
        definition: {
            type: 'function',
            function: {
                name: 'open_app',
                description: '在 Windows 上開啟一個應用程式或檔案。傳入應用名稱(notepad / calc / explorer)或完整路徑。',
                parameters: {
                    type: 'object',
                    properties: {
                        appPath: {
                            type: 'string',
                            description: '應用名稱或可執行檔完整路徑,例:notepad、calc、C:\\Windows\\System32\\notepad.exe'
                        },
                    },
                    required: ['appPath'],
                },
            },
        },
    },
    {
        location: 'main',
        definition: {
            type: 'function',
            function: {
                name: 'read_file',
                description: '讀取指定路徑的文字檔內容(UTF-8)。內容超過 4000 字元會被截斷。',
                parameters: {
                    type: 'object',
                    properties: {
                        path: {type: 'string', description: '檔案的完整路徑,使用 Windows 反斜線格式'},
                    },
                    required: ['path'],
                },
            },
        },
    },
    {
        location: 'main',
        definition: {
            type: 'function',
            function: {
                name: 'write_file',
                description: '寫入文字內容到指定檔案(UTF-8)。父目錄會自動建立。會直接覆寫既有檔案,執行前請先和使用者確認。',
                parameters: {
                    type: 'object',
                    properties: {
                        path: {type: 'string', description: '目標檔案完整路徑'},
                        content: {type: 'string', description: '要寫入的文字內容'},
                    },
                    required: ['path', 'content'],
                },
            },
        },
    },
    {
        location: 'main',
        definition: {
            type: 'function',
            function: {
                name: 'list_files',
                description: '列出目錄下的檔案與子目錄,每行一個項目,[DIR] 開頭代表子目錄。',
                parameters: {
                    type: 'object',
                    properties: {
                        path: {type: 'string', description: '目錄的完整路徑'},
                    },
                    required: ['path'],
                },
            },
        },
    },
    {
        location: 'main',
        definition: {
            type: 'function',
            function: {
                name: 'run_command',
                description: '執行命令列指令(execFile 風格,非 shell)。timeout 15 秒,輸出超過 3000 字元會被截斷。需要 shell 特性(管線/重定向)時用 cmd.exe + ["/c", "命令"] 包裝。',
                parameters: {
                    type: 'object',
                    properties: {
                        command: {type: 'string', description: '可執行檔名稱或路徑,例:cmd.exe、powershell.exe、git'},
                        args: {
                            type: 'array',
                            items: {type: 'string'},
                            description: '命令參數陣列',
                        },
                    },
                    required: ['command'],
                },
            },
        },
    },
    {
        location: 'main',
        definition: {
            type: 'function',
            function: {
                name: 'screenshot',
                description: '擷取主螢幕的當前畫面,返回 base64 dataURL。可用於分析使用者目前看到什麼。',
                parameters: {type: 'object', properties: {}},
            },
        },
    },
    {
        location: 'main',
        definition: {
            type: 'function',
            function: {
                name: 'clipboard_read',
                description: '讀取目前剪貼簿的文字內容。',
                parameters: {type: 'object', properties: {}},
            },
        },
    },
    {
        location: 'main',
        definition: {
            type: 'function',
            function: {
                name: 'clipboard_write',
                description: '把指定文字寫入剪貼簿,覆蓋原內容。',
                parameters: {
                    type: 'object',
                    properties: {
                        text: {type: 'string', description: '要寫入剪貼簿的文字'},
                    },
                    required: ['text'],
                },
            },
        },
    },
    {
        location: 'renderer',
        definition: {
            type: 'function',
            function: {
                name: 'get_current_time',
                description: '取得當前本地時間的 ISO 字串,用於使用者詢問時間 / 日期相關問題。',
                parameters: {type: 'object', properties: {}},
            },
        },
        execute: () => ({ok: true, content: new Date().toISOString()}),
    },
]

/** 取所有工具的 OpenAI function calling 定義(直接餵給 chat.completions API) */
export function getToolDefinitions(): ToolDefinition[] {
    return AGENT_TOOLS.map((t) => t.definition)
}

/**
 * 統一的工具執行入口。
 *
 * 按工具名查表;renderer 直接 execute(),main 走 window.agentAPI.execTool() IPC。
 * 結果統一為 ToolExecResult,讓 useAgentChat 不需要分支處理。
 */
export async function executeAgentTool(
    name: string,
    args: Record<string, unknown>
): Promise<ToolExecResult> {
    const tool = AGENT_TOOLS.find((t) => t.definition.function.name === name)
    if (!tool) return {ok: false, content: '', error: `未知工具:${name}`}
    if (tool.location === 'renderer' && tool.execute) {
        return await tool.execute(args)
    }
    return await window.agentAPI.execTool(name, args)
}
