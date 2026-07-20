/**
 * Agent v2 權限模型(docs/19 §5)。
 *
 * AI SDK 無內建 beforeToolCall,故用「包一層 tool.execute」的 gate 落地宣告式配置:
 *   每個工具執行前先 decide → allow 執行 / deny 回拒絕結果 / ask 彈框問使用者。
 *
 * 決策順序(gateDecide):
 *   1. plan 模式:寫類工具一律 deny
 *   2. 硬編碼危險(bash 危險命令 / 系統路徑)→ deny(使用者也改不掉,§5.4 底線)
 *   3. external_directory:路徑出所有工作資料夾 → 套 external_directory 規則
 *   4. 宣告式配置(decideFromConfig,glob 最後命中者贏)
 *
 * 純函式(decideFromConfig / match / 硬編碼判斷)獨立可測;有副作用的問使用者 / 持久化在 gate。
 */

import {isAbsolute, resolve} from 'path'
import {tool as aiTool, type ToolSet} from 'ai'
import type {PermissionConfig, PermissionVerdict} from '../../shared/types/agent.types'

// ─── 常量 ───────────────────────────────────────────────────

/** 寫類 / 有副作用工具(plan 模式一律擋;也是「較敏感」的一組) */
export const WRITE_TOOLS = new Set(['write', 'edit', 'bash', 'clipboard_write', 'open_app'])
/** 帶路徑參數的工具(要做 external_directory / 系統路徑判斷) */
export const PATH_TOOLS = new Set(['read', 'write', 'edit', 'list'])

/** 硬編碼危險命令(使用者配置也擋不住)—— 單源,agent/tools/index.ts 的底線 deny 也 import 這個 */
export const HARD_DENY_CMD = /(^|[\s&|;])(rm|del|rmdir|rd|format|mkfs|shutdown|reboot|halt|diskpart)(\s|$)/i
/** 硬編碼系統路徑(小寫前綴比對) */
const HARD_DENY_PATHS = ['c:\\windows', 'c:\\program files', 'c:\\program files (x86)']

// ─── 純判斷 ─────────────────────────────────────────────────

export function isHardDeniedCommand(command: string): boolean {
    return HARD_DENY_CMD.test(command)
}

export function isHardDeniedPath(absPath: string): boolean {
    const p = absPath.toLowerCase().replace(/\//g, '\\')
    return HARD_DENY_PATHS.some((deny) => p === deny || p.startsWith(deny + '\\'))
}

/** 命令 glob(如 "git *")→ RegExp;* 配任意、? 配一字元 */
function cmdGlobToRegExp(pattern: string): RegExp {
    const esc = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    return new RegExp('^' + esc.replace(/\*/g, '.*').replace(/\?/g, '.') + '$')
}

/**
 * 在 glob 規則表裡比對 subject,**最後命中者贏**(對齊 opencode)。無命中回 null。
 * 排除 '*' 這個 key(它是該表的 fallback,另外處理)。
 */
export function matchPatternMap(subject: string, map: Record<string, PermissionVerdict>): PermissionVerdict | null {
    let hit: PermissionVerdict | null = null
    for (const [pattern, verdict] of Object.entries(map)) {
        if (pattern === '*') continue
        if (cmdGlobToRegExp(pattern).test(subject)) hit = verdict // 不 break:取最後命中
    }
    return hit
}

/**
 * 依宣告式配置決策(純函式)。
 * @param subject 供 glob 比對的字串(bash=命令;其餘工具通常用不到,傳 '')
 */
export function decideFromConfig(tool: string, subject: string, config: PermissionConfig): PermissionVerdict {
    const rule = config[tool] ?? config['*']
    if (rule === undefined) return 'ask'
    if (typeof rule === 'string') return rule
    // 物件(glob 表):比對 subject → 該表 '*' → 全域 '*' → ask
    const m = matchPatternMap(subject, rule)
    if (m) return m
    if (rule['*']) return rule['*']
    const globalStar = config['*']
    return typeof globalStar === 'string' ? globalStar : 'ask'
}

// ─── gate(有副作用:問使用者 + 持久化)────────────────────────

export interface AskRequest {
    tool: string
    subject: string
    input: unknown
    /** 建議的「永遠」規則粒度(bash=命令首兩詞;其餘=整個工具) */
    suggestedPattern: string
}

/** 使用者對彈框的回應 */
export interface UserDecision {
    allow: boolean
    always: boolean
    /** 覆寫建議粒度(進階);沒給用 suggestedPattern */
    pattern?: string
}

export interface GateContext {
    config: PermissionConfig
    workspaces: string[]
    planMode: boolean
    /** 同一 (tool+args) 連續重複超過此次數 → 中止(防打轉燒錢);0 = 不限 */
    doomLoopLimit: number
    /** 推彈框給 renderer 並等回應 */
    ask: (req: AskRequest) => Promise<UserDecision>
    /** 「永遠」時把規則寫回 config(tool + pattern + verdict) */
    persist: (tool: string, pattern: string, verdict: PermissionVerdict) => void
}

/** 取工具的 subject(供 glob 比對) */
function subjectOf(tool: string, args: Record<string, unknown>): string {
    if (tool === 'bash') return String(args.command ?? '')
    if (PATH_TOOLS.has(tool)) return String(args.path ?? '')
    return ''
}

/** 建議「永遠」粒度:bash 取命令首兩詞;其餘用整個工具名(*) */
export function suggestPattern(tool: string, subject: string): string {
    if (tool === 'bash') {
        const words = subject.trim().split(/\s+/).slice(0, 2).join(' ')
        return words ? `${words} *` : '*'
    }
    return '*'
}

function resolveAbs(p: string | undefined, primary: string): string | null {
    if (!p) return null
    return isAbsolute(p) ? p : resolve(primary || process.cwd(), p)
}

/** 路徑是否在所有工作區之外(前綴比對用分隔符防 C:\ws 誤配 C:\ws2) */
export function isExternal(absPath: string, workspaces: string[]): boolean {
    const p = absPath.toLowerCase().replace(/\//g, '\\')
    return !workspaces.some((w) => {
        const root = w.toLowerCase().replace(/\//g, '\\')
        return p === root || p.startsWith(root + '\\')
    })
}

/** 執行前的靜態決策(不含問使用者);回 allow/ask/deny */
export function gateDecide(tool: string, args: Record<string, unknown>, ctx: Omit<GateContext, 'ask' | 'persist'>): PermissionVerdict {
    if (ctx.planMode && WRITE_TOOLS.has(tool)) return 'deny'

    const subject = subjectOf(tool, args)
    if (tool === 'bash' && isHardDeniedCommand(subject)) return 'deny'

    if (PATH_TOOLS.has(tool)) {
        const abs = resolveAbs(args.path as string | undefined, ctx.workspaces[0] ?? '')
        if (abs && isHardDeniedPath(abs)) return 'deny'
        if (abs && isExternal(abs, ctx.workspaces)) {
            const ext = ctx.config['external_directory']
            if (ext === 'deny') return 'deny'
            if (ext === undefined || ext === 'ask') return 'ask'
            // ext === 'allow' → 落到工具本身的 verdict
        }
    }

    return decideFromConfig(tool, subject, ctx.config)
}

/** 用權限 gate 包住每個工具的 execute。allow 執行 / deny 回拒絕 / ask 等使用者。 */
export function wrapToolsWithPermission(tools: ToolSet, ctx: GateContext): ToolSet {
    // doom_loop 偵測:整批工具共享一組計數(本 run 內),連續相同呼叫超過上限就擋
    let lastSig = ''
    let repeat = 0

    const wrapped: ToolSet = {}
    for (const [name, t] of Object.entries(tools)) {
        wrapped[name] = aiTool({
            description: t.description,
            inputSchema: t.inputSchema,
            execute: async (args: Record<string, unknown>, opts: unknown) => {
                // doom_loop:同一 (tool+args) 連續重複超過上限 → 中止(不論該工具的權限)
                const sig = `${name}:${JSON.stringify(args)}`
                repeat = sig === lastSig ? repeat + 1 : 1
                lastSig = sig
                if (ctx.doomLoopLimit > 0 && repeat > ctx.doomLoopLimit) {
                    return {ok: false, denied: true, error: `偵測到重複呼叫 ${name}(${repeat} 次),已中止以免打轉`}
                }

                const verdict = gateDecide(name, args, ctx)
                if (verdict === 'deny') {
                    return {ok: false, denied: true, error: `操作被安全策略拒絕:${name}`}
                }
                if (verdict === 'ask') {
                    const subject = subjectOf(name, args)
                    const d = await ctx.ask({
                        tool: name,
                        subject,
                        input: args,
                        suggestedPattern: suggestPattern(name, subject)
                    })
                    if (d.always) ctx.persist(name, d.pattern ?? suggestPattern(name, subject), d.allow ? 'allow' : 'deny')
                    if (!d.allow) return {ok: false, denied: true, error: '使用者拒絕了此操作'}
                }
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return (t.execute as any)(args, opts)
            },
        })
    }
    return wrapped
}
