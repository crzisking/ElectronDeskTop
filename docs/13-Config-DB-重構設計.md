# Config 持久化從 JSON 遷移到 SQLite 設計

> 取代 `config/app-config.json` 為唯一 runtime source。
> 所有設定項落地到 SQLite,跟 `logs` / `work_records` / `user_profiles` 共用 `app.db`。
> JSON 檔變成**首次啟動的 seed 來源**,之後 runtime 不再讀 JSON。

---

## 目錄

1. [動機](#1-動機)
2. [取捨與選型](#2-取捨與選型)
3. [表結構](#3-表結構)
4. [讀寫流程](#4-讀寫流程)
5. [既有契約如何保留](#5-既有契約如何保留)
6. [首次啟動 / 升級 / Seed 邏輯](#6-首次啟動--升級--seed-邏輯)
7. [熱重載對策](#7-熱重載對策)
8. [未來的 UI 編輯能力](#8-未來的-ui-編輯能力)
9. [資料邊界](#9-資料邊界)
10. [影響檔案清單](#10-影響檔案清單)
11. [MVP 切分](#11-mvp-切分)
12. [Out of scope](#12-out-of-scope)
13. [風險與回滾](#13-風險與回滾)

---

## 1. 動機

### 現狀痛點

JSON 模式跑了一段時間,累積以下問題:

- **覆蓋風險**:`copyDefaultConfig()` 之前每次啟動覆蓋 userData(已修,但這個 bug 顯示 JSON 雙來源容易出事)
- **手動同步**:`DEFAULT_CONFIG`(code)和 `app-config.json`(file)兩處要對齊,容易 drift
- **註解雜物**:`_comment` / `_comment_xxx` 散在 JSON 內,排版混亂,改動容易遺漏
- **deepMerge 行為微妙**:陣列整個替換 vs 物件深合並,新人不容易掌握
- **多筆資料 CRUD 麻煩**:`sidebar.items`、`tools` 等陣列要 UI 編輯,得整檔 read-modify-write,沒有原子性
- **跟 SQLite 升級體驗不對等**:`work_records`、`user_profiles` 經 SQLite 升級無痛保留;config 也走 userData 卻長期被 `copyDefaultConfig` 覆蓋邏輯困擾

### 為什麼選 SQLite

- **基礎設施已就位**:`DatabaseManager` + `drizzle` + `better-sqlite3` 都跑得很穩,不引入新依賴
- **升級保留**:跟 `work_records` 一樣,在 userData 內,electron-updater 升級不會被碰
- **交易支援**:多表寫入走 `db.transaction()` 原子性
- **可查詢**:`WHERE enabled = 1 ORDER BY order` 比 JSON `.filter(x => x.enabled)` 更自然
- **少寫一段 JSON 解析容錯**:Type-safe schema (`$inferSelect` / `$inferInsert`) 自動產

---

## 2. 取捨與選型

### 方案 A:單一 `app_config` KV 表

```sql
app_config (key TEXT PRIMARY KEY, value TEXT JSON)
```

把每個 section 整包 `JSON.stringify` 存進 value。

| 優 | 缺 |
|---|---|
| 改動極小,1 張表搞定 | 失去關聯式優勢,還是要 JSON.parse |
| schema 演化最自由 | 沒有欄位級型別,跟現在 JSON 沒本質差別 |
| 查單一 section 快 | UI 改一筆 sidebar item 仍要整包 stringify 寫回 |

### 方案 B:每個 section 一張表(完全正規化)

```
app_settings                  (singleton)
sidebar_items                 (collection)
system_links                  (collection)
floating_ball_settings        (singleton)
quick_menu_items              (collection;FK to floating_ball 概念)
unified_platform_systems      (collection)
internal_tools                (collection)
personal_tools                (collection)
update_settings               (singleton)
work_collect_settings         (singleton)
```

| 優 | 缺 |
|---|---|
| 欄位級型別,drizzle infer 出 TypeScript type | 10 張表,migration 文件變多 |
| Collection CRUD 自然(insert / update / delete 單行) | 寫入要懂得拆 partial → 對應表 |
| 查 `enabled=1` 可下到 SQL,不必載到記憶體 | 啟動讀全 config 要 10 次 select(可在一個交易內完成) |
| UI 編輯體驗最好 | 跟 JSON 對齊的 seed 邏輯複雜 |

### 方案 C(我選):混合

- **Singleton 設定**:統一一張 `app_settings_kv` KV 表(key 例:`app.language`、`floatingBall.size`)
- **Collection 設定**:每個集合一張表,有自己的欄位 + `order` 列

| 集合 | 表 |
|---|---|
| sidebar.items | `sidebar_items` |
| systemLinks.items | `system_links` |
| floatingBall.quickMenu | `quick_menu_items` |
| unifiedPlatform.systems | `unified_platform_systems` |
| internalFunctions.tools | `internal_tools` |
| personalFunctions.tools | `personal_tools` |

| Singleton 散值 | KV key |
|---|---|
| app.language | `app.language` |
| app.startMinimized | `app.startMinimized` |
| app.launchOnStartup | `app.launchOnStartup` |
| sidebar.defaultCollapsed | `sidebar.defaultCollapsed` |
| floatingBall.size | `floatingBall.size` |
| floatingBall.opacity | `floatingBall.opacity` |
| floatingBall.defaultPosition | `floatingBall.defaultPosition` (JSON `{x,y}`) |
| floatingBall.snapToEdge | `floatingBall.snapToEdge` |
| internalFunctions.apiBaseUrl | `internalFunctions.apiBaseUrl` |
| internalFunctions.apiTimeout | `internalFunctions.apiTimeout` |
| update.* | `update.enabled` / `update.feedUrl` / ... |
| workCollect.* | `workCollect.enabled` / ... |

**為什麼選 C 而非 B**:
- Singleton 設定通常是平鋪 / 互不相關的個別值(語言、開機自啟、定時時間),做成 6-7 張單行表 schema 太碎
- 用 KV 表存,欄位 schema 不會頻繁變,只動 ConfigManager 內的 key 列表
- Collection 才真正需要正規化(CRUD、排序、enabled 過濾)

**為什麼不選 A**:
- KV 存整包 JSON 等於 JSON-in-DB,沒得到 DB 真正好處
- Collection 場景(新增一個 sidebar item)還是要整包 stringify

---

## 3. 表結構

DDL 走 drizzle schema,放在 `electron/main/db/features/config/`。

### 3.1 `app_settings_kv`(singleton 群)

```ts
app_settings_kv
  key       TEXT PRIMARY KEY    -- 例:'app.language' / 'workCollect.intervalMinutes'
  value     TEXT NOT NULL       -- JSON.stringify 過的值(數字 / 布林 / 物件統一字串化)
  updatedAt INTEGER NOT NULL    -- Unix ms,最後寫入時間
```

**為什麼 value 一律 stringify**:
- 避免 SQLite 的弱型別(`123` / `"123"` / `0` / `false` 混在 TEXT 欄位難判斷)
- 反序列化集中在 ConfigManager 一處
- 對使用者來說透明:仍然從 `configStore.appConfig.app.language` 拿到原始型別

例:
```
key='app.language'                  value='"zh-TW"'
key='workCollect.enabled'           value='false'
key='floatingBall.defaultPosition'  value='{"x":100,"y":300}'
```

### 3.2 Collection 表(7 張,結構各自典型)

```ts
sidebar_items
  id        TEXT PRIMARY KEY        -- 'unified-platform' / 'internal-functions' / ...
  label     TEXT NOT NULL
  icon      TEXT NOT NULL
  routeName TEXT NOT NULL
  enabled   INTEGER NOT NULL DEFAULT 1   -- 0/1 boolean
  badge     TEXT                          -- 可空
  ord       INTEGER NOT NULL              -- 渲染順序(數字小的在前;不用 `order` 因為 SQL keyword)

INDEX idx_sidebar_items_order (ord)
```

```ts
system_links
  id        TEXT PRIMARY KEY
  label     TEXT NOT NULL
  icon      TEXT NOT NULL
  url       TEXT NOT NULL
  enabled   INTEGER NOT NULL DEFAULT 1
  ord       INTEGER NOT NULL
```

```ts
quick_menu_items
  id        TEXT PRIMARY KEY        -- 'menu-show-main' / 'menu-go-platform' / ...
  label     TEXT NOT NULL
  icon      TEXT                     -- 可空
  enabled   INTEGER NOT NULL DEFAULT 1
  separator INTEGER NOT NULL DEFAULT 0   -- 0/1
  -- action 拆成多欄,因為 type 是 discriminated union
  actionType      TEXT NOT NULL            -- 'show-main-window' / 'navigate' / 'open-url' / 'quit-app'
  actionRouteName TEXT                     -- 只在 actionType='navigate' 時非空
  actionUrl       TEXT                     -- 只在 actionType='open-url' 時非空
  actionTarget    TEXT                     -- 只在 actionType='open-url' 時 'browser'/'iframe'
  ord       INTEGER NOT NULL
```

```ts
unified_platform_systems
  id            TEXT PRIMARY KEY
  name          TEXT NOT NULL
  description   TEXT NOT NULL DEFAULT ''
  url           TEXT NOT NULL
  iconUrl       TEXT                     -- 可空
  openMode      TEXT NOT NULL            -- 'iframe' / 'external-browser' / 'electron-window'
  ssoEnabled    INTEGER NOT NULL DEFAULT 0
  ssoTokenParam TEXT                     -- 可空
  ord           INTEGER NOT NULL
```

```ts
internal_tools
  id          TEXT PRIMARY KEY
  name        TEXT NOT NULL
  description TEXT NOT NULL DEFAULT ''
  icon        TEXT NOT NULL
  enabled     INTEGER NOT NULL DEFAULT 1
  openMode    TEXT NOT NULL            -- 'page' / 'external'
  routeName   TEXT                     -- 可空
  url         TEXT                     -- 可空
  ord         INTEGER NOT NULL
```

```ts
personal_tools
  id          TEXT PRIMARY KEY
  name        TEXT NOT NULL
  description TEXT NOT NULL DEFAULT ''
  icon        TEXT NOT NULL
  enabled     INTEGER NOT NULL DEFAULT 1
  openMode    TEXT NOT NULL            -- 'page'(目前只支援這一種)
  routeName   TEXT                     -- 對應 vue router name
  ord         INTEGER NOT NULL
```

### 3.3 為什麼用 `ord` 而非 `order`

`order` 是 SQL keyword,drizzle 可以加引號處理,但跨工具(sqlite cli / DBeaver)輸入會踩坑。直接用 `ord` 避免歧義。

### 3.4 為什麼 boolean 用 INTEGER 0/1

SQLite 沒原生 boolean,drizzle 既有慣例就是用 INTEGER 0/1(看 `work_records.isDone` 一樣)。讀出來在 ConfigManager 內轉成 `boolean`。

---

## 4. 讀寫流程

### 4.1 啟動讀全 config

```
DatabaseManager.init()
   │
ConfigManager.load()
   │
   ├─ 偵測「DB 內是否已有 config 種子」
   │    └─ 簡單判斷:select count(*) from app_settings_kv,>0 表示已 seeded
   ├─ 未 seeded → 走 §6 首次啟動 seed 邏輯
   └─ 已 seeded → 讀全表組成 AppConfig:
        ├─ select * from app_settings_kv        → 解 key 拆出 app/floatingBall/update/... 各 section 的 singleton 欄位
        ├─ select * from sidebar_items          → 組 sidebar.items[]
        ├─ select * from system_links           → 組 systemLinks.items[]
        ├─ select * from quick_menu_items       → 組 floatingBall.quickMenu[]
        ├─ select * from unified_platform_systems → 組 unifiedPlatform.systems[]
        ├─ select * from internal_tools         → 組 internalFunctions.tools[]
        └─ select * from personal_tools         → 組 personalFunctions.tools[]
```

所有 select 走同一個 readonly transaction,毫秒級完成。**外部 API 仍是 `getConfig(): AppConfig`,渲染端 / IPC consumer 0 感**。

### 4.2 寫入(partial update)

```
IPC CONFIG_WRITE(partial: Partial<AppConfig>)
   │
ConfigManager.writeConfig(partial)
   │
   走 db.transaction(tx => {
     ├─ 遍歷 partial:
     │   ├─ app.* / floatingBall.size 等 singleton → tx.upsert app_settings_kv (key, JSON.stringify(value))
     │   ├─ sidebar.items / quickMenu / *.tools / systems
     │   │   → 整個 collection 替換(delete + insert),保留 ord 順序
     │   │   或 → 部分更新(若 partial 內某 collection 是 partial-of-list,需要 caller 約定;MVP 採整批替換,跟 deepMerge 現行陣列規則一致)
     │   └─ ...
     ├─ 整個 transaction 成功 → commit
     └─ 任一寫入失敗 → rollback,DB 維持原狀
   })
   │
   寫入成功後:
   ├─ 重 load 一次 in-memory cache
   └─ webContents.send(PUSH_CONFIG_CHANGED) 通知渲染端 reload
```

### 4.3 「partial vs 整集合替換」的取捨

| 情境 | 策略 |
|---|---|
| `partial.workCollect.enabled = true`(改單個 singleton) | upsert 一個 KV row |
| `partial.sidebar.items = [...]`(整個陣列傳進來) | DELETE FROM sidebar_items + INSERT 新陣列(走 transaction) |
| **新增一個 sidebar item**(partial 只想加一筆) | 約定:**MVP 仍要傳完整陣列**,跟現行 deepMerge 陣列替換語意一致;未來可加 `SIDEBAR_ITEM_ADD` 等 targeted IPC |

選 「整集合替換」是因為:
- 跟現行 `deepMerge` 陣列行為一致,既有呼叫端不必改
- 排序意圖明確(整批 ord 重排)
- caller 端心智模型簡單:「我把整個陣列改成 X」

---

## 5. 既有契約如何保留

### 5.1 對外 type:`AppConfig` 不變

`src/types/config/*` 整批 type 沿用。`getConfig()` 仍回 `AppConfig`,渲染端的 `configStore.appConfig.workCollect.enabled` 等 100+ 處讀取程式碼**完全不必改**。

### 5.2 IPC 契約不變

- `CONFIG_READ` → `Promise<AppConfig>`(內部從多表組裝,renderer 看不到差異)
- `CONFIG_WRITE` → `Promise<void>`,payload `Partial<AppConfig>`(內部分派到表寫入)

### 5.3 ConfigManager 對外 API 不變

```ts
class ConfigManager {
  async load(): Promise<void>                       // 一樣
  getConfig(): AppConfig                            // 一樣
  async writeConfig(partial: Partial<AppConfig>): Promise<void>  // 一樣
}
```

**只有內部實作改寫**(從 fs.readFileSync → drizzle select)。

### 5.4 DEFAULT_CONFIG 命運

`DEFAULT_CONFIG` 從 ConfigManager 拿掉,移到 **seed 模組**(`electron/main/db/features/config/seed.ts`),只在「DB 還沒種子」時用一次。

Runtime 永遠以 DB 為 source of truth,沒有 fallback 概念(DB 啟動就保證有資料,因為啟動時 seed 過)。

---

## 6. 首次啟動 / 升級 / Seed 邏輯

### 6.1 三種啟動情境

| 情境 | DB 內 config 表狀態 | 動作 |
|---|---|---|
| **首次安裝**(乾淨環境) | 表存在但 row count = 0 | 從 `resources/app-config.json`(extraResources)讀,逐表 seed |
| **同版本啟動**(已 seed 過) | row count > 0 | 直接讀,不動 seed |
| **版本升級**(electron-updater 換包) | row count > 0 + 可能有新欄位 / 新 collection | 跑 drizzle migration 演進 schema;**不重 seed**(使用者已調整過的設定不能被覆蓋) |

### 6.2 新增 config 欄位的「補種子」策略

如果新版本加了一個 collection(例:`personal_tools` 新增「番茄鐘」入口卡片),既有使用者升級後需要這條 row。處理方式 **不靠 seed 重跑**,而是:

- **單一 row 補種**:在 drizzle migration 的 SQL 內直接 `INSERT OR IGNORE INTO personal_tools (id, name, ...) VALUES (...)`
- 或在 ConfigManager.load() 完成後加一段「補種子」邏輯,比對程式碼預設清單跟 DB,缺哪些補哪些(略複雜,MVP 不做)

MVP 採方案 1:`INSERT OR IGNORE` 寫在 migration SQL 內,簡單粗暴。

### 6.3 `app-config.json` 還留著嗎

- **build 時**:仍打包進 `resources/app-config.json`(走 `extraResources`),作為**唯一 seed source**
- **runtime**:**不再讀**;`ConfigManager` 內所有 `readFileSync(this.configFilePath)` 全部刪掉
- **userData 內的 `app-config.json`**:升級後不會再產生新檔;舊安裝留下的可以保留(無害),也可在 migration 後一次性 cleanup
- **dev mode**:跟 prod 同款,JSON 只作為 seed,要改設定走 UI 或直接編輯 DB

### 6.4 第一次啟動的 seed 演算法

```ts
function seedIfEmpty(db, jsonSeedPath) {
  const count = db.select({c: count(*)}).from(appSettingsKv).get()
  if (count.c > 0) return  // 已 seeded,跳過

  const seed = JSON.parse(fs.readFileSync(jsonSeedPath, 'utf-8'))
  db.transaction(tx => {
    // 1. singletons → app_settings_kv
    flattenSingletons(seed).forEach(([key, value]) => {
      tx.insert(appSettingsKv).values({key, value: JSON.stringify(value), updatedAt: Date.now()}).run()
    })
    // 2. collections → 各表
    seed.sidebar.items.forEach((item, ord) => tx.insert(sidebarItems).values({...item, ord}).run())
    seed.systemLinks.items.forEach((item, ord) => ...)
    seed.floatingBall.quickMenu.forEach((item, ord) => ...)
    seed.unifiedPlatform.systems.forEach((sys, ord) => ...)
    seed.internalFunctions.tools.forEach((tool, ord) => ...)
    seed.personalFunctions.tools.forEach((tool, ord) => ...)
  })
}
```

seed 失敗(JSON 壞 / DB 寫不進去)→ throw,讓 app 啟動失敗(讓使用者重灌),不要靜默繼續用空 config。

---

## 7. 熱重載對策

### 7.1 現狀

`ConfigManager` 用 `chokidar` 監聽 `app-config.json` 改動,推 `PUSH_CONFIG_CHANGED` 給 renderer。

### 7.2 重構後

- 沒有 JSON 檔可以監聽
- 改設定**只走 `CONFIG_WRITE` IPC**,寫入後 main 端主動推 `PUSH_CONFIG_CHANGED`
- 渲染端體驗一致(收到 push → reload)

### 7.3 失去的能力

**「手動編輯 JSON 即時生效」這個 dev 場景沒了**。對策:

- dev 階段要改設定 → 用 SQLite browser(DBeaver / DB Browser for SQLite)直接編 `app.db`(改完 app 不會自動感知,要重啟 — 或者寫個 dev 工具觸發手動 reload IPC)
- 更乾淨:之後做設定 UI 後,改設定都走 UI
- 罕見的「批量改 collection」場景 → 寫個 dev script 直接 INSERT/UPDATE DB

評估:對內部團隊可接受;若團隊 push back,可以加一個 dev-only IPC `CONFIG_RELOAD` 給開發者手動觸發。

---

## 8. 未來的 UI 編輯能力

DB 化後,Settings 頁可以漸進開放編輯入口:

| 設定項 | UI 編輯難度 | 排程 |
|---|---|---|
| 語言 / 浮球大小 / 採集開關等 singleton | 已有 / 簡單,改 toggle / slider 即可 | 既有 Settings 頁繼續做 |
| sidebar.items 排序 / 啟用 | 中等,需要 drag-and-drop UI | 未來迭代 |
| 內部功能 / 個人功能新增卡片 | 中等,form + icon picker | 未來迭代 |
| 統一平台新增系統 | 中等 | 未來迭代 |
| 浮球 quickMenu 編輯 | 偏複雜(discriminated union action) | 之後再說 |

本次重構不開發 UI,只**讓未來開發 UI 變得可行**。

---

## 9. 資料邊界

### 9.1 跟其他 SQLite 表的關係

```
app.db (userData/app.db)
├── logs                      ← 跨帳號保留(技術日誌)
├── work_records              ← per-user;AccountChangeCleaner 會清
├── user_profiles             ← per-user;AccountChangeCleaner 會清
└── 【新】config 相關表        ← 機器級設定,跨帳號保留(語言、浮球位置 etc.)
    ├── app_settings_kv
    ├── sidebar_items
    ├── system_links
    ├── quick_menu_items
    ├── unified_platform_systems
    ├── internal_tools
    └── personal_tools
```

config 表**屬於機器**(不是某個帳號),所以**不會被 `AccountChangeCleaner` 清掉**。
這對齊 §6 「升級保留」的初衷 —— 使用者改過的設定永遠不被覆蓋。

### 9.2 跟釘釘 / JWT 等敏感資料的隔離

- config 沒有任何敏感資料(沒密碼 / 沒 token)
- `update.feedUrl` 等內網 URL 算半敏感,但本來就 ship 在 JSON 內,DB 化不增加風險
- DB 整體仍走 `userData/app.db`,跟 OS 帳號隔離(同台機器不同 Windows 使用者各自一份)

---

## 10. 影響檔案清單

### 新增

```
docs/13-Config-DB-重構設計.md                                本檔
electron/main/db/features/config/schema.ts                    所有 config 表的 drizzle 定義
electron/main/db/features/config/seed.ts                      第一次啟動時的 JSON → DB 種子邏輯
electron/main/db/features/config/repository.ts                各表 CRUD(讀:組成 AppConfig;寫:partial 分派)
electron/main/db/migrations/000X_config_tables.sql            drizzle-kit 自動產
```

### 大改

```
electron/main/config-manager.ts
  ├─ 拿掉 DEFAULT_CONFIG(移到 seed.ts)
  ├─ 拿掉 readFileSync / writeFileSync 邏輯
  ├─ 拿掉 chokidar 檔案監聽
  ├─ load() 改成:DatabaseManager.init() 後讀 DB,沒種子先 seed
  ├─ getConfig() 改成從 in-memory cache 回傳(load 時組好)
  └─ writeConfig() 改成 db.transaction 分派寫入
```

### 小改

```
electron/main/db/features/index.ts             drizzle barrel 加 config schema export
electron/main/index.ts                          確保 DatabaseManager.init() 在 ConfigManager.load() 之前
config/app-config.json                          內容不動(仍作為 seed);註解可順手收斂
package.json                                     extraResources 確保 app-config.json 仍打包
```

### 不動

- `src/types/config/*` 所有 TypeScript 型別(維持 AppConfig 對外契約)
- `src/stores/config.store.ts`(IPC 契約不變,內部完全感覺不到 source 換了)
- 所有 `configStore.appConfig.X.Y` 的 100+ 處使用點

---

## 11. MVP 切分

### Phase 1:Schema + Seed(最關鍵,不接 ConfigManager)

1. 寫 `config/schema.ts`(8 張表 drizzle 定義)
2. 跑 `npm run db:generate` 產出 migration
3. 寫 `config/seed.ts`(JSON → DB 邏輯)
4. 寫 unit test:給一份 sample JSON,seed 完讀回 DB 比對

**驗收**:在隔離 sample 環境內,seed 過後能用 raw drizzle 把所有資料查回來,結構跟 JSON 一致。

### Phase 2:ConfigManager 改寫

1. 寫 `config/repository.ts`,提供:
   - `assembleAppConfig(): AppConfig`(讀全表組成 AppConfig 物件)
   - `applyPartial(partial: Partial<AppConfig>): void`(分派寫入,transactional)
2. 改 `ConfigManager.load()`:DB 讀;未種子則 seed
3. 改 `getConfig()` / `writeConfig()` 走 repository
4. 拿掉 fs / chokidar
5. 把舊 `DEFAULT_CONFIG` 程式碼搬去 seed.ts(刪掉 ConfigManager 內的)

**驗收**:dev 啟動 app,所有頁面行為跟 JSON 模式一致;手動透過 Settings 改語言 → DB 內 `app.language` row 變動 → 重啟仍生效。

### Phase 3:Cleanup

1. 刪 `chokidar` dep(若只此處用)
2. 文檔更新:`docs/04-配置说明.md` 標明「runtime 走 DB,JSON 只是 seed」
3. 給開發者寫個 `npm run config:dump` 把 DB 內 config 印 JSON 出來,便於 debug

### Phase 4(後續迭代,不在這次)

- Settings UI 直接編 collection(sidebar items / tools)
- 配置匯出 / 匯入(備份用)

---

## 12. Out of scope

明確**不在這次重構範圍**的事:

- ❌ 配置版本控制(誰在何時改了什麼)
- ❌ 配置雲端同步(跨機器同步使用者設定)
- ❌ Settings UI 開發新編輯介面
- ❌ 動態新增 sidebar item / tool 的 UI
- ❌ 即時熱重載(編 JSON 即時生效這個 dev workflow)
- ❌ 多設定檔切換(profile A / B)
- ❌ AccountChangeCleaner 對 config 表的清空(config 屬於機器,不該被帳號變更清掉)

---

## 13. 風險與回滾

### 主要風險

| 風險 | 機率 | 影響 | 緩解 |
|---|---|---|---|
| seed 邏輯 bug 導致首次啟動 config 不正確 | 中 | 高(app 行為錯亂) | Phase 1 unit test 必跑;先在 dev 環境驗 |
| 升級時 migration 漏補新 row(例:加新 sidebar item) | 中 | 中(新功能入口看不到) | migration SQL 用 `INSERT OR IGNORE` 加 row;每個 PR 都要檢查 |
| `Partial<AppConfig>` 分派寫入時遺漏某個 collection | 低 | 中(寫入靜默失敗) | repository 內 explicit 處理每個 key;單元測試覆蓋 |
| chokidar 移除後 dev 體驗變差 | 高 | 低(只影響開發) | 可選做 dev-only `CONFIG_RELOAD` IPC |
| 跨 OS 路徑 / 權限問題 | 低 | 高 | 沿用 `app.getPath('userData')`,跟 work_records 同基礎 |

### 回滾策略

- 程式碼層:git revert 整個 PR
- 資料層:DB 內新加的 config 表不影響其他資料,可以單獨 DROP
- 既有 userData 內的 `app-config.json` 保留未刪 → revert 後 ConfigManager 重新讀 JSON,**等於回到重構前狀態**

換言之這個重構**可逆**,不會把使用者鎖死在新模式。

---

## 附:跟既有架構的一致性

- **DB**:跟 `work_records` / `user_profiles` / `logs` 一樣走 `db/features/<name>/{schema, service}.ts`(這次 service 改名 repository,因為它組裝 AppConfig 不只是純 CRUD)
- **Drizzle barrel**:加進 `db/features/index.ts`
- **IPC**:`CONFIG_READ` / `CONFIG_WRITE` 完全不動,Renderer 0 感
- **Migration**:走 drizzle-kit + electron-vite copy migrations plugin(沿用既有)
- **TypeScript 型別**:`AppConfig` 不動,新增的 `SidebarItemRow` 等 row 型別內部用
- **註解風格**:中文繁體,描述「為什麼這樣做」而不是「做了什麼」
