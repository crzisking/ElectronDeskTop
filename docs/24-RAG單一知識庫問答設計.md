# 24 - RAG 單一知識庫問答設計

> **狀態**:設計待審(尚未實作) —— 等使用者看過本文拍板後再開工。
> **方案主體**:DeskTop 當瘦客戶端,agent 與 RAG 全在 `dataMiddlePlatform`;桌面只發問、持有 history、渲染。
> **決策來源**:與使用者 2026-07-23 的設計討論 ——
> ① 架構取「方案 A:平台當 agent」;② 單庫過濾權限取「交集」(指定庫 ∩ 工號可見庫)。

最後更新:2026-07-23(初稿)

---

## 1. 定位與痛點

**目標**:在 ichiaDesktop 裡做一個「**釘定某一個知識庫**」的 agent 問答 —— 用戶提問,由後端知識庫檢索作答,並給出**引用來源(
可下載原件)**。

**為什麼是「單一知識庫」**:現有 `dataMiddlePlatform` 的問答按「**工號 → 可見的全部庫**」檢索,是「這個人能看到的都搜」。本需求要的是「
**只在指定的那一個庫裡問答**」(例:只問品質庫、或只問某條產線的 SOP 庫),範圍更聚焦、答案更乾淨。

**為什麼複用平台、桌面不自建 RAG**:平台已是成熟的 **LangGraph agent + 混合檢索**(向量 + 關鍵詞 RRF 融合、可選
rerank、簡繁歸一、來源帶 MinIO 下載鏈接、agentic 多輪檢索)。桌面自建會把 RAG 邏輯劈成兩半、另配一套 LLM、且丟掉來源鏈接與會話能力,不划算。

---

## 2. 整體鏈路

```
DeskTop 新 feature (renderer, raw-fetch SSE)
   └─ POST {平台}/api/v1/chat/stream
        body: { message, history, persist:false, employee_no, kb_code, model? }
   ↓
dataMiddlePlatform（agent + RAG 全在這）
   employee_no → 可見庫集合  ∩  kb_code → 鎖定單庫
   → LangGraph agent → hybrid_search → 答案 + sources(含下載鏈接)
   ↓
SSE 回推：meta(conversation_id) → 逐字 token → sources(JSON) → done
```

桌面端只負責:發問、**客戶端自管 history**(`persist=false`,不碰平台會話表)、渲染打字機 + 來源列表。RAG／agent 邏輯**不落桌面
**。

---

## 3. 後端 API 地址(平台側)

| 環境 | 地址                            | 說明        |
|----|-------------------------------|-----------|
| 測試 | `http://localhost:8000`       | 本機起的測試服   |
| 正式 | `http://192.168.120.174:8000` | 部署的測試/正式機 |

- 一期**內網、無鑑權**,平台 CORS 為 `allow_origins=["*"]`,桌面 renderer 可**直連 fetch**,無跨域問題,**不需**走主進程/IPC。
- 完整前綴:`{地址}/api/v1/...`(見平台 `router.py`:`main.py` 加 `/api/v1`,各 router 再加 prefix)。
- 用到的端點:
    - `POST /api/v1/chat/stream` —— 流式問答(本方案主力)。
    - `GET  /api/v1/kbs` —— 列知識庫(給選庫下拉,或核對 kb_code)。
    - `GET  /api/v1/meta/models` —— 可選模型清單(要做模型切換才用)。

---

## 4. 平台側改動(唯一的接口修改,改動小、對現有調用零影響)

現況:`/chat`、`/chat/stream`、`/search` **都沒有「指定單一知識庫」的參數**,只能按工號可見的全部庫檢索。`doc_type`
是「文檔分類」不是「知識庫」,不能拿來冒充。故需新增一個可選的單庫參數。

### 4.1 `ChatRequest` 加可選字段(`app/api/v1/endpoints/chat.py`)

```python
kb_code: str | None = Field(
    None, description="指定单一知识库代号，只在该库内检索；不传=按工号可见的全部库"
)
```

### 4.2 `services/knowledge_bases.py` 加 code→id 解析輔助

```python
async def kb_id_by_code(session: AsyncSession, code: str) -> int | None:
    """按 code 查知识库 id，查不到返回 None（调用方决定报错）。"""
    return await session.scalar(select(KnowledgeBase.id).where(KnowledgeBase.code == code))
```

### 4.3 改 `_apply_visible_groups`(`chat.py`,`/chat` 與 `/chat/stream` 共用這一處)

加了 `kb_code` 就把可見集合**收窄到交集**;沒加則行為完全不變:

```python
async def _apply_visible_groups(req, session):
    group_ids = await groups_of_employee(session, req.employee_no) if req.employee_no else []
    set_visible_groups(group_ids)
    visible = await visible_kb_ids(session, group_ids)          # 工号可见的全部库
    if req.kb_code:
        kb_id = await kb_id_by_code(session, req.kb_code)
        if kb_id is None or kb_id not in visible:               # 不存在 or 无权 → 一律 404
            raise NotFoundError("知识库不存在或无权访问")
        set_visible_kbs([kb_id])                                 # 锁定单库（∩ 权限）
    else:
        set_visible_kbs(visible)                                 # 原行为不变
```

**權限語義(取交集)**:指定庫必須落在工號可見集合內才放行;越權或不存在**統一報 404**(不洩露庫是否存在)。公共庫(
`default_groups IS NULL`)本就在可見集合裡,故公共庫恆可用。`visible_group_conditions()`(文件級收窄)仍照舊疊加 ——
單庫內某些文件對某群組不可見的規則依然成立,交集語義天然保住。

**不動的部分**:`/search`(IT 內部聯調用,非終端問答)本次不加 `kb_code`;`search_knowledge_base` 工具、檢索融合邏輯均不變。

**待確認小點**:越權/不存在都報 404 是為了不洩露庫存在性;若內網無所謂,可拆成 `BadRequestError` 給更明確提示。(
平台可用異常:`BadRequestError` / `NotFoundError`,無 403。)

---

## 5. 桌面側改動(DeskTop)

新增 feature `src/features/kb-qa/`(命名待定),套現有模式,**不碰核心架構**(不動 IPC / 主進程 / 本地 Agent):

| 文件             | 作用                                                                                                                       |
|----------------|--------------------------------------------------------------------------------------------------------------------------|
| `api.ts`       | 抄 `src/features/repair/composables/useRepairPolish.ts` 的 raw-fetch + `ReadableStream` SSE 消費;POST `/api/v1/chat/stream`。 |
| `types.ts`     | `ChatTurn` / `SourceOut` 對齊平台契約(見 §6)。                                                                                   |
| `store.ts`     | 客戶端持有 `history` + `conversation_id`(因 `persist=false`,會話由桌面自管)。                                                          |
| `KbQaView.vue` | 對話面板:消息列表、流式氣泡、來源列表(點擊開 MinIO 下載鏈接)。                                                                                     |
| composable     | 串流狀態機 + `AbortController`(切換/關閉時取消,同 Dify 做法)。                                                                           |

- **工號 `employee_no`**:取 `authStore.user.userName`(JWT 工號),同 idea-capture / work-collect 現有做法。
- **`kb_code`**:先**釘死一個固定庫**(來自配置);要不要讓用戶用 `GET /kbs` 切庫 —— **待使用者定**。
- **配置**:需在 `.env.development` / `.env.production` + `src/vite-env.d.ts` 加平台地址(如 `VITE_KB_QA_URL`,dev=
  `http://localhost:8000`、prod=`http://192.168.120.174:8000`)。
  ⚠️ 按本專案開發規範,**改 `.env*` 屬配置改動,實作前須另找使用者確認**。

---

## 6. 契約對齊(平台 → 桌面)

**請求 body**(`POST /api/v1/chat/stream`):

```jsonc
{
  "message": "本轮问题",
  "conversation_id": null,          // 桌面自管；不传由服务端生成并在 meta 回传
  "persist": false,                 // 桌面端固定 false：用下面的 history，不碰平台会话表
  "history": [{"role":"user","content":"..."}, {"role":"assistant","content":"..."}],
  "model": null,                    // 不传用平台默认；要切模型再传白名单内的名字
  "employee_no": "工号",            // 权限过滤依据；不传只看公共库
  "kb_code": "QUALITY"              // 本方案新增：锁定单库
}
```

**SSE 回推事件**(注意平台用 `sse-starlette`,分隔是 **`\r\n`**;按 `\r?\n` 解析):

| event       | data                                                       | 桌面處理                               |
|-------------|------------------------------------------------------------|------------------------------------|
| `meta`      | `{"conversation_id": "..."}`                               | 存下 conversation_id(供後續追問)          |
| (無 event 名) | 一個 token 字串                                                | 累加到當前助手氣泡(打字機)                     |
| `sources`   | `[{document_id, document_name, download_url}, ...]` (JSON) | 渲染來源列表,`download_url` 是限時 MinIO 鏈接 |
| `done`      | 空                                                          | 本輪結束                               |

**最大坑**:SSE 具名事件解析比 Dify 複雜一層 —— Dify 只有 `data:` 行,這裡還有 `event:` 行且以 `\r\n` 分隔、跨 chunk
可能截斷。實作時單獨寫一個小解析器(buffer 半行 + 按事件切),並補單測。

---

## 7. 工作量與風險

- **平台側**:~30 行(1 個新輔助函數 + 改 1 個已有函數),附 `tests/` 測試。低風險、可回退(新字段可選、不傳即原行為)。
- **桌面側**:1 個新 feature(照抄現成模式),主要工作是 SSE 解析對齊 + UI。
- **風險點**:① SSE 具名事件/`\r\n`/跨 chunk 截斷 —— 用專門解析器 + 單測兜住;② `.env` 配置改動須先確認;③ MinIO
  下載鏈接限時(約 1 小時),桌面**用時現取、不快取**。

---

## 8. 待決事項(開工前)

1. 桌面的知識庫:**釘死一個** 還是 **讓用戶選**?(決定 §5 是否要選庫 UI)
2. 越權/不存在的報錯:**統一 404**(不洩露) 還是 **BadRequest 給明確提示**?(§4.3)
3. feature 命名 / 入口掛在主窗哪個位置。
4. `.env` 新增 `VITE_KB_QA_URL` 的最終確認(dev / prod 兩值見 §3)。
