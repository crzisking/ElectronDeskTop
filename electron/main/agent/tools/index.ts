/**
 * Agent v2 工具集(docs/19 §6)。
 *
 * 對齊 opencode / Claude Code 核心工具:read / write / edit / list / glob / grep / bash / webfetch / websearch。
 * 工具用 AI SDK v7 的 `tool()` 定義(Zod inputSchema)。
 *
 * 多資料夾工作區(每對話可加多個):`workspaces[0]` = 主目錄(bash cwd + 相對路徑基準);
 * glob / grep / list 會跨所有資料夾;read/write/edit 相對主目錄或吃絕對路徑(可達其他已加資料夾)。
 *
 * ⚠️ 完整權限 gate(§5)是 Stage 2;本階段先只做「硬編碼危險命令 deny」這條底線。
 */

import {exec} from 'child_process'
import {promisify} from 'util'
import {mkdirSync} from 'fs'
import {mkdir, readdir, readFile, writeFile} from 'fs/promises'
import {basename, isAbsolute, join, relative, resolve, sep} from 'path'
import {tool, type ToolSet} from 'ai'
import {z} from 'zod'
import {buildWinTools} from './win-tools'
import {logger} from '../../utils/logger'

const TAG = 'AgentTools'
const execAsync = promisify(exec)
const BASH_TIMEOUT_MS = 60_000
const BASH_MAX_BUFFER = 8 * 1024 * 1024
const MAX_WALK_FILES = 4000
const WEB_MAX_BYTES = 200_000

/** 硬編碼危險命令(Stage 2 前的底線;完整權限模型見 docs/19 §5.4) */
const BASH_HARD_DENY = /(^|[\s&|;])(rm|del|rmdir|rd|format|mkfs|shutdown|reboot|halt|diskpart)(\s|$)/i

/**
 * @param workspaces 工作資料夾清單(第一個為主目錄);至少要有一個(caller 保證,空則 fallback cwd)
 */
export function buildTools(workspaces: string[]): ToolSet {
    const roots = workspaces.length ? workspaces : [process.cwd()]
    const primary = roots[0]
    ensureDirSync(primary)
    const abs = (p: string) => (isAbsolute(p) ? p : resolve(primary, p))
    const multi = roots.length > 1
    /** 檔案 → 顯示用相對路徑(多根時前綴根目錄名以區分) */
    const displayPath = (root: string, file: string) => {
        const rel = relative(root, file).split(sep).join('/')
        return multi ? `${basename(root)}/${rel}` : rel
    }

    return {
        read: tool({
            description: '讀取檔案內容。path 可為絕對路徑或相對「主工作目錄」的路徑。',
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
            description: '列出目錄下的檔案與子目錄。path 相對主工作目錄或絕對路徑;預設列所有工作資料夾根。',
            inputSchema: z.object({path: z.string().optional().describe('目錄路徑,省略則列所有工作資料夾')}),
            execute: async ({path}) => {
                try {
                    if (!path) {
                        // 列所有工作資料夾根的頂層
                        const out: Record<string, string[]> = {}
                        for (const root of roots) {
                            const entries = await readdir(root, {withFileTypes: true}).catch(() => [])
                            out[root] = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
                        }
                        return {ok: true, roots: out}
                    }
                    const entries = await readdir(abs(path), {withFileTypes: true})
                    return {
                        ok: true,
                        entries: entries.map((e) => ({name: e.name, type: e.isDirectory() ? 'dir' : 'file'}))
                    }
                } catch (err) {
                    return {ok: false, error: (err as Error).message}
                }
            },
        }),

        glob: tool({
            description: '用 glob 樣式(如 "**/*.ts")在所有工作資料夾下找檔案,回相對路徑清單。',
            inputSchema: z.object({pattern: z.string().describe('glob 樣式,如 src/**/*.ts')}),
            execute: async ({pattern}) => {
                try {
                    const re = globToRegExp(pattern)
                    const all = await walkFiles(roots)
                    const matched = all
                        .filter(({root, file}) => re.test(relative(root, file).split(sep).join('/')))
                        .map(({root, file}) => displayPath(root, file))
                        .slice(0, 500)
                    return {ok: true, files: matched, truncated: matched.length >= 500}
                } catch (err) {
                    return {ok: false, error: (err as Error).message}
                }
            },
        }),

        grep: tool({
            description: '在所有工作資料夾的檔案內容中用正則搜尋,回 檔案:行號:內容。',
            inputSchema: z.object({
                pattern: z.string().describe('正則表達式'),
                glob: z.string().optional().describe('可選:只搜符合此 glob 的檔案'),
            }),
            execute: async ({pattern, glob}) => {
                try {
                    const re = new RegExp(pattern)
                    const globRe = glob ? globToRegExp(glob) : null
                    const all = await walkFiles(roots)
                    const hits: string[] = []
                    for (const {root, file} of all) {
                        const rel = relative(root, file).split(sep).join('/')
                        if (globRe && !globRe.test(rel)) continue
                        let text: string
                        try {
                            text = await readFile(file, 'utf-8')
                        } catch {
                            continue
                        }
                        const lines = text.split('\n')
                        for (let i = 0; i < lines.length; i++) {
                            if (re.test(lines[i])) {
                                hits.push(`${displayPath(root, file)}:${i + 1}:${lines[i].trim().slice(0, 200)}`)
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
            description: '在主工作目錄執行 shell 命令,回 stdout / stderr / 退出碼。',
            inputSchema: z.object({command: z.string().describe('要執行的 shell 命令')}),
            execute: async ({command}) => {
                if (BASH_HARD_DENY.test(command)) {
                    return {ok: false, denied: true, error: `危險命令被安全策略拒絕:${command}`}
                }
                try {
                    const {stdout, stderr} = await execAsync(command, {
                        cwd: primary,
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

        // Windows 桌面工具(剪貼簿 / 開啟);跟工作資料夾無關,直接併入
        ...buildWinTools(),
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

/** 遞迴列出多個根下的檔案(略過 node_modules/.git;總數上限 MAX_WALK_FILES) */
async function walkFiles(roots: string[]): Promise<Array<{ root: string; file: string }>> {
    const out: Array<{ root: string; file: string }> = []

    async function walk(root: string, dir: string): Promise<void> {
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
            if (e.isDirectory()) await walk(root, full)
            else out.push({root, file: full})
        }
    }

    for (const root of roots) await walk(root, root)
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
