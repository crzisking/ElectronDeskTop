/**
 * Config Repository barrel — 對外 3 個主 API + 升級保護清單。
 *
 * 拆檔依職責(docs/24 §4.3):
 *  - assemble.ts          Read:7 表 → AppConfig
 *  - apply-partial.ts     Write:Partial<AppConfig> → 7 表 + transaction
 *  - resync-dev-owned.ts  Reseed:升級時把 dev-owned 強制同步成 DEFAULT_CONFIG
 *  - kv-helpers.ts        KV 表低階存取
 *  - collection-helpers.ts Collection 表 整批替換 + QuickMenu 特殊處理
 *
 * 既有 `import ... from '.../config/repository'` 自動解析到本檔。
 */

export {assembleAppConfig} from './assemble'
export {applyPartial} from './apply-partial'
export {allSingletons, resyncDevOwnedConfig, USER_OWNED_KEYS} from './resync-dev-owned'
