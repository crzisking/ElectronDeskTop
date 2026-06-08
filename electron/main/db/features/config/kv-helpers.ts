/**
 * KV 表(app_settings_kv)低階存取 helper。
 *
 * KV 表存「散值」配置:語言、開關、外觀參數等;value 一律 JSON.stringify 後當字串存。
 * 讀的時候 parseValue 嘗試 JSON.parse,失敗回原字串(向後相容舊資料)。
 */

import type {BetterSQLite3Database} from 'drizzle-orm/better-sqlite3'
import {appSettingsKv} from './schema'

export type Db = BetterSQLite3Database<any>

/** 把 KV 表內字串值 parse 回 JS 型別 */
export function parseValue(s: string): unknown {
    try {
        return JSON.parse(s)
    } catch {
        return s
    }
}

/** 從 kv map 取值;缺失 / null / undefined 都 fallback 到 default */
export function getKv<T>(kv: Map<string, unknown>, key: string, defaultVal: T): T {
    if (!kv.has(key)) return defaultVal
    const v = kv.get(key)
    if (v === null || v === undefined) return defaultVal
    return v as T
}

/** upsert 一個 KV row;undefined 不寫(讓 partial 部分欄位可被略過) */
export function upsertKv(tx: Db, key: string, value: unknown): void {
    if (value === undefined) return
    tx.insert(appSettingsKv)
        .values({key, value: JSON.stringify(value), updatedAt: Date.now()})
        .onConflictDoUpdate({
            target: appSettingsKv.key,
            set: {value: JSON.stringify(value), updatedAt: Date.now()},
        })
        .run()
}
