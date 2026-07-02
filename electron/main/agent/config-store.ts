/**
 * Agent v2 配置存儲(docs/19 §7.2)。
 *
 * 讀寫既有的 `agent_configs` KV 表,但只碰 v2 專屬 keys(llm.* / agent.*),
 * **不碰 AgentService 的 providers / activeProviderId**(那是通用 LLM provider 配置,
 * work-analysis / daily-advice 在用)。兩者共用同一張 KV 表、鍵不重疊,互不干擾。
 *
 * ⚠️ 無任何預設 model:baseUrl / model 預設空字串,agent 在使用者配好前不可用。
 */

import {app} from 'electron'
import {join} from 'path'
import {eq} from 'drizzle-orm'
import {logger} from '../utils/logger'
import type {DatabaseManager} from '../db/database-manager'
import {agentConfigs} from '../db/features/agent/schema'
import type {AgentConfig, PermissionConfig} from '../../shared/types/agent.types'

const TAG = 'AgentConfigStore'

/**
 * v2 keys ↔ AgentConfig 欄位(agent 自身設定)。
 * ⚠️ 不含模型連線(URL/model/apiKey)—— 那復用現有模型設定的 active provider(見 model-provider)。
 * 這裡的 key 與 AgentService 的 providers / activeProviderId 不重疊,共用同表互不干擾。
 */
const KEYS = {
    systemPrompt: 'agent.systemPrompt',
    maxTurns: 'agent.maxTurns',
    planMode: 'agent.planMode',
    workspace: 'agent.workspace',
    permission: 'agent.permission',
    doomLoopLimit: 'agent.doomLoopLimit',
} as const

/** 出廠預設權限(opencode 式宣告配置;讀類放行、寫類 ask、危險命令 deny)。 */
export function defaultPermission(): PermissionConfig {
    return {
        '*': 'ask',
        read: 'allow',
        glob: 'allow',
        grep: 'allow',
        webfetch: 'allow',
        websearch: 'allow',
        edit: 'ask',
        write: 'ask',
        external_directory: 'ask',
        bash: {
            '*': 'ask',
            'git status': 'allow',
            'git log': 'allow',
            'git diff': 'allow',
            'git branch': 'allow',
            'git show': 'allow',
            ls: 'allow',
            dir: 'allow',
            cat: 'allow',
            type: 'allow',
            findstr: 'allow',
            grep: 'allow',
            'node -v': 'allow',
            'npm -v': 'allow',
            'rm *': 'deny',
            'del *': 'deny',
            'format *': 'deny',
            'shutdown *': 'deny',
        },
    }
}

export class AgentConfigStore {
    constructor(private readonly dbManager: DatabaseManager) {
    }

    /** 讀完整配置;缺的走預設。DB 未就緒回全預設(agent 自然不可用,因 baseUrl 空) */
    read(): AgentConfig {
        const base: AgentConfig = {
            systemPrompt: undefined,
            maxTurns: 20,
            planMode: false,
            workspace: this.defaultWorkspace(),
            permission: defaultPermission(),
            doomLoopLimit: 3,
        }
        if (!this.dbManager.isReady()) {
            logger.warn('read: dbManager 未就緒,回預設', TAG)
            return base
        }
        const rows = this.dbManager.getDb().select().from(agentConfigs).all()
        const map = new Map(rows.map((r) => [r.key, parseValue(r.value)]))

        const s = (k: string, d: string) => (typeof map.get(k) === 'string' ? (map.get(k) as string) : d)
        const n = (k: string, d: number) => (typeof map.get(k) === 'number' ? (map.get(k) as number) : d)
        const b = (k: string, d: boolean) => (typeof map.get(k) === 'boolean' ? (map.get(k) as boolean) : d)

        return {
            systemPrompt: typeof map.get(KEYS.systemPrompt) === 'string' ? (map.get(KEYS.systemPrompt) as string) : undefined,
            maxTurns: n(KEYS.maxTurns, base.maxTurns),
            planMode: b(KEYS.planMode, base.planMode),
            workspace: s(KEYS.workspace, base.workspace),
            permission: isPermissionConfig(map.get(KEYS.permission)) ? (map.get(KEYS.permission) as PermissionConfig) : base.permission,
            doomLoopLimit: n(KEYS.doomLoopLimit, base.doomLoopLimit),
        }
    }

    /** 寫入部分配置;回 true 成功 / false 失敗。只寫傳入的欄位。 */
    write(partial: Partial<AgentConfig>): boolean {
        if (!this.dbManager.isReady()) {
            logger.error('write 失敗:DB 未就緒', TAG)
            return false
        }
        const db = this.dbManager.getDb()
        const now = Date.now()
        const pairs: Array<[string, unknown]> = []
        for (const [field, key] of Object.entries(KEYS)) {
            const v = (partial as Record<string, unknown>)[field]
            if (v !== undefined) pairs.push([key, v])
        }
        if (!pairs.length) return true
        try {
            db.transaction((tx) => {
                for (const [key, value] of pairs) {
                    tx.insert(agentConfigs)
                        .values({key, value: JSON.stringify(value), updatedAt: now})
                        .onConflictDoUpdate({
                            target: agentConfigs.key,
                            set: {value: JSON.stringify(value), updatedAt: now}
                        })
                        .run()
                }
            })
            return true
        } catch (err) {
            logger.error('write 失敗', TAG, err)
            return false
        }
    }

    /** 維運用:清掉 v2 keys(不動 providers) */
    reset(): void {
        if (!this.dbManager.isReady()) return
        try {
            const db = this.dbManager.getDb()
            db.transaction((tx) => {
                for (const key of Object.values(KEYS)) tx.delete(agentConfigs).where(eq(agentConfigs.key, key)).run()
            })
        } catch (err) {
            logger.error('reset 失敗', TAG, err)
        }
    }

    /** 檔案工具的預設 workspace(跟 app data 同樹,備份 / 清理一起) */
    private defaultWorkspace(): string {
        return join(app.getPath('userData'), 'agent-workspace')
    }
}

function parseValue(s: string): unknown {
    try {
        return JSON.parse(s)
    } catch {
        return s
    }
}

function isPermissionConfig(v: unknown): v is PermissionConfig {
    return !!v && typeof v === 'object' && !Array.isArray(v)
}
