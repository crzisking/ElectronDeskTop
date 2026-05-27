/**
 * AgentToolService — Agent 工具執行集中地。
 *
 * 對應設計文件 §4 工具系統。`agent.handlers.ts` 只負責 IPC 協議翻譯(invoke → service),
 * 工具本體實作全在這裡:
 *   - open_app / read_file / write_file / list_files / run_command
 *   - screenshot / clipboard_read / clipboard_write
 *
 * 分層動機:對齊既有 LogService / WorkRecordService / UserProfileService 的「handler 薄,
 * service 厚」慣例;handler 內不應該出現 fs.readFile / execFile / desktopCapturer 這類副作用呼叫。
 *
 * 信任邊界:內網應用 + 信任使用者,不做檔案路徑沙箱化(同 work-collector 的信任模型)。
 * `run_command` 用 `execFile`(非 shell 字串)降低 shell injection 機會,並硬性 15 秒 timeout。
 *
 * 截斷上限:對齊設計文件 §6.2,避免 LLM context 爆炸。
 */

import {clipboard, desktopCapturer, screen, shell} from 'electron'
import {execFile} from 'node:child_process'
import {promises as fs} from 'node:fs'
import path from 'node:path'
import type {ToolExecResult} from '../../shared/types/agent.types'

/** 工具回傳 content 截斷上限 */
const MAX_CONTENT = 4000
const MAX_LIST = 2000
const MAX_CMD = 3000

export class AgentToolService {
    /**
     * 統一執行入口:handler 收到 IPC 後直接呼叫,不關心工具實作細節。
     *
     * 未知工具名直接返回錯誤,**不 throw** —— 讓 LLM 從工具結果裡讀到錯誤訊息,
     * 比 throw 後渲染端 catch 再做特殊處理更乾淨。
     */
    async execute(name: string, args: Record<string, unknown>): Promise<ToolExecResult> {
        switch (name) {
            case 'open_app':
                return this.openApp(args)
            case 'read_file':
                return this.readFile(args)
            case 'write_file':
                return this.writeFile(args)
            case 'list_files':
                return this.listFiles(args)
            case 'run_command':
                return this.runCommand(args)
            case 'screenshot':
                return this.screenshot()
            case 'clipboard_read':
                return this.clipboardRead()
            case 'clipboard_write':
                return this.clipboardWrite(args)
            default:
                return {ok: false, content: '', error: `未知工具:${name}`}
        }
    }

    // ── 應用啟動 ──────────────────────────────────────────────────────

    private async openApp(args: Record<string, unknown>): Promise<ToolExecResult> {
        const appPath = String(args.appPath ?? '').trim()
        if (!appPath) return {ok: false, content: '', error: 'appPath 不能為空'}
        // shell.openPath 支援可執行檔路徑、文件夾、註冊的 protocol;對 'notepad' 這類
        // 系統命令不行 — 用 execFile 兜底
        try {
            const result = await shell.openPath(appPath)
            if (!result) return {ok: true, content: `已開啟:${appPath}`}
            return await new Promise((resolve) => {
                execFile(appPath, [], {windowsHide: false}, (err) => {
                    if (err) resolve({ok: false, content: '', error: `開啟失敗:${err.message}`})
                    else resolve({ok: true, content: `已開啟:${appPath}`})
                })
            })
        } catch (err) {
            return {ok: false, content: '', error: String(err)}
        }
    }

    // ── 檔案系統 ──────────────────────────────────────────────────────

    private async readFile(args: Record<string, unknown>): Promise<ToolExecResult> {
        const filePath = String(args.path ?? '').trim()
        if (!filePath) return {ok: false, content: '', error: 'path 不能為空'}
        const buf = await fs.readFile(filePath, 'utf8')
        return {ok: true, content: truncate(buf, MAX_CONTENT)}
    }

    private async writeFile(args: Record<string, unknown>): Promise<ToolExecResult> {
        const filePath = String(args.path ?? '').trim()
        const content = String(args.content ?? '')
        if (!filePath) return {ok: false, content: '', error: 'path 不能為空'}
        await fs.mkdir(path.dirname(filePath), {recursive: true})
        await fs.writeFile(filePath, content, 'utf8')
        return {ok: true, content: `已寫入 ${content.length} 字元到 ${filePath}`}
    }

    private async listFiles(args: Record<string, unknown>): Promise<ToolExecResult> {
        const dirPath = String(args.path ?? '').trim()
        if (!dirPath) return {ok: false, content: '', error: 'path 不能為空'}
        const entries = await fs.readdir(dirPath, {withFileTypes: true})
        const list = entries
            .map((e) => `${e.isDirectory() ? '[DIR] ' : '      '}${e.name}`)
            .join('\n')
        return {ok: true, content: truncate(list, MAX_LIST)}
    }

    // ── 命令執行 ──────────────────────────────────────────────────────

    private async runCommand(args: Record<string, unknown>): Promise<ToolExecResult> {
        const command = String(args.command ?? '').trim()
        const rawArgs = Array.isArray(args.args) ? (args.args as unknown[]).map(String) : []
        if (!command) return {ok: false, content: '', error: 'command 不能為空'}
        return await new Promise((resolve) => {
            execFile(
                command,
                rawArgs,
                {timeout: 15_000, windowsHide: true, maxBuffer: 1024 * 1024},
                (err, stdout, stderr) => {
                    const out = (stdout || '') + (stderr ? `\n[stderr] ${stderr}` : '')
                    if (err && !stdout && !stderr) {
                        resolve({ok: false, content: '', error: err.message})
                    } else {
                        resolve({ok: true, content: truncate(out || '(無輸出)', MAX_CMD)})
                    }
                }
            )
        })
    }

    // ── 螢幕 / 剪貼簿 ─────────────────────────────────────────────────

    private async screenshot(): Promise<ToolExecResult> {
        const display = screen.getPrimaryDisplay()
        const {width, height} = display.size
        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: {width, height},
        })
        const primary = sources[0]
        if (!primary) return {ok: false, content: '', error: '取不到螢幕來源'}
        return {ok: true, content: primary.thumbnail.toDataURL()}
    }

    private clipboardRead(): ToolExecResult {
        return {ok: true, content: truncate(clipboard.readText(), MAX_CONTENT)}
    }

    private clipboardWrite(args: Record<string, unknown>): ToolExecResult {
        const text = String(args.text ?? '')
        clipboard.writeText(text)
        return {ok: true, content: `已寫入剪貼簿 ${text.length} 字元`}
    }
}

function truncate(s: string, max: number): string {
    if (s.length <= max) return s
    return s.slice(0, max) + `\n...(截斷,原長度 ${s.length})`
}
