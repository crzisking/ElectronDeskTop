# 24 - RAG 單一知識庫問答設計

> **狀態**:**已實作**(P1)。桌面 feature 已落地並通過 typecheck / lint / 單測;`.env` 三檔已加 `VITE_KB_QA_URL`。
> **方案主體**:DeskTop 當瘦客戶端,agent 與 RAG 全在 `dataMiddlePlatform`;桌面只發問、持有 history、渲染。
> **決策(2026-07-23)**:① 架構取「方案 A:平台當 agent」;② 單庫過濾權限取「交集」(指定庫 ∩ 工號可見庫);
> ③ 桌面**讓使用者自選知識庫**;④ feature 放**個人功能**、命名**知識檢索**;⑤ `.env` 三檔(dev/prod/example)均加地址。
> **平台側**:指定庫問答與可見範圍查詢兩個接口後端**已實現**(見 §3),桌面純對接,不改後端。

最後更新:2026-07-23(桌面 feature 已實作)

---

## 1. 定位與痛點

**目標**:在 ichiaDesktop 裡做一個「**釘定某一個知識庫**」的 agent 問答 —— 用戶提問,由後端知識庫檢索作答,並給出**引用來源(
可下載原件)**。

**為什麼是「單一知識庫」**:平台的通用問答(`/chat/stream`)按「**工號 → 可見的全部庫**」檢索,是「這個人能看到的都搜」。本需求要的是「
**只在指定的那一個庫裡問答**」(例:只問品質庫、或只問某條產線的 SOP 庫),範圍更聚焦、答案更乾淨。平台新增的 `/chat/kb/stream`
正是為此。

**為什麼複用平台、桌面不自建 RAG**:平台已是成熟的 **LangGraph agent + 混合檢索**(向量 + 關鍵詞 RRF 融合、可選
rerank、簡繁歸一、來源帶 MinIO 下載鏈接、agentic 多輪檢索)。桌面自建會把 RAG 邏輯劈成兩半、另配一套 LLM、且丟掉來源鏈接與會話能力,不划算。

---

## 2. 整體鏈路

```
DeskTop 新 feature (renderer)
   ├─(進入頁時)GET  /api/v1/access/visibility/{employee_no}   → 該工號可見的庫,填「選庫」下拉
   └─(提問時) POST /api/v1/chat/kb/stream  (raw-fetch SSE)
        body: { message, history, persist:false, employee_no, kb_codes:[選中庫], model? }
   ↓
dataMiddlePlatform（agent + RAG 全在這，已就緒）
   開流前校驗：庫存在? 工號有權? （404/403/400，走普通 HTTP，不進 SSE）
   → set_visible_kbs(校驗過的指定庫) → LangGraph agent → hybrid_search → 答案 + sources
   ↓
SSE 回推：meta(conversation_id) → 逐字 token → sources(JSON) → done
```

桌面端只負責:選庫、發問、**客戶端自管 history**(`persist=false`,不碰平台會話表)、渲染打字機 + 來源列表。RAG／agent 邏輯**不落桌面
**。

---

## 3. 平台側接口(已就緒,桌面直接用,無需改後端)

### 3.1 地址

| 環境 | 地址                            | 說明        |
|----|-------------------------------|-----------|
| 測試 | `http://localhost:8000`       | 本機起的測試服   |
| 正式 | `http://192.168.120.174:8000` | 部署的測試/正式機 |

- 一期**內網、無鑑權**,平台 CORS 為 `allow_origins=["*"]`,桌面 renderer 可**直連 fetch**,無跨域問題,**不需**走主進程/IPC。
- 完整前綴:`{地址}/api/v1/...`。

### 3.2 用到的端點

| 端點                                            | 用途                | 本方案角色           |
|-----------------------------------------------|-------------------|-----------------|
| `POST /api/v1/chat/kb/stream`                 | **指定庫**的流式問答(SSE) | **主力**:單庫問答     |
| `GET /api/v1/access/visibility/{employee_no}` | 查工號可見的群組 + 知識庫    | 填「選庫」下拉(只給有權的庫) |
| `GET /api/v1/meta/models`                     | 可選模型清單            | 可選:做模型切換才用      |

`/chat/stream`(全部可見庫問答)、`/chat`(非流式)、`/kbs`(列全部庫,不過濾)本方案不用。

### 3.3 `/chat/kb/stream` 的關鍵語義(平台已實現)

- 入參 `KbChatRequest` = 通用 `ChatRequest` + `kb_ids?: int[]` + `kb_codes?: str[]`。**兩者至少給一個**(可混用、會合併)。*
  *單一知識庫 = 傳一個元素的 `kb_codes`**(如 `["QUALITY"]`)。
- **權限=交集**:檢索範圍限定到指定庫,但仍受該工號可進範圍約束。
- **開流前校驗,錯誤走普通 HTTP(不混進 SSE)**:
  - 庫不存在 → **404** `NOT_FOUND`;
  - 庫存在但該工號無權 → **403** `FORBIDDEN`(會列出是哪幾個);
  - 一個庫都沒指定 → **400** `BAD_REQUEST`;無工號 → **400**。
- 校驗通過後,復用與 `/chat/stream` 同一套 SSE 生成器(`_emit_chat_stream`),故 SSE 事件格式與通用問答完全一致(見 §6)。

> 註:§4「平台側改動」已無 —— 這些能力後台已於 2026-07-23 提交(`/chat/kb/stream`、`/access/visibility/*`、`ForbiddenError`)
> 。桌面側是純對接。

---

## 4. 桌面側改動(DeskTop,本方案唯一要寫的代碼)

新增 feature `src/features/kb-qa/`(命名待定),套現有模式,**不碰核心架構**(不動 IPC / 主進程 / 本地 Agent):

| 文件             | 作用                                                                                                                                                                                       |
|----------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `api.ts`       | ① 普通請求:`httpClientFor()` 調 `GET /access/visibility/{employee_no}`;② 流式:抄 `src/features/repair/composables/useRepairPolish.ts` 的 raw-fetch + `ReadableStream` SSE,POST `/chat/kb/stream`。 |
| `types.ts`     | `ChatTurn` / `SourceOut` / `VisibilityOut` 對齊平台契約(見 §6)。                                                                                                                                 |
| `store.ts`     | 客戶端持有 `history` + `conversation_id`(因 `persist=false`,會話由桌面自管);當前選中的 `kb_code`。                                                                                                          |
| `KbQaView.vue` | 對話面板:(可選)選庫下拉、消息列表、流式氣泡、來源列表(點擊開 MinIO 下載鏈接)。                                                                                                                                            |
| composable     | 串流狀態機 + `AbortController`(切換/關閉時取消,同 Dify 做法)。                                                                                                                                           |

- **工號 `employee_no`**:取 `authStore.user.userName`(JWT 工號),同 idea-capture / work-collect 現有做法。
- **選庫**:進頁時調 `/access/visibility/{employee_no}` 只顯示**該工號有權的庫**;`釘死一個` 或 `讓用戶選` 都能做(見 §7
  待決)。
- **配置**:需在 `.env.development` / `.env.production` + `src/vite-env.d.ts` 加平台地址(如 `VITE_KB_QA_URL`,dev=
  `http://localhost:8000`、prod=`http://192.168.120.174:8000`)。
  ⚠️ 按本專案開發規範,**改 `.env*` 屬配置改動,實作前須另找使用者確認**。

---

## 5. 契約對齊(平台 → 桌面)

### 5.1 選庫:`GET /api/v1/access/visibility/{employee_no}`

回 `{code, message, data}` 信封(桌面 `httpClientFor` 會自動剝殼給 `data`):

```jsonc
{
  "employee_no": "12345",
  "groups": [{"id": 1, "name": "品質部", "code": "QA"}],
  "knowledge_bases": [{"id": 3, "name": "品質", "code": "QUALITY"}]   // 只列有權的庫
}
```

### 5.2 提問:`POST /api/v1/chat/kb/stream`(請求 body)

```jsonc
{
  "message": "本轮问题",
  "conversation_id": null,          // 桌面自管；不传由服务端生成并在 meta 回传
  "persist": false,                 // 桌面端固定 false：用下面的 history，不碰平台会话表
  "history": [{"role":"user","content":"..."}, {"role":"assistant","content":"..."}],
  "model": null,                    // 不传用平台默认；要切模型再传白名单内的名字
  "employee_no": "12345",           // 必填（无则 400）；权限过滤依据
  "kb_codes": ["QUALITY"]           // 单一知识库 = 一个元素；也可用 kb_ids:[3]，两者至少给一个
}
```

### 5.3 SSE 回推事件(注意平台用 `sse-starlette`,分隔是 **`\r\n`**;按 `\r?\n` 解析)

| event       | data                                                       | 桌面處理                               |
|-------------|------------------------------------------------------------|------------------------------------|
| `meta`      | `{"conversation_id": "..."}`                               | 存下 conversation_id(供後續追問)          |
| (無 event 名) | 一個 token 字串                                                | 累加到當前助手氣泡(打字機)                     |
| `sources`   | `[{document_id, document_name, download_url}, ...]` (JSON) | 渲染來源列表,`download_url` 是限時 MinIO 鏈接 |
| `done`      | 空                                                          | 本輪結束                               |

### 5.4 錯誤(開流前校驗,走普通 HTTP,**不在 SSE 裡**)

非 2xx 的 `{code, message, detail}`:`404 NOT_FOUND`(庫不存在)/ `403 FORBIDDEN`(無權,detail 列出庫)/ `400 BAD_REQUEST`(
沒給庫或沒給工號)。桌面按 fetch 響應狀態碼分支即可,不必解析 SSE。

**最大坑**:SSE 具名事件解析比 Dify 複雜一層 —— Dify 只有 `data:` 行,這裡還有 `event:` 行且以 `\r\n` 分隔、跨 chunk
可能截斷。實作時單獨寫一個小解析器(buffer 半行 + 按事件切),並補單測。

---

## 6. 工作量與風險

- **平台側**:**0**(接口已就緒)。
- **桌面側**:1 個新 feature(照抄現成模式),主要工作是 SSE 解析對齊 + UI + 選庫。
- **風險點**:① SSE 具名事件/`\r\n`/跨 chunk 截斷 —— 用專門解析器 + 單測兜住;② `.env` 配置改動須先確認;③ MinIO
  下載鏈接限時(約 1 小時),桌面**用時現取、不快取**;④ 提問前先 `/access/visibility` 拿到有權庫,避免用戶選到會 403 的庫。

---

## 7. 實作落地(已完成)

新增 feature `src/features/knowledge-search/`:

| 文件                                | 作用                                                                       |
|-----------------------------------|--------------------------------------------------------------------------|
| `types.ts`                        | 契約型別(ChatTurn / SourceOut / VisibilityOut / KbChatRequest / SseEvent…)   |
| `sse-parser.ts`                   | SSE 事件解析器(`\r\n`、具名事件、跨 chunk 截斷、多行 data)。**有單測**                        |
| `api.ts`                          | `fetchVisibility()`(httpClientFor GET) + `streamKbChat()`(raw-fetch SSE) |
| `composables/useKnowledgeChat.ts` | 狀態機:載庫 / 選庫 / 發問串流 / 來源 / 新對話 / 中止                                       |
| `KnowledgeSearchView.vue`         | 對話頁:選庫下拉、打字機泡泡、引用來源(點擊 `window.open` 開 MinIO 原件)                         |

接線:

- 路由 `src/router/index.ts` → `name: 'knowledge-search'`。
- 個人功能卡片 `electron/main/db/features/config/defaults.ts` → `personalFunctions.tools` 加 `knowledgeSearch`(
  dev-owned,升級自動出現)。
- i18n `router.knowledgeSearch`(zh-TW / en)。
- env:`src/vite-env.d.ts` 加型別;`.env.development`(`localhost:8000/api/v1`)/ `.env.production`(
  `192.168.120.174:8000/api/v1`)/ `.env.example` 各加 `VITE_KB_QA_URL`。
- 測試 `tests/knowledge-search/sse-parser.test.ts`(8 例全過)。

驗證:`npm run typecheck` / `eslint`(新檔)/ `npm run test:run`(SSE 解析)均通過。

**決策全部落地**,原「釘死 vs 選庫」「報錯語義(平台已定 404/403/400)」等待決項均已解決。
