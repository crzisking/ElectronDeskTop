/**
 * Agent v2 Windows 桌面工具(docs/19 §6.2)。
 *
 * clipboard_read(讀類,預設 allow)/ clipboard_write / open_app(有副作用,預設 ask、plan 模式擋)。
 * screenshot 先不做:純文字模型看不到圖,要等視覺模型整合才有意義。
 */

import {exec} from 'child_process'
import {promisify} from 'util'
import {clipboard, shell} from 'electron'
import {tool, type ToolSet} from 'ai'
import {z} from 'zod'

const execAsync = promisify(exec)

export function buildWinTools(): ToolSet {
    return {
        clipboard_read: tool({
            description: '讀取系統剪貼簿目前的文字內容。',
            inputSchema: z.object({}),
            execute: async () => ({ok: true, text: clipboard.readText()}),
        }),

        clipboard_write: tool({
            description: '把文字寫入系統剪貼簿(覆蓋原內容)。',
            inputSchema: z.object({text: z.string().describe('要寫入剪貼簿的文字')}),
            execute: async ({text}) => {
                clipboard.writeText(text)
                return {ok: true}
            },
        }),

        open_app: tool({
            description: '用系統預設方式開啟:URL、檔案、資料夾,或應用程式(如 notepad / calc)。',
            inputSchema: z.object({target: z.string().describe('URL / 檔案 / 資料夾 / 應用程式名')}),
            execute: async ({target}) => {
                try {
                    if (/^https?:\/\//i.test(target)) {
                        await shell.openExternal(target)
                        return {ok: true, opened: 'url'}
                    }
                    // 先當檔案/資料夾/完整路徑開;失敗再當 app 名用 start 啟動
                    const err = await shell.openPath(target)
                    if (!err) return {ok: true, opened: 'path'}
                    await execAsync(`start "" "${target.replace(/"/g, '')}"`, {windowsHide: true})
                    return {ok: true, opened: 'app'}
                } catch (e) {
                    return {ok: false, error: (e as Error).message}
                }
            },
        }),
    }
}
