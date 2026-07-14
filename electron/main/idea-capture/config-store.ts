/**
 * 靈感速記桌面端配置(docs/21 §3.2)。
 *
 * 復用既有 agent_configs KV 表(與 agent 的 agent.* 鍵不重疊,用 idea.* 前綴),
 * 免新建表 / migration。目前只存熱鍵 + 是否帶前景視窗標題。
 */

import {logger} from '../utils/logger'
import type {DatabaseManager} from '../db/database-manager'
import {agentConfigs} from '../db/features/agent/schema'
import type {IdeaCaptureConfig} from '../../shared/types/idea-capture.types'
import {DEFAULT_HOTKEY, normalizeHotkey} from '../../shared/idea-capture/hotkey'

const TAG = 'IdeaConfigStore'

const KEYS = {
    hotkey: 'idea.hotkey',
    captureActiveWindow: 'idea.captureActiveWindow',
} as const

export class IdeaConfigStore {
    constructor(private readonly dbManager: DatabaseManager) {
    }

    /** 讀配置;缺的走預設,不合法的熱鍵兜底成預設 */
    read(): IdeaCaptureConfig {
        // captureActiveWindow 預設關:熱鍵即時彈窗不等抓標題;要這條上下文的人自己開
        const base: IdeaCaptureConfig = {hotkey: DEFAULT_HOTKEY, captureActiveWindow: false}
        if (!this.dbManager.isReady()) return base
        try {
            const rows = this.dbManager.getDb().select().from(agentConfigs).all()
            const map = new Map(rows.map((r) => [r.key, parseValue(r.value)]))
            const hk = map.get(KEYS.hotkey)
            const cap = map.get(KEYS.captureActiveWindow)
            return {
                hotkey: normalizeHotkey(typeof hk === 'string' ? hk : undefined),
                captureActiveWindow: typeof cap === 'boolean' ? cap : base.captureActiveWindow,
            }
        } catch (err) {
            logger.warn(`read 失敗,回預設:${(err as Error).message}`, TAG)
            return base
        }
    }

    /** 寫部分配置(只寫傳入欄位);回 true 成功 */
    write(partial: Partial<IdeaCaptureConfig>): boolean {
        if (!this.dbManager.isReady()) return false
        const pairs: Array<[string, unknown]> = []
        if (partial.hotkey !== undefined) pairs.push([KEYS.hotkey, normalizeHotkey(partial.hotkey)])
        if (partial.captureActiveWindow !== undefined) pairs.push([KEYS.captureActiveWindow, partial.captureActiveWindow])
        if (pairs.length === 0) return true

        const now = Date.now()
        try {
            const db = this.dbManager.getDb()
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
}

function parseValue(s: string): unknown {
    try {
        return JSON.parse(s)
    } catch {
        return s
    }
}
