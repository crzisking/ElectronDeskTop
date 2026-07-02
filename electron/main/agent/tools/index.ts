/**
 * Agent v2 工具集(docs/19 §6)。
 *
 * 對齊 opencode 的核心工具:read / write / edit / list / glob / grep / bash / webfetch / websearch。
 * 工具用 AI SDK v7 的 `tool()` 定義(Zod inputSchema)。cwd / 相對路徑錨點 = agent.workspace。
 *
 * ⚠️ 完整權限 gate(§5:allow/ask/deny 宣告式配置 + 彈框)是 Stage 2;本階段先只做
 *    「硬編碼危險命令 deny」這條底線(rm/format/shutdown…),避免無任何防線就放開 bash/write。
 */

import {exec} from 'child_process'
import {promisify} from 'util'
import {mkdirSync} from 'fs'
import {mkdir, readdir, readFile, writeFile} from 'fs/promises'
import {isAbsolute, join, relative, resolve, sep} from 'path'
import {tool, type ToolSet} from 'ai'
import {z} from 'zod'
import {logger} from '../../utils/logger'
import type {AgentConfig} from '../../../shared/types/agent.types'

const TAG = 'AgentTools'
const execAsync = promisify(exec)
const BASH_TIMEOUT_MS = 60_000
const BASH_MAX_BUFFER = 8 * 1024 * 1024
const MAX_WALK_FILES = 2000
const WEB_MAX_BYTES = 200_000

/** 硬編碼危險命令(Stage 2 前的底線;完整權限模型見 docs/19 §5.4) */
const BASH_HARD_DENY = /(^|[\s&|;])(rm|del|rmdir|rd|format|mkfs|shutdown|reboot|halt|diskpart)(\s|$)/i

export function buildTools(cfg: Pick<AgentConfig, 'workspace'>): ToolSet {
    ensureDirSync(cfg.workspace)
    const abs = (p: string) => (isAbsolute(p) ? p : resolve(cfg.workspace, p))

    return {
        read: tool({
            description: '讀取檔案內容。path 可為絕對路徑或相對 workspace 的路徑。',
            inputSchema: z.object({path: z.string().describe('檔案路徑')}),
            execute: async ({path}) => {
                try {
                    return {ok: true, content: await readFile(abs(path), 'utf-8')}
                } catch (err) {
                    return {ok: false, error: (err as Error).message}
                }
            },
        }),

        write: tool({
            description: '寫入(覆蓋)檔案內容;父目錄不存在會自動建立。',
            inputSchema: z.object({
                path: z.string().describe('檔案路徑'),
                content: z.string().describe('要寫入的完整內容'),
            }),
            execute: async ({path, content}) => {
                try {
                    const full = abs(path)
                    await mkdir(join(full, '..'), {recursive: true})
                    await writeFile(full, content, 'utf-8')
                    return {ok: true, bytes: Buffer.byteLength(content)}
                } catch (err) {
                    return {ok: false, error: (err as Error).message}
                }
            },
        }),

        edit: tool({
            description: '把檔案中某段文字 oldString 替換成 newString(oldString 必須存在且唯一)。',
            inputSchema: z.object({
                path: z.string(),
                oldString: z.string().describe('要被替換的原文(需在檔案中唯一出現)'),
                newString: z.string().describe('替換後的新文字'),
            }),
            execute: async ({path, oldString, newString}) => {
                try {
                    const full = abs(path)
                    const text = await readFile(full, 'utf-8')
                    const count = text.split(oldString).length - 1
                    if (count === 0) return {ok: false, error: 'oldString 在檔案中找不到'}
                    if (count > 1) return {ok: false, error: `oldString 出現 ${count} 次,不唯一;請給更多上下文`}
                    await writeFile(full, text.replace(oldString, newString), 'utf-8')
                    return {ok: true}
                } catch (err) {
                    return {ok: false, error: (err as Error).message}
                }
            },
        }),

        list: tool({
            description: '列出目錄下的檔案與子目錄。',
            inputSchema: z.object({path: z.string().default('.').describe('目錄路徑,預設 workspace 根')}),
            execute: async ({path}) => {
                try {
                    const entries = await readdir(abs(path), {withFileTypes: true})
                    return {
                        ok: true,
                        entries: entries.map((e) => ({name: e.name, type: e.isDirectory() ? 'dir' : 'file'})),
                    }
                } catch (err) {
                    return {ok: false, error: (err as Error).message}
                }
            },
        }),

        glob: tool({
            description: '用 glob 樣式(如 "**/*.ts")在 workspace 下找檔案,回相對路徑清單。',
            inputSchema: z.object({pattern: z.string().describe('glob 樣式,如 src/**/*.ts')}),
            execute: async ({pattern}) => {
                try {
                    const re = globToRegExp(pattern)
                    const files = await walkFiles(cfg.workspace)
                    const matched = files
                        .map((f) => relative(cfg.workspace, f).split(sep).join('/'))
                        .filter((rel) => re.test(rel))
                        .slice(0, 500)
                    return {ok: true, files: matched, truncated: matched.length >= 500}
                } catch (err) {
                    return {ok: false, error: (err as Error).message}
                }
            },
        }),

        grep: tool({
            description: '在 workspace 的檔案內容中用正則搜尋,回 檔案:行號:內容。',
            inputSchema: z.object({
                pattern: z.string().describe('正則表達式'),
                glob: z.string().optional().describe('可選:只搜符合此 glob 的檔案'),
            }),
            execute: async ({pattern, glob}) => {
                try {
                    const re = new RegExp(pattern)
                    const globRe = glob ? globToRegExp(glob) : null
                    const files = await walkFiles(cfg.workspace)
                    const hits: string[] = []
                    for (const f of files) {
                        const rel = relative(cfg.workspace, f).split(sep).join('/')
                        if (globRe && !globRe.test(rel)) continue
                        let text: string
                        try {
                            text = await readFile(f, 'utf-8')
                        } catch {
                            continue // 二進位 / 讀不了跳過
                        }
                        const lines = text.split('\n')
                        for (let i = 0; i < lines.length; i++) {
                            if (re.test(lines[i])) {
                                hits.push(`${rel}:${i + 1}:${lines[i].trim().slice(0, 200)}`)
                                if (hits.length >= 200) break
                            }
                        }
                        if (hits.length >= 200) break
                    }
                    return {ok: true, matches: hits, truncated: hits.length >= 200}
                } catch (err) {
                    return {ok: false, error: (err as Error).message}
                }
            },
        }),

        bash: tool({
            description: '在 workspace 目錄執行 shell 命令,回 stdout / stderr / 退出碼。',
            inputSchema: z.object({command: z.string().describe('要執行的 shell 命令')}),
            execute: async ({command}) => {
                if (BASH_HARD_DENY.test(command)) {
                    return {ok: false, denied: true, error: `危險命令被安全策略拒絕:${command}`}
                }
                try {
                    const {stdout, stderr} = await execAsync(command, {
                        cwd: cfg.workspace,
                        timeout: BASH_TIMEOUT_MS,
                        maxBuffer: BASH_MAX_BUFFER,
                        windowsHide: true,
                    })
                    return {ok: true, stdout, stderr, exitCode: 0}
                } catch (err) {
                    const e = err as Error & { stdout?: string; stderr?: string; code?: number; killed?: boolean }
                    return {
                        ok: false,
                        stdout: e.stdout ?? '',
                        stderr: e.stderr ?? e.message,
                        exitCode: typeof e.code === 'number' ? e.code : 1,
                        timedOut: !!e.killed,
                    }
                }
            },
        }),

        webfetch: tool({
            description: '抓取一個 URL 的內容(HTML 會去標籤留純文字),回文字(截斷 200KB)。',
            inputSchema: z.object({url: z.string().url().describe('要抓取的網址')}),
            execute: async ({url}) => {
                try {
                    const res = await fetch(url, {headers: {'User-Agent': 'ichia-agent/1.0'}})
                    if (!res.ok) return {ok: false, error: `HTTP ${res.status} ${res.statusText}`}
                    const raw = (await res.text()).slice(0, WEB_MAX_BYTES)
                    const ct = res.headers.get('content-type') ?? ''
                    const text = ct.includes('html') ? stripHtml(raw) : raw
                    return {ok: true, url, text}
                } catch (err) {
                    return {ok: false, error: (err as Error).message}
                }
            },
        }),

        websearch: tool({
            description: '網路搜尋,回前幾筆結果(標題 + 網址 + 摘要)。想看某筆詳情再用 webfetch。',
            inputSchema: z.object({query: z.string().describe('搜尋關鍵字')}),
            execute: async ({query}) => {
                try {
                    return {ok: true, results: await duckSearch(query)}
                } catch (err) {
                    return {ok: false, error: `搜尋失敗:${(err as Error).message}`}
                }
            },
        }),
    }
}

// ─── helpers ───────────────────────────────────────────────

function ensureDirSync(dir: string): void {
    try {
        mkdirSync(dir, {recursive: true})
    } catch (err) {
        logger.warn(`建 workspace 目錄失敗:${(err as Error).message}`, TAG)
    }
}

/** 遞迴列出檔案(略過 node_modules/.git;上限 MAX_WALK_FILES) */
async function walkFiles(root: string): Promise<string[]> {
    const out: string[] = []

    async function walk(dir: string): Promise<void> {
        if (out.length >= MAX_WALK_FILES) return
        let entries
        try {
            entries = await readdir(dir, {withFileTypes: true})
        } catch {
            return
        }
        for (const e of entries) {
            if (out.length >= MAX_WALK_FILES) return
            if (e.name === 'node_modules' || e.name === '.git') continue
            const full = join(dir, e.name)
            if (e.isDirectory()) await walk(full)
            else out.push(full)
        }
    }

    await walk(root)
    return out
}

/** 極簡 glob → RegExp(支援 ** / * / ?) */
function globToRegExp(glob: string): RegExp {
    const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    const re = esc
        .replace(/\*\*\//g, '(?:.*/)?')
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]')
    return new RegExp(`^${re}$`)
}

/** 粗略去 HTML 標籤留文字 */
function stripHtml(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim()
}

/** DuckDuckGo HTML 端點(免 key,best-effort);解析標題/網址/摘要 */
async function duckSearch(query: string): Promise<Array<{ title: string; url: string; snippet: string }>> {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
        headers: {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'},
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const html = await res.text()
    const out: Array<{ title: string; url: string; snippet: string }> = []
    const linkRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
    const snippetRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
    const snippets: string[] = []
    let sm: RegExpExecArray | null
    while ((sm = snippetRe.exec(html)) && snippets.length < 8) snippets.push(stripHtml(sm[1]))
    let lm: RegExpExecArray | null
    let i = 0
    while ((lm = linkRe.exec(html)) && out.length < 6) {
        out.push({url: decodeDuckUrl(lm[1]), title: stripHtml(lm[2]), snippet: snippets[i] ?? ''})
        i++
    }
    return out
}

/** DDG 結果連結常包成 //duckduckgo.com/l/?uddg=<encoded> */
function decodeDuckUrl(href: string): string {
    const m = href.match(/[?&]uddg=([^&]+)/)
    if (m) {
        try {
            return decodeURIComponent(m[1])
        } catch {
            /* fall through */
        }
    }
    return href.startsWith('//') ? `https:${href}` : href
}
