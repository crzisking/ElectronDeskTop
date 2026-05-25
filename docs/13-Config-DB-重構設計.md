# Config 持久化從 JSON 遷移到 SQLite 設計

> **方案 A:完全棄用 JSON**。
> 所有設定項落地到 SQLite,跟 `logs` / `work_records` / `user_profiles` 共用 `app.db`。
> Seed 來源是 code 內的 `DEFAULT_CONFIG` 常數,**不 ship 也不讀任何 JSON 檔**。
> 既有使用者升級時:userData 內舊 JSON 會被刪除,設定還原 default(已知取捨)。

---

## 目錄

1. [動機](#1-動機)
2. [既有機制盤點](#2-既有機制盤點)
3. [取捨與選型](#3-取捨與選型)
4. [表結構](#4-表結構)
5. [讀寫流程](#5-讀寫流程)
6. [既有契約如何保留](#6-既有契約如何保留)
7. [Seed / 升級 / 既有使用者遷移](#7-seed--升級--既有使用者遷移)
8. [跟既有機制的對應關係](#8-跟既有機制的對應關係)
9. [資料邊界](#9-資料邊界)
10. [影響檔案清單](#10-影響檔案清單)
11. [MVP 切分](#11-mvp-切分)
12. [Out of scope](#12-out-of-scope)
13. [風險與回滾](#13-風險與回滾)

---

## 1. 動機

### 現狀痛點

雖然 ConfigManager 已經做到「不覆蓋使用者設定」(`copyDefaultConfig` 加 `existsSync` 守衛、`appendMissingById` 補新 entry),但 JSON 模式仍有結構性問題:

- **雙來源同步成本**:`DEFAULT_CONFIG`(code)和 `config/app-config.json`(file)兩處要對齊。改一個欄位要動兩處,新人容易漏。
- **JSON 整檔讀寫沒原子性**:`writeConfig()` 走 `JSON.stringify(this.config)` 再 `writeFileSync`,中途任何 process kill / disk full 都可能留下半寫狀態的 JSON。
- **註解碎屑**:`config/app-config.json` 有 41 個 `_comment` / `_comment_xxx` 欄位,排版混亂、改動易遺漏。
- **多筆 CRUD 操作昂貴**:`sidebar.items`、`tools` 等陣列若想加 UI 編輯,得整檔 read-modify-write,沒有 row-level update。
- **跟 SQLite 升級體驗不對等**:`work_records` / `user_profiles` 經 electron-updater 升級無痛保留;config 走 userData 雖然也保留,但跟其他 per-machine 資料不在同個機制裡,維護心智模型分裂。

### 為什麼選 SQLite

- **基礎設施已就位**:`DatabaseManager` + `drizzle-orm` + `better-sqlite3` 跑得穩;沒新依賴。
- **交易支援**:多表寫入走 `db.transaction()`,原子性 ── 解決現行 JSON 整檔寫入的 race / 半寫風險。
- **Row-level update**:改一筆 sidebar item 不必整陣列 stringify。
- **可查詢**:`WHERE enabled = 1 ORDER BY ord` 比 `.filter()` 更自然,日後 UI 篩選 / 排序好寫。
- **跟 work_records 共升級邏輯**:都在 `userData/app.db`,electron-updater 升級不會碰;drizzle migration 處理 schema 演進。

---

## 2. 既有機制盤點

重寫前先明確當前 ConfigManager 已有的能力,確保重構後**等價或更好**,不能退化:

| 既有機制 | 位置 | 行為 |
|---|---|---|
| `DEFAULT_CONFIG` | `config-manager.ts` 頂部常數 | 兜底預設;dev 缺檔 / prod 複製失敗時直接用 |
| `app-config.json` seed | `config/app-config.json`(extraResources)| 打包進 `resources/`;首次安裝走 `copyDefaultConfig` 複製到 userData |
| `copyDefaultConfig` 防覆蓋 | `load()` 內 `!existsSync` 守衛 | 已修;只有 userData 沒檔時才複製 |
| `deepMerge` 深合並 | `load()` 內 | 讀進 userData JSON 後跟 `DEFAULT_CONFIG` 深合並,新增欄位有預設值;陣列直接替換不混合 |
| `appendMissingById` 補種 | `load()` 末段 | 對 `sidebar.items` / `personalFunctions.tools` 兩個列表,按 `id` 補進使用者 JSON 內缺少的預設 entry(保留使用者順序,缺的追加尾部) |
| `writeConfig(partial)` | IPC `CONFIG_WRITE` → ConfigManager | deepMerge + writeFileSync;成功後**不發 push** |
| 渲染端同步 | `config.store.ts` `writeConfig()` | invoke 後**自己再呼叫一次 `loadConfig()`** 重抓最新 |
| `PUSH_CONFIG_CHANGED` | `ipc-channels/config.ts` | **dead channel** —— App.vue 訂閱了,但專案內沒人 `send`。寫入後渲染端靠自己 reload,不需要 push |
| `version` 注入 | `getConfig()` 內 | runtime 從 `app.getVersion()` 注入,不寫進 JSON |

**重點**:重構後這些行為必須**全部保留或更好**(尤其 `appendMissingById` 的補新 entry、`writeConfig` 後渲染端自己 reload 的機制)。

---

## 3. 取捨與選型

### 方案 A:單一 KV 表

```
app_config (key TEXT PK, value TEXT JSON)
```

把每個 section 整包 `JSON.stringify` 存。

| 優 | 缺 |
|---|---|
| 改動極小 | 失去關聯式優勢,還是要 JSON.parse |
| schema 演化自由 | 跟 JSON 本質無差別 |

### 方案 B:全部正規化(每個 section 一張表)

10 張表(`app_settings` / `sidebar_items` / `system_links` / `floating_ball_settings` / `quick_menu_items` / `unified_platform_systems` / `internal_tools` / `personal_tools` / `update_settings` / `work_collect_settings`)。

| 優 | 缺 |
|---|---|
| 欄位級型別 | 10 張表,migration 文件變多 |
| Collection CRUD 自然 | Singleton 表多半只有 1 行,空蕩 |
| UI 編輯體驗最好 | seed 邏輯複雜 |

### 方案 C(選定):混合

- **Singleton 設定** → 統一 KV 表 `app_settings_kv`(key 例:`app.language`)
- **Collection 設定** → 每個列表一張表 + `ord` 排序欄

| 集合 | 表名 |
|---|---|
| sidebar.items | `sidebar_items` |
| systemLinks.items | `system_links` |
| floatingBall.quickMenu | `quick_menu_items` |
| unifiedPlatform.systems | `unified_platform_systems` |
| internalFunctions.tools | `internal_tools` |
| personalFunctions.tools | `personal_tools` |

**為什麼選 C**:
- Singleton 散值用 KV 不開單行表,schema 不會頻繁變
- Collection 才真正需要正規化(CRUD / 排序 / enabled 過濾)
- 比 A 多得到 row-level update;比 B 少 4 張空蕩 singleton 表

---

## 4. 表結構

放在 `electron/main/db/features/config/schema.ts`。

### 4.1 `app_settings_kv`(singleton 群)

```ts
app_settings_kv
  key       TEXT PRIMARY KEY    -- 例 'app.language' / 'workCollect.intervalMinutes'
  value     TEXT NOT NULL       -- 一律 JSON.stringify(數字 / 布林 / 物件統一字串化)
  updatedAt INTEGER NOT NULL    -- Unix ms
```

key 列表(對應現行 AppConfig 內所有 singleton 散值):

| 區段 | keys |
|---|---|
| app | `app.language` / `app.startMinimized` / `app.launchOnStartup` |
| sidebar | `sidebar.defaultCollapsed` |
| floatingBall | `floatingBall.size` / `.opacity` / `.defaultPosition` / `.snapToEdge` |
| internalFunctions | `internalFunctions.apiBaseUrl` / `.apiTimeout` |
| update | `update.enabled` / `.feedUrl` / `.channel` / `.dailyCheckTime` / `.autoDownload` / `.autoInstallOnAppQuit` |
| workCollect | `workCollect.enabled` / `.intervalMinutes` / `.workStartHour` / `.workEndHour` |

**為什麼 value 一律 stringify**:
- 避免 SQLite 弱型別(`123` / `"123"` / `0` / `false` 混在 TEXT 難判斷)
- 反序列化集中在 repository 一處
- 對使用者透明:仍然 `configStore.appConfig.app.language` 拿到原始型別

### 4.2 Collection 表(6 張)

```ts
sidebar_items
  id        TEXT PRIMARY KEY        -- 'unified-platform' 等
  label     TEXT NOT NULL
  icon      TEXT NOT NULL
  routeName TEXT NOT NULL
  enabled   INTEGER NOT NULL DEFAULT 1   -- 0/1 boolean
  badge     TEXT                          -- 可空
  ord       INTEGER NOT NULL              -- 渲染順序(數字小在前)

INDEX idx_sidebar_items_ord (ord)
```

```ts
system_links  (id, label, icon, url, enabled, ord)
internal_tools  (id, name, description, icon, enabled, openMode, routeName?, url?, ord)
personal_tools  (id, name, description, icon, enabled, openMode, routeName?, ord)
unified_platform_systems  (id, name, description, url, iconUrl?, openMode, ssoEnabled, ssoTokenParam?, ord)

quick_menu_items
  id        TEXT PRIMARY KEY
  label     TEXT NOT NULL
  icon      TEXT                              -- 可空
  enabled   INTEGER NOT NULL DEFAULT 1
  separator INTEGER NOT NULL DEFAULT 0
  -- action discriminated union 拆欄,組裝時依 actionType 還原
  actionType      TEXT NOT NULL               -- 'show-main-window'/'navigate'/'open-url'/'quit-app'
  actionRouteName TEXT                         -- actionType='navigate' 時用
  actionUrl       TEXT                         -- actionType='open-url' 時用
  actionTarget    TEXT                         -- 'browser'/'iframe'
  ord       INTEGER NOT NULL
```

### 4.3 命名規範

- **`ord` 而非 `order`** —— `order` 是 SQL keyword,跨工具(sqlite cli / DBeaver)輸入易踩坑
- **boolean 用 INTEGER 0/1** —— SQLite 沒原生 boolean,跟 `work_records.isDone` / `user_profiles` 慣例一致
- **欄位用 camelCase** —— 跟 `work_records` / `user_profiles` 既有表一致

---

## 5. 讀寫流程

### 5.1 啟動讀全 config

```
DatabaseManager.init()      (main/index.ts line 114,已先於 ConfigManager)
   │
ConfigManager.load()        (line 148)
   │
   ├─ 判斷 DB 是否已 seeded
   │    └─ select count(*) from app_settings_kv
   │       >0 表示已 seeded(可能來自首次安裝 seed 或既有使用者升級遷移)
   │       =0 表示首次啟動 → 走 §7 seed 流程
   ├─ 讀全表組 AppConfig:
   │    ├─ select * from app_settings_kv           → 解 key 拆出 app/floatingBall/update/... 各 singleton 欄位
   │    ├─ select * from sidebar_items ORDER BY ord → 組 sidebar.items[]
   │    ├─ select * from system_links ORDER BY ord
   │    ├─ select * from quick_menu_items ORDER BY ord
   │    ├─ select * from unified_platform_systems ORDER BY ord
   │    ├─ select * from internal_tools ORDER BY ord
   │    └─ select * from personal_tools ORDER BY ord
   ├─ in-memory cache:組好的 AppConfig 存在 ConfigManager 內(getConfig() 直接回)
   └─ 補種(§7.2):比對程式碼 default 跟 DB,把缺的 row 補進(對應現行 appendMissingById)
```

所有 select 走同一個 readonly transaction,毫秒級完成。

### 5.2 寫入(partial update)

對齊現行行為 ── **不發 push,renderer 自己 reload**:

```
渲染端 store.writeConfig(partial)
   │
   ├─ await window.electronAPI.config.write(partial)   ← IPC invoke
   │    │
   │    └─ ConfigManager.writeConfig(partial)
   │         走 db.transaction(tx => {
   │           遍歷 partial:
   │             ├─ singleton 欄位 → upsert app_settings_kv (key, JSON.stringify(value))
   │             └─ collection 欄位 → DELETE FROM <table> + 重新 INSERT(整批替換)
   │           transaction 內任一失敗 → rollback,DB 維持原狀
   │         })
   │    重新組裝 in-memory cache
   │    return(invoke resolve)
   │
   └─ await loadConfig()    ← store 自己再呼叫一次 read 同步本地
```

**完全沒有 PUSH_CONFIG_CHANGED**(現行就沒人發,重構後也不引入)。

### 5.3 整集合替換 vs row-level update 的取捨

| 情境 | 策略 |
|---|---|
| `partial.workCollect.enabled = true`(單一 singleton) | upsert 一個 KV row |
| `partial.sidebar.items = [...]`(整個陣列傳進來) | DELETE + 重新 INSERT(整批替換) |

選擇「整集合替換」是為了**跟現行 `deepMerge` 內陣列替換語意一致**(陣列不深合並,直接替換),既有 caller 不必改。

⚠️ **Trade-off**:若未來 row 帶有「使用者個人化的 per-row 元資料」(例 `lastUsedAt` / `userNote`),整集合替換會抹掉。MVP 階段所有欄位都是「配置型」資料,無此風險;真要加 per-row 動態欄位時,須改成「row-level upsert + diff delete」。

---

## 6. 既有契約如何保留

### 6.1 對外 type `AppConfig` 不變

`src/types/config/*` 所有型別**沿用**。`getConfig()` 仍回 `AppConfig`,渲染端的 `configStore.appConfig.workCollect.enabled` 等 100+ 處讀取程式碼**完全不必改**。

### 6.2 IPC 契約不變

- `CONFIG_READ` → `Promise<AppConfig>`(內部從多表組裝)
- `CONFIG_WRITE` → `Promise<void>`,payload `Partial<AppConfig>`(內部分派到表寫入)
- `PUSH_CONFIG_CHANGED` 維持 channel 定義跟訂閱(App.vue 訂閱端不刪);**重構後一樣沒人發**,跟現行一致

### 6.3 ConfigManager 對外 API 不變

```ts
class ConfigManager {
  async load(): Promise<void>
  getConfig(): AppConfig                 // 仍注入 version: app.getVersion()
  async writeConfig(partial: Partial<AppConfig>): Promise<void>
  getUpdateConfig(): AppConfig['update'] // 既有便利方法,保留
}
```

實作從 fs.readFileSync → drizzle select,**對外 API 0 變化**。

### 6.4 `version` 注入保留

`getConfig()` 內 `{ ...this.config, version: app.getVersion() }` 這行**必須保留**(`AppConfig.version` 對外契約,electron-updater 比對 / UI 顯示都靠它)。

### 6.5 渲染端 store reload 機制不變

`config.store.ts` 內 `writeConfig` 仍是 invoke 完自己 `loadConfig()`(line 86)。**不改 store**,只動 ConfigManager 內部實作。

---

## 7. Seed / 升級 / 既有使用者遷移

這是這份設計**最關鍵也最易出錯**的部分。三種情境必須處理對:

### 7.1 三種啟動情境(方案 A:完全棄用 JSON)

| 情境 | DB `app_settings_kv` 狀態 | userData/app-config.json 狀態 | 動作 |
|---|---|---|---|
| **首次安裝**(乾淨環境) | 表存在但 count = 0 | 不存在 | 從 `DEFAULT_CONFIG`(code 常數)seed 進 DB |
| **既有使用者升級**(從 JSON 版本上來) | count = 0 | 存在(可能含使用者已寫入的設定) | 從 `DEFAULT_CONFIG` seed,**設定還原 default**;舊 JSON 被 `cleanupLegacyJson()` 刪除 |
| **同版本 / 已 seed 後啟動** | count > 0 | 不存在(已刪) | 不 seed,直接讀 DB |
| **版本升級(已是 DB 模式)** | count > 0 | 不存在 | 不 seed;走 §7.2 「補種」處理新增 entry / 新欄位 |

### 7.2 Dev-owned vs User-owned Resync(取代原 `appendMissingById`)

設計目標:**開發者改 `defaults.ts` 後,使用者升級看到一致內容**。

每次啟動 `ConfigManager.load()` 內呼叫 `resyncDevOwnedConfig(db)`,做兩件事:

#### 1. 6 張 collection 表 全部 dev-owned → 整批 reset

```ts
// 對每張表:DELETE 全部 + INSERT defaults
sidebar_items / system_links / quick_menu_items / unified_platform_systems / internal_tools / personal_tools
```

效果:
- 開發者改 `defaults.ts` 內順序 / 名稱 / icon / enabled → 升級後使用者看到一致
- 新增 / 刪除 entry → 升級後使用者跟著新增 / 刪除
- 使用者本地修改(如果未來有 UI)會被覆蓋 ── 接受這個取捨

#### 2. KV 散值:按 `USER_OWNED_KEYS` 區分

| 類型 | 鍵 | 升級時 |
|---|---|---|
| **Dev-owned**(基礎設施) | `internalFunctions.apiBaseUrl` / `apiTimeout` / `update.feedUrl` / `update.channel` / `update.dailyCheckTime` | upsert 成 default |
| **Dev-owned**(公司強制策略) | `app.launchOnStartup` / `update.enabled` / `update.autoInstallOnAppQuit` | upsert 成 default(使用者改不掉) |
| **User-owned** | `app.language` / `app.startMinimized` / `sidebar.defaultCollapsed` / `floatingBall.*` / `update.autoDownload` / `workCollect.*` | **保留**(使用者改過的不動) |

判斷準則:
- 「**結構性 / 部署性**」配置 → dev-owned(發版時統一推送)
- 「**公司強制策略**」(開機自啟 / 自動更新 / 後台靜默安裝)→ dev-owned(使用者改不掉,啟動 reset)
- 「**個人偏好性**」配置 → user-owned(保留)

### 7.3 既有使用者遷移演算法

```ts
function seedOrMigrate(db, prodResourcesPath, devProjectPath, userDataPath) {
  if (rowCount(app_settings_kv) > 0) return  // 已 seeded

  // 1. 決定 seed 來源:優先既有使用者 JSON,其次 ship 的 default
  const userDataJson = app.isPackaged ? userDataPath : null
  const shipJson = app.isPackaged
    ? join(process.resourcesPath, 'app-config.json')
    : join(app.getAppPath(), 'config', 'app-config.json')

  const seedSrc = userDataJson && existsSync(userDataJson) ? userDataJson : shipJson
  if (!existsSync(seedSrc)) {
    throw new Error('seed source 不存在,無法初始化 config')
  }

  const seed = JSON.parse(readFileSync(seedSrc, 'utf-8'))

  // 2. 跟程式碼 DEFAULT_CONFIG 深合並(現行 deepMerge + appendMissingById 等價邏輯)
  //    確保新增欄位 / 新增 entry 都有預設值
  const merged = mergeWithDefaults(seed)

  // 3. 寫入 DB(transaction)
  db.transaction(tx => {
    // singletons → app_settings_kv
    for (const [key, value] of flattenSingletons(merged)) {
      tx.insert(appSettingsKv).values({key, value: JSON.stringify(value), updatedAt: Date.now()}).run()
    }
    // collections → 各表
    merged.sidebar.items.forEach((it, ord) => tx.insert(sidebarItems).values({...it, ord}).run())
    // ...其他 5 張 collection 同款
  })

  // 4. 若來源是 userData JSON(既有使用者遷移),改名保留備份
  if (seedSrc === userDataJson) {
    renameSync(userDataJson, userDataJson + `.migrated-${Date.now()}`)
    logger.info('既有 JSON 設定已遷移進 DB,原檔已改名為 *.migrated-*', 'ConfigManager')
  }
}
```

關鍵點:
- **既有使用者升上來不會丟設定** ── 他們在 userData JSON 內的所有設定值會被讀進 DB
- **舊 JSON 不刪只改名** ── 萬一遷移有問題,DBA 還能撈出來救;改名後 ConfigManager 不再讀,不會混淆
- **failure 立即 throw 讓 app 啟動失敗** ── 不要靜默繼續用空 config

### 7.4 `app-config.json` 命運

- **`config/app-config.json`(專案根)**:**刪除**
- **`resources/app-config.json`(打包 ship)**:**不再 ship**;`package.json` 內 `extraResources` + `files` 條目已移除
- **`userData/app-config.json`(舊版本遺留)**:`seed.ts` 內 `cleanupLegacyJson()` 啟動時偵測並刪除
- **唯一 seed source**:`electron/main/db/features/config/defaults.ts` 內的 `DEFAULT_CONFIG`

---

## 8. 跟既有機制的對應關係

明確列出新舊機制的對應,讓 reviewer / 接手者快速看懂「砍掉什麼、由什麼取代」:

| 既有(JSON 模式) | 重構後(DB 模式) | 備註 |
|---|---|---|
| `DEFAULT_CONFIG`(code 常數) | 留在 `config/defaults.ts`,但**只作為 seed merge / backfill 比對基準**,runtime 不直接用 | 不是「fallback」是「比對源」,語意更清楚 |
| `config/app-config.json`(ship) | 仍 ship,**只作為 seed source** | extraResources 配置不動 |
| `userData/app-config.json` | **不再產生**,既有檔案首次啟動讀完改名保留 | 對既有使用者無痛 |
| `copyDefaultConfig()` | **刪除** | 改名為 `seedOrMigrate()`,行為更明確 |
| `deepMerge(DEFAULT_CONFIG, parsed)` | **只在 seed 階段執行一次**(merge with defaults 後寫進 DB) | runtime 直接讀 DB,不再 runtime merge |
| `appendMissingById` 補種(只覆蓋 sidebar / personalFunctions.tools) | **升級為 `resyncDevOwnedConfig`**,覆蓋全 6 張 collection 表 + 部分 KV(dev-owned),user-owned KV 保留 | 行為加強:dev 改 defaults.ts 後使用者升級看到一致 |
| `writeFileSync(JSON.stringify(...))` | `db.transaction(tx => { upsert / delete + insert })` | 原子性 + row-level update |
| `getConfig()` in-memory cache | 同款 in-memory cache,但**從 DB 組裝**而非 JSON 解析 | 對外 API 不變 |
| `PUSH_CONFIG_CHANGED` dead channel | **仍 dead** | 不引入新觸發點;訂閱端不刪以保留未來擴展空間 |

---

## 9. 資料邊界

### 9.1 跟其他 SQLite 表的關係

```
app.db (userData/app.db)
├── logs                      ← 跨帳號保留(技術日誌)
├── work_records              ← per-user;AccountChangeCleaner 會清
├── user_profiles             ← per-user;AccountChangeCleaner 會清
└── 【新】config 相關表        ← 機器級設定,跨帳號保留
    ├── app_settings_kv
    ├── sidebar_items
    ├── system_links
    ├── quick_menu_items
    ├── unified_platform_systems
    ├── internal_tools
    └── personal_tools
```

**config 表屬於機器**,跨帳號保留,**不會被 `AccountChangeCleaner` 清掉**(`account-change-cleaner.ts` 內部清空清單不加 config 表)。

### 9.2 跟敏感資料隔離

- config 不含 password / token 等敏感資料
- `update.feedUrl` 等內網 URL 算半敏感,但本來就 ship 在 JSON 內,DB 化不增加風險
- DB 整體仍在 `userData/app.db`,Windows OS 帳號級隔離

---

## 10. 影響檔案清單

### 新增

```
docs/13-Config-DB-重構設計.md                                本檔
electron/main/db/features/config/schema.ts                    7 張表的 drizzle 定義(1 KV + 6 collection)
electron/main/db/features/config/repository.ts                CRUD:assembleAppConfig() + applyPartial() + backfillMissingEntries()
electron/main/db/features/config/seed.ts                      seedOrMigrate():§7.3 演算法
electron/main/db/features/config/defaults.ts                  舊 DEFAULT_CONFIG 搬過來(seed merge / backfill 用的比對基準)
electron/main/db/migrations/000X_config_tables.sql            drizzle-kit 自動產
```

### 大改

```
electron/main/config-manager.ts
  ├─ 刪 DEFAULT_CONFIG 常數(搬到 defaults.ts)
  ├─ 刪 readFileSync / writeFileSync / copyDefaultConfig / deepMerge / withDefaultListItems / appendMissingById
  ├─ constructor 改成接受 DatabaseManager(注入依賴)
  ├─ load() 內呼叫 seedOrMigrate + assembleAppConfig + backfillMissingEntries
  ├─ getConfig() 仍從 in-memory cache 回(保留 version 注入)
  └─ writeConfig() 改走 repository.applyPartial(走 transaction)
```

### 小改

```
electron/main/db/features/index.ts             drizzle barrel 加 config schema export
electron/main/index.ts                          ConfigManager constructor 改傳 dbManager(line 147 附近);順序不變(DB 仍先於 Config)
```

### 不動

- `src/types/config/*` 所有 TypeScript 型別(維持 AppConfig 對外契約)
- `src/stores/config.store.ts`(IPC 契約不變)
- `electron/main/ipc-handlers/config.handlers.ts`(CONFIG_READ / CONFIG_WRITE 行為一致)
- 所有 `configStore.appConfig.X.Y` 的 100+ 處消費點
- `config/app-config.json`(內容不動,仍作為 ship seed;`_comment` 可選擇順手清,留下不影響功能)
- `package.json` extraResources 配置(JSON 仍要 ship 進 `resources/`)

---

## 11. MVP 切分

### Phase 1:Schema + Seed + Migration(不接 ConfigManager)

1. 寫 `db/features/config/schema.ts`(7 張表 drizzle 定義)
2. `npm run db:generate` 產 migration
3. 寫 `db/features/config/defaults.ts`(把現行 `DEFAULT_CONFIG` 搬過去,**不刪 ConfigManager 內的**,並存階段)
4. 寫 `db/features/config/seed.ts`:`seedOrMigrate()` 含「優先讀 userData JSON」邏輯
5. 寫 `db/features/config/repository.ts`:`assembleAppConfig()` + `backfillMissingEntries()`(寫入暫不實作)
6. **手動驗收**(專案沒測試框架,不寫 unit test):
   - 刪掉 dev 環境 app.db + userData JSON,啟動 → 看 DB 是否從 ship JSON 正確 seed
   - 模擬「既有使用者升級」:把含自訂值的 JSON 放 userData,啟動 → 看 DB 是否從該 JSON seed 並改名

### Phase 2:ConfigManager 改寫(切換 runtime source)

1. 寫 `repository.applyPartial(partial)`(transaction 內分派寫入)
2. ConfigManager 改成走 repository:`load` / `getConfig` / `writeConfig` 全改
3. ConfigManager constructor 改接受 dbManager;main/index.ts line 147 同步改
4. 刪掉 ConfigManager 內 `DEFAULT_CONFIG` 常數 + 所有 fs 操作 + `deepMerge` / `withDefaultListItems` / `appendMissingById` / `copyDefaultConfig`
5. **手動驗收**:
   - 既有功能行為一致(打開 app 各頁面正常)
   - Settings 改語言 → DB row 變動 → 重啟仍生效
   - Workcollect toggle 開關 → DB row 變動,跨重啟保留
   - 統一平台 / 內部功能 / 個人功能卡片渲染正常

### Phase 3:Cleanup

1. config/app-config.json 內 `_comment*` 順手清掉(可選;留著無害但累贅)
2. 更新 `docs/04-配置说明.md` 標明「runtime 走 DB,JSON 只是 seed」
3. 加 `npm run config:dump` 把 DB 內 config 印 JSON 出來,方便 debug(可選,看實際 dev 需求)

---

## 12. Out of scope

- ❌ Settings UI 直接編 collection(sidebar items / tools)── 這次只把資料層搬家
- ❌ 動態新增 sidebar item / tool 的 UI
- ❌ 配置版本控制(誰在何時改了什麼)
- ❌ 配置雲端同步(跨機器同步)
- ❌ 多設定檔切換(profile A / B)
- ❌ Deletion tombstone(「真正刪除」一個 entry,不再被 backfill 補回)
- ❌ AccountChangeCleaner 對 config 表的清空(config 屬於機器,不該被帳號變更清掉)
- ❌ 動 `PUSH_CONFIG_CHANGED` 觸發機制(現行就沒人發,重構後也不引入新觸發)

---

## 13. 風險與回滾

### 主要風險

| 風險 | 機率 | 影響 | 緩解 |
|---|---|---|---|
| seed / 遷移邏輯 bug → 既有使用者升級丟設定 | 中 | **高**(使用者投訴) | userData JSON 不刪只改名;Phase 1 手動驗收必跑;先在 dev 模擬遷移情境 |
| backfill 對「使用者主動刪除過 entry」會補回 | 中 | 低(行為跟現行一致,使用者已習慣) | doc §7.2 寫明;未來想真正刪除須另設計 tombstone |
| Partial<AppConfig> 寫入時遺漏某 collection 處理分支 | 低 | 中(寫入靜默失敗) | repository 內 explicit 處理每個 key;Phase 2 手動驗收每個 section |
| 跨 OS 路徑 / 權限 | 低 | 高 | 沿用 `app.getPath('userData')` 跟 work_records 同基礎 |
| ConfigManager constructor 簽名改 → main/index.ts 順序敏感 | 低 | 高 | DB 已先於 Config init(line 113-114 vs 147),順序不需動;只改 constructor 注入 |

### 回滾策略

- **程式碼層**:git revert 整個 PR
- **資料層**:新加的 7 張 config 表獨立於 work_records / user_profiles,可單獨 DROP
- **使用者資料**:userData 內的 `.migrated-<ts>` 改名 JSON 可改回 `app-config.json`,revert 後 ConfigManager 重新讀 JSON → 等於回到重構前狀態

**重構可逆,不會把使用者鎖死在新模式**。

---

## 附:跟既有架構的一致性

- **DB**:跟 `work_records` / `user_profiles` / `logs` 一樣走 `db/features/<name>/schema.ts`(`config/` 多加 `repository.ts` / `seed.ts` / `defaults.ts` 因為它組裝 AppConfig 比純 CRUD 複雜)
- **Drizzle barrel**:加進 `db/features/index.ts`
- **Migration**:走 drizzle-kit + 既有 `viteStaticCopy` 把 SQL 拷貝到 `out/main/migrations/`(沿用既有,不動 vite config)
- **IPC**:`CONFIG_READ` / `CONFIG_WRITE` 完全不動,Renderer 0 感
- **註解風格**:中文繁體,描述「為什麼這樣做」而不是「做了什麼」
