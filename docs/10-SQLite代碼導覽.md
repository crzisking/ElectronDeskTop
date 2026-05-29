# SQLite 代碼導覽

> 給新人 / 半年後的自己看的「**這套 SQLite 到底怎麼運作**」說明。
>
> 配套文件:
>  - [08-本地數據庫設計.md](./08-本地數據庫設計.md) — 為什麼這樣設計
>
> 本文不重複該份的內容,專心講「**現在實際長這樣**」。

---

## 目錄

1. [先看一張全景圖](#1-先看一張全景圖)
2. [3 個關鍵概念](#2-3-個關鍵概念)
3. [檔案一個一個過](#3-檔案一個一個過)
4. [一條日誌的生命旅程](#4-一條日誌的生命旅程)
5. [啟動與退出順序](#5-啟動與退出順序)
6. [Drizzle ORM 速通(看代碼夠用就好)](#6-drizzle-orm-速通)
7. [Migration 機制怎麼確保不重跑](#7-migration-機制怎麼確保不重跑)
8. [打包後檔案去哪了](#8-打包後檔案去哪了)
9. [常見維護操作](#9-常見維護操作)
10. [FAQ](#10-faq)

---

## 1. 先看一張全景圖

```
┌─────────────────────────────────────────────────────────────────┐
│  渲染進程 (Renderer, src/)                                      │
│                                                                 │
│  業務代碼  ───► src/utils/logger.ts                              │
│                    │                                            │
│                    ├─► console.* (DevTools 看得到)              │
│                    └─► window.electronAPI.log.write({...})      │
│                                                                 │
└────────────────────────────┬────────────────────────────────────┘
                             │ IPC 'log:write' (single direction)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  主進程 (Main, electron/main/)                                  │
│                                                                 │
│  log.handlers.ts (IPC 收件人)                                   │
│      │                                                          │
│      └─► writeRendererLog()  ◄── 主進程內部呼叫 logger.* 也走    │
│            │                       這條路徑的兄弟函式            │
│            │                                                    │
│            ├─► 寫 txt (只 ERROR)                                │
│            │    └─► log-file-writer.ts                          │
│            │         └─► <userData>/logs/main-*.log             │
│            │              <userData>/logs/renderer-*.log        │
│            │                                                    │
│            └─► 寫 DB (全等級)                                   │
│                 └─► _logService.write({...})                    │
│                      └─► drizzle insert                         │
│                           └─► <userData>/app.db (SQLite 檔)     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

兩條寫入路徑**互相獨立**:txt 那條失敗不影響 DB,DB 那條失敗不影響 txt。

---

## 2. 3 個關鍵概念

如果腦中只能記三件事,記這些:

### 概念 ① — 「全等級進 DB,只 ERROR 進 txt」

| 等級 | DB(SQLite) | txt 檔 |
|---|---|---|
| debug | ✓ | ✗ |
| info  | ✓ | ✗ |
| warn  | ✓ | ✗ |
| error | ✓ | ✓ |

**為什麼**:txt 是給客戶 / 支援人員拿走排查用的「物證」,只放重要的;DB 是給開發者後續查詢用的「全紀錄」,什麼都進。

### 概念 ② — 「DB 只活在主進程」

渲染進程**不認識** better-sqlite3、不會 import drizzle。任何寫日誌都透過 IPC 轉發到主進程,主進程才真正動手寫檔。

**為什麼**:Electron 渲染進程是 sandbox + contextIsolation 環境,不能直接 require native module。主進程當「DB 管家」,渲染進程當「客戶」,中間隔一道 IPC 牆。

### 概念 ③ — 「DB 失敗時 App 不掛」

若 DB 開不起來(權限問題、磁碟壞了),App **照常啟動**,只是 SQLite 那一支不寫東西;txt 跟 console 仍正常運作。

**為什麼**:日誌是輔助,不是業務核心。日誌系統掛掉不能拖累整個 App。

---

## 3. 檔案一個一個過

按重要性順序,**全部 6 個檔加 1 個 plugin**。

### 3.1 `electron/main/db/schema/logs.ts`

**幹什麼**:用 drizzle 的 TS DSL **聲明 logs 表長什麼樣**。一張表 8 個欄位 + 2 個索引。

**為什麼存在**:這個檔是「**唯一真相來源**」——
- drizzle runtime 看它知道有哪些表能查
- drizzle-kit (CLI) 看它差異產 migration SQL
- 整個 app 的 TypeScript 型別也從它推導(`LogRow` / `NewLog`)

改 schema 永遠改這個檔,**不要手動寫 SQL**。

**怎麼讀**:

```ts
export const logs = sqliteTable('logs', {
  id: integer('id').primaryKey({autoIncrement: true}),
  createdAt: integer('createdAt').notNull(),
  level: text('level').$type<LogLevel>().notNull(),
  // ...
})
```

每一行對應 SQL 一個欄位定義。

**怎麼用 import 的型別**:

```ts
import {logs, type LogRow, type NewLog, type LogLevel} from './schema/logs'

// LogRow = SELECT 出來的一行(所有欄位都齊)
// NewLog = INSERT 要塞的物件(可選欄位是 optional)
// LogLevel = 'debug' | 'info' | 'warn' | 'error'
```

### 3.2 `electron/main/db/schema/index.ts`

**幹什麼**:1 行轉發,把 logs 表 re-export 出去。

```ts
export * from './logs'
```

**為什麼存在**:讓 `import * as schema from './schema'` 一次拿到所有表(目前只一張,未來加表時不用改 import)。drizzle runtime 跟 drizzle-kit 都認這個入口。

### 3.3 `electron/main/db/database-manager.ts`

**幹什麼**:**SQLite 連線單例**。整個 App 只開一個 DB 連線,所有人共用。

**3 個關鍵方法**:

| 方法 | 做什麼 | 誰呼叫 |
|---|---|---|
| `init()` | 開 DB 檔、設 WAL pragma、跑 migration | `electron/main/index.ts` 啟動時 |
| `getDb()` | 拿 drizzle instance 操作 DB | LogService 內部 |
| `close()` | 關閉連線,把 WAL 內容 commit 進主檔 | App 退出前 (gracefulShutdown) |

**檔案位置邏輯**:

```ts
// init() 內:
const dbPath = app.isPackaged
  ? path.join(app.getPath('userData'), 'app.db')      // prod: %APPDATA%\ichiaDesktop\app.db
  : path.join(app.getAppPath(), 'app.db')              // dev: <專案根>\app.db
```

dev / prod 路徑分流,跟 [log-file-writer.ts](../electron/main/utils/log-file-writer.ts) 行為對齊。

### 3.4 `electron/main/db/services/log.service.ts`

**幹什麼**:**對 logs 表的所有業務 API**。包一層在 drizzle 上面,讓 caller 不用看到 drizzle 細節。

**3 個對外方法**:

| 方法 | 做什麼 |
|---|---|
| `write(entry)` | 寫一筆日誌(主 / 渲染 logger 都呼叫這個) |
| `query(params)` | 預留給未來查詢面板,本期不用 |
| `cleanupOlderThan(days)` | 啟動時呼叫一次,刪掉 N 天前的舊紀錄 |

**容錯保證**:`write()` 內部 try/catch,寫失敗只 `console.error`,**不會拋例外**。意思是 logger 呼叫永遠成功,業務代碼可以放心。

**args 怎麼存**:
- 如果 args 含 Error 物件 → 自動把 `stack` 抽到單獨的 `errorStack` 欄位
- 其他物件 → JSON.stringify 整包塞 `args` 欄位

### 3.5 `electron/main/db/migrations/0000_faithful_sunspot.sql`

**幹什麼**:drizzle-kit 第一次跑 `npm run db:generate` 自動產出的 SQL 檔。內容就是 `CREATE TABLE logs (...)` + 兩個 `CREATE INDEX`。

**為什麼存在**:App 第一次在使用者電腦啟動時,migrate() 跑這個 SQL **建出 `logs` 表**。

**鐵律**:**這個檔 commit 進 git 後就不要再改**。改了會破壞所有已部署使用者的升級流程(hash 對不上)。要改 schema → 加新表 / 改欄位 → 跑 `db:generate` 產出 `0001_xxx.sql`,**永遠用「加新檔案」處理變更**。

### 3.6 `electron/main/db/migrations/meta/`

**幹什麼**:drizzle-kit 內部用的 metadata。

- `_journal.json` — 列出所有 migration 的順序 + hash
- `0000_snapshot.json` — 第 0000 次 migration 後 schema 的快照

**你不需要動這個資料夾**。每次跑 `db:generate` 會自動更新。

### 3.7 `drizzle.config.ts`(專案根)

**幹什麼**:給 drizzle-kit CLI 看的設定檔。告訴它:
- schema 在哪(`./electron/main/db/schema/index.ts`)
- migrations 放哪(`./electron/main/db/migrations`)
- DB 方言是 sqlite

**只在 dev 用**,runtime 不會載入這個檔。`npm run db:generate` 跟 `npm run db:check` 都吃它。

### 3.8 `electron.vite.config.ts` 內的 `copyMigrationsPlugin`

**幹什麼**:電腦打包時把 `electron/main/db/migrations/` 整個資料夾**複製**到 `out/main/migrations/`。

**為什麼必要**:electron-vite 預設只處理 `.ts` / `.js`,SQL 是純文字它會忽略。但 runtime migrate() 要讀 SQL 檔,必須讓 SQL 檔出現在打包後的位置。

**為什麼自寫不用 `vite-plugin-static-copy`**:第三方套件的 glob 行為會把來源目錄結構也帶過去,變成 `out/main/migrations/electron/main/db/migrations/0000_xxx.sql` 這種四層巢狀。自寫 13 行 `cpSync` 直接攤平,維護成本反而更低。

---

## 4. 一條日誌的生命旅程

舉例:渲染進程業務代碼跑 `logger.info('AD 換 token 完成', 'Auth')`。

```
[1] src/utils/logger.ts:info()
    │
    │  console.info('[時間] [INFO][Auth] AD 換 token 完成')
    │  ← DevTools 看到這行
    │
    └─ forwardToMain('INFO', 'AD 換 token 完成', 'Auth', undefined)
       │
       │  window.electronAPI.log.write({
       │    level: 'INFO',
       │    message: 'AD 換 token 完成',
       │    module: 'Auth',
       │    args: undefined
       │  })
       │
       └─► IPC 'log:write' (single send,fire-and-forget)
           │
           ▼
[2] electron/main/ipc-handlers/log.handlers.ts:ipcMain.on('log:write')
    │
    │  節流檢查(100 條/秒上限)
    │
    └─ writeRendererLog('INFO', 'AD 換 token 完成', 'Auth')
       │
       ▼
[3] electron/main/utils/logger.ts:writeRendererLog()
    │
    │  console.info('[Renderer] [時間] [INFO][Auth] AD 換 token 完成')
    │  ← dev 模式主進程終端看到
    │
    │  if (level === 'ERROR') writeLine('renderer', line)  ← 跳過(這條是 INFO)
    │
    └─ _logService?.write({
         level: 'info',         ← 大寫轉小寫,跟 DB schema 對齊
         source: 'renderer',
         module: 'Auth',
         message: 'AD 換 token 完成'
       })
       │
       ▼
[4] electron/main/db/services/log.service.ts:write()
    │
    │  try {
    │    db.insert(logs).values({
    │      createdAt: Date.now(),    ← 1779155657742 之類的 ms timestamp
    │      level: 'info',
    │      source: 'renderer',
    │      module: 'Auth',
    │      message: 'AD 換 token 完成',
    │      args: null,
    │      errorStack: null
    │    }).run()
    │  } catch (err) {
    │    console.error('[LogService] DB 寫入失敗', err)
    │  }
    │
    ▼
[5] better-sqlite3 寫進 <userData>/app.db 的 logs 表
```

5 步走完。從業務代碼呼叫到落地 DB,大概是次毫秒級。

主進程內部呼叫 `logger.info(...)` 路徑類似,差別是**第 1 步直接到第 4 步**,不走 IPC(因為已經在主進程了)。

---

## 5. 啟動與退出順序

### 啟動(`electron/main/index.ts` 內 `app.whenReady().then(async () => {...})` 區塊)

```
1. initLogFileWriter()              ← txt 寫入器先起來
2. setAppUserModelId(...)
3. ensureAutoLaunchRegistered()
4. ┌─ try {
   │   dbManager = new DatabaseManager()
   │   dbManager.init()              ← 開 DB + 跑 migration
   │   logService = new LogService(dbManager)
   │   attachLogService(logService)  ← 把 LogService 注入 logger
   │   logService.cleanupOlderThan(14)
   │ } catch (err) {
   │   console.error('DB 初始化失敗')  ← 失敗只 console 報,不擴散
   │   dbManager = null
   │ }
5. configManager = ...
6. windowManager = ...
7. ...
```

**第 4 步包在 try/catch**,失敗時 `attachLogService` 不會被呼叫 → logger 內 `_logService?.write(...)` 自動 noop → DB 寫入靜默失效,但 txt 跟 console 仍正常 → App 照常往下走。

### 退出(`gracefulShutdown()` 內)

```
1. windowManager.setQuitting(true)
2. trayManager.destroy()
3. floatingBallMgr.dispose()
4. updateMgr.dispose()
5. dbManager?.close()              ← 關 DB,WAL checkpoint 進主檔
6. windowManager.destroyAll()
```

**第 5 步在主視窗銷毀前**,給 SQLite 機會把記憶體裡未落地的內容寫回主檔,避免下次啟動讀到舊資料。

---

## 6. Drizzle ORM 速通

只列你目前代碼會用到的:

```ts
import {logs} from '@main/db/schema/logs'
import {eq, desc, lt, sql} from 'drizzle-orm'

const db = dbManager.getDb()

// SELECT * FROM logs WHERE level='error' ORDER BY createdAt DESC LIMIT 10
db.select().from(logs)
  .where(eq(logs.level, 'error'))
  .orderBy(desc(logs.createdAt))
  .limit(10)
  .all()

// INSERT INTO logs (...) VALUES (...)
db.insert(logs).values({
  createdAt: Date.now(),
  level: 'info',
  source: 'main',
  message: 'hi'
}).run()

// DELETE FROM logs WHERE createdAt < ?
db.delete(logs).where(lt(logs.createdAt, cutoff)).run()

// 跳過 ORM 直接跑 raw SQL(極端情況用)
db.run(sql`VACUUM`)
```

**`.all()` vs `.get()` vs `.run()` 差別**:
- `.all()` — SELECT,返回陣列(0 或多筆)
- `.get()` — SELECT,只取第一筆(或 undefined)
- `.run()` — INSERT / UPDATE / DELETE,返回 `{changes, lastInsertRowid}`

---

## 7. Migration 機制怎麼確保不重跑

每次 App 啟動跑 `migrate()`,做 4 步:

```
1. 列出 migrations/*.sql 檔(目前: 0000_faithful_sunspot.sql)
2. 對每份 SQL 算內容 hash(SHA-256)
3. 查 __drizzle_migrations 表已套用過哪些 hash
4. 跳過已套用的,只跑沒紀錄的;跑完插一筆紀錄
```

`__drizzle_migrations` 是 drizzle 啟動時自動建的系統表,**你完全不用碰它**。

### 場景對照表

| 場景 | DB 怎麼變 |
|---|---|
| 全新使用者第一次裝 | `__drizzle_migrations` 不存在 → 從 0000 全跑 |
| 你發新版含 0001 的 migration | 跳過 0000,只跑 0001 |
| 使用者卸載重裝(`deleteAppDataOnUninstall: false`) | DB 還在 → 0000 / 0001 都跳過,不重跑 |
| 使用者手動刪 `app.db` | 等同「全新裝」,從 0000 全跑 |
| App crash 寫一半 | 每份 migration 包 transaction,沒成功的不算數,下次重試 |

**鐵律**:已 commit 的 migration **永遠不要改**。要變更 schema 永遠加新檔。

---

## 8. 打包後檔案去哪了

### 程式檔(NSIS 裝完之後)

```
C:\Users\Admin\AppData\Local\Programs\ichiaDesktop\
├─ ichiaDesktop.exe
├─ resources\
│  ├─ app.asar                     ← Vue / TS 代碼壓縮包(內含 out/main、out/preload、out/renderer)
│  │  └─ out/main/migrations/      ← SQL 檔在這
│  └─ app.asar.unpacked\
│     └─ node_modules\better-sqlite3\
│        └─ build\Release\better_sqlite3.node  ← native binary,必須解出 asar
└─ ...
```

`asarUnpack` 配置(`package.json` 的 `build.asarUnpack`)讓 better-sqlite3 的 `.node` 檔解到 `app.asar.unpacked\`。**因為 Node 的 `dlopen` 不認 ASAR 壓縮檔內的 native binary**。

### 執行時資料

```
C:\Users\Admin\AppData\Roaming\ichiaDesktop\
├─ app.db          ← SQLite 主檔
├─ app.db-wal      ← Write-Ahead Log
├─ app.db-shm      ← Shared memory
├─ logs\
│  ├─ main-2026-05-19.log         ← 只 ERROR
│  └─ renderer-2026-05-19.log      ← 只 ERROR
└─ app-config.json
```

**Roaming 不是 Local**,兩個資料夾分開,別搞混。

---

## 9. 常見維護操作

### 想看 DB 內容

最快:VSCode 裝 `qwtel.sqlite-viewer` 擴展,直接雙擊 `app.db`。

跑 SQL:

```sql
-- 最近 50 筆
SELECT datetime(createdAt/1000,'unixepoch','localtime') AS t, level, source, module, message
FROM logs ORDER BY id DESC LIMIT 50;

-- 統計各模組錯誤數
SELECT module, COUNT(*) FROM logs WHERE level='error' GROUP BY module ORDER BY 2 DESC;

-- 找特定關鍵字
SELECT * FROM logs WHERE message LIKE '%超時%' OR errorStack LIKE '%超時%';
```

### 重置 DB(緊急情況)

```powershell
# 關 App 後
Remove-Item $env:APPDATA\ichiaDesktop\app.db*
# 下次啟動 drizzle 自動從 0000 重建乾淨 DB
```

### 改 schema(未來加新欄位 / 新表)

```bash
# 1. 改 electron/main/db/schema/*.ts
# 2. 跑:
npm run db:generate
# 3. drizzle-kit 產出 0001_xxx.sql + 更新 meta
# 4. 檢查 SQL 沒問題後 commit
# 5. 發版,使用者下次啟動會自動套用 0001
```

### 想新增表

```bash
# 1. 新建 electron/main/db/schema/<新表>.ts
# 2. 修改 schema/index.ts:export * from './<新表>'
# 3. 同上 npm run db:generate
```

---

## 10. FAQ

**Q1:渲染進程能不能直接讀 DB?**
不能,也不該。Electron sandbox + contextIsolation 設計就是不讓渲染進程碰 native module。所有讀寫都走 IPC。

**Q2:寫日誌會卡 UI 嗎?**
不會。
- 寫 txt 是 `appendFile` 異步
- 寫 DB 雖然 better-sqlite3 是同步 API,但只在主進程跑,主進程沒有 UI,不影響渲染。單條 INSERT 微秒級。

**Q3:DB 損毀會有什麼後果?**
- App 啟動時 `dbManager.init()` 拋例外 → try/catch 抓住 → `attachLogService` 跳過 → logger 內 `_logService?.write(...)` 變 noop → 整個 SQLite 寫入鏈路靜默失效
- App 主功能不受影響,正常啟動
- txt + console 仍正常工作
- 修復方式:刪 `app.db*` 三件套,下次啟動重建

**Q4:為什麼 txt 不去掉,只留 SQLite 就好?**
- 支援人員 / 客戶手上的工具最簡單就是「壓縮資料夾打包寄回」,不可能要他們學 SQL
- 純文字格式跨平台跨工具最通用
- DB 是給開發者後續查詢用,角色不衝突

**Q5:有人改了已 commit 的 migration SQL 內容會怎樣?**
drizzle 啟動時對該檔重算 hash,跟 `__drizzle_migrations.hash` 比對不一致 → 拋警告 / 報錯。所以**規則是只追加不修改**。要改舊行為 → 開新 migration ALTER 過去。

**Q6:WAL 是什麼?三個檔(`.db` / `.db-wal` / `.db-shm`)能不能單獨刪?**
WAL = Write-Ahead Log,SQLite 高並發模式。寫入先進 `.db-wal`,定期 checkpoint 進 `.db` 主檔。`.db-shm` 是 shared memory。
**要刪就三個一起刪**,不然會破壞一致性。`dbManager.close()` 退出時會自動 checkpoint,所以正常退出後重啟,WAL 可能是空的或不存在。

**Q7:為什麼選 better-sqlite3 不選 sql.js / node-sqlite3?**
- node-sqlite3 callback / Promise 風格,代碼啰嗦,性能弱
- sql.js 是 WASM,DB 整顆塞記憶體,只適合小資料 / 唯讀
- better-sqlite3 同步 API 在主進程是優勢(沒 UI 阻塞問題)、性能最好、TS 型別最完整

**Q8:為什麼選 drizzle 不選 Prisma / TypeORM?**
- Prisma 需要獨立 query engine binary,Electron 打包繁瑣,Native binary 平台分歧大
- TypeORM 用 Decorator + Reflection,啟動有開銷,TS 型別推導不純粹
- drizzle 純 TS schema,自動推導型別,query builder 寫起來像 SQL,沒額外 runtime,Electron 打包友善

---

看完這份應該可以:
- 看著任何一個 `db/` 下的檔案知道它在幹什麼
- 改 schema / 加表時知道流程
- DB 壞掉時知道怎麼除錯
- 看到舊代碼用 logger.* 時知道資料會走到哪
