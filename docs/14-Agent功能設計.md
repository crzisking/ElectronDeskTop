# Agent 功能設計文檔

> **參考架構**：[Claude Code 深度解析](https://openedclaude.github.io/claude-reviews-claude/zh-CN/overview) — 六大支柱協同運作，
`while(true)` 循環將 LLM 變成 Agent

## 1. 設計總綱

### 1.1 核心命題

將一個單次調用的 LLM 變成可操作電腦的 Agent，靠的不是某個天才算法，而是一個刻意保持"愚鈍"的循環。

```
LLM = 大腦（推理、決策）
Harness = 身體（感知、行動、記憶、約束）
```

`while(true)` 循環的每一次迭代：

```
用戶輸入 → 上下文組裝 → 流式 API 調用 → 工具提取 → 工具執行 → 結果注入 → 繼續/結束決策 → 下一輪
```

### 1.2 六大設計哲學（對標 Claude Code）

| # | 哲學                        | 在本項目的體現                                                                                                                                                                                                                                                            |
|---|---------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1 | **LLM = 大腦，Harness = 身體** | openai SDK 做推理；Electron 主進程提供檔案、命令、截圖等系統能力                                                                                                                                                                                                                         |
| 2 | **工具 = 能力邊界**             | Agent 只能做已註冊工具允許的事情。工具的 `description` + `parameters` 是 LLM 認知的唯一入口                                                                                                                                                                                                 |
| 3 | **上下文是最稀缺的資源**            | System Prompt 分層構建，每層有獨立的優先級、生命週期和緩存策略                                                                                                                                                                                                                             |
| 4 | **不做確權彈窗，但有 guardrail**   | 內網信任使用者 → 不逐次彈窗確認；但工具層有三道防線防 LLM 被 prompt injection 誘導:① 檔案操作限 workspace 白名單(home / userData / temp / 文件 / 下載 / 桌面)② run_command 黑名單擋 format/rm/reg/shutdown 等不可逆命令 ③ env `AGENT_TOOL_CAPABILITIES=read-only` 可關掉 write_file / run_command。見 agent-tool.service.ts |
| 5 | **循環直到完成**                | 不是請求-響應，而是 `調用 → 工具 → 結果 → 重複`，最多 N 輪                                                                                                                                                                                                                              |
| 6 | **簡單的腳手架，聰明的模型**          | 循環本身不做複雜決策，所有智能來自 LLM 的 function calling                                                                                                                                                                                                                           |

### 1.3 架構全景圖

```
┌──────────────────────────────────────────────────────────────────┐
│                    Agent 獨立窗口 (Renderer)                       │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                   useAgentChat (核心編排層)                  │ │
│  │                                                             │ │
│  │   while(turn < maxTurns) {                                  │ │
│  │     1. 上下文壓縮 (snip / compact)                           │ │
│  │     2. 調用 API (openai SDK, stream: true)                  │ │
│  │     3. 解析響應 (text_delta | tool_calls)                   │ │
│  │     4. 執行工具 (本地直接執行 | IPC → 主進程)                 │ │
│  │     5. 結果注入 → 下一輪                                     │ │
│  │   }                                                          │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  ┌────────────────────┐        ┌────────────────────────────┐    │
│  │   openai SDK       │        │  IPC Bridge                │    │
│  │   (直接 HTTP/SSE)  │        │  agent.preload.ts          │    │
│  │                    │        │  → agent:exec-tool         │    │
│  └────────┬───────────┘        └──────────┬─────────────────┘    │
│           │                               │                       │
│           │                          ┌────▼──────────────────┐    │
│           │                          │  主進程 (Main)         │    │
│           │                          │  agent.handlers.ts    │    │
│           │                          │  • open_app           │    │
│           │                          │  • read_file          │    │
│           │                          │  • write_file         │    │
│           │                          │  • list_files         │    │
│           │                          │  • run_command        │    │
│           │                          │  • screenshot         │    │
│           │                          │  • clipboard_read     │    │
│           │                          │  • clipboard_write    │    │
│           │                          └───────────────────────┘    │
│           │                                                       │
│  ┌────────▼───────────┐                                           │
│  │  LLM API (外部)     │                                           │
│  │  OpenAI 兼容接口    │                                           │
│  └────────────────────┘                                           │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. 核心循環設計（對標 QueryEngine）

### 2.1 為什麼是 `while(true)` 循環

Claude Code 的核心洞察：讓一個只能"一次請求一次回應"的 LLM 變成能持續行動的 Agent，方案不是讓腳手架變聰明，而是讓腳手架*
*重複調用**。

每一次 API 往返都是一個完整的"思考 → 行動 → 觀察"循環：

```
第 1 輪：LLM 看到用戶說"幫我打開記事本"，返回 tool_calls: [open_app("notepad")]
         → Harness 執行 open_app → 結果"已成功開啟"注入消息列表
第 2 輪：LLM 看到工具執行成功，生成文本"記事本已打開，需要我做什麼嗎？"
         → finish_reason = stop → 循環結束
```

**關鍵設計決策**：循環的每一步都**不預設 LLM 下一步要做什麼**。腳手架只做三件事：調用 API、執行工具、把結果放回去。所有的決策權交給
LLM。

### 2.2 循環流程（簡化版 8 步流水線）

| 步驟 | 名稱                   | 職責                                                                      |
|:--:|----------------------|-------------------------------------------------------------------------|
| 1  | **上下文壓縮**            | 檢查消息總長度，超出閾值時對舊消息做截斷或摘要，確保不超過模型上下文窗口                                    |
| 2  | **消息規範化**            | 將內部消息格式轉換為 LLM API 期望的 `{ role, content, tool_calls, tool_call_id }` 格式 |
| 3  | **System Prompt 注入** | 每輪開始時確保 system prompt 在消息列表首位（見 §3）                                     |
| 4  | **API 調用**           | `client.chat.completions.create({ messages, tools, stream: true })`     |
| 5  | **流式解析**             | 逐 chunk 解析 SSE：提取 `text_delta`（打字機效果）和 `tool_calls`（累積 JSON）            |
| 6  | **工具執行路由**           | 若存在 tool_calls → 判斷是前端工具還是系統工具 → 執行                                     |
| 7  | **結果注入**             | 將 `{ role: 'tool', tool_call_id, content }` 追加到消息列表                     |
| 8  | **狀態轉換**             | `finish_reason = stop` → 結束；`tool_calls` → 回到步驟 1 繼續                    |

### 2.3 循環終止條件

```
循環在以下任一條件成立時終止：
  a. LLM 返回 finish_reason = 'stop'（無工具調用，純文字回答）
  b. 達到 maxTurns 上限（預設 10 輪，可在 Prompt 面板配置）
  c. 使用者點擊「中止」按鈕（AbortController.abort()）
  d. API 返回不可恢復的錯誤（非 429/529/網絡抖動）
```

### 2.4 流式處理策略（為什麼用原始 SSE 而非 SDK Stream）

Claude Code 的核心教訓：Anthropic SDK 的 `BetaMessageStream` 在每個 delta 上重建整個消息對象，導致 O(n²) 字符串拼接。openai
SDK 的 `stream` 也有類似問題——它為每個 chunk 創建一個完整的 `ChatCompletionChunk` 對象。

**本項目的策略**：使用 openai SDK 的 `stream` 模式（便利性優先），但用以下方式優化：

```typescript
// 對於 tool_calls 的 delta，直接累積字符串而非反覆解析 JSON
for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta
    if (delta?.content) {
        // text delta → 直接追加到 UI（O(1)）
        appendToUI(delta.content)
    }
    if (delta?.tool_calls) {
        // tool_calls delta → 按 index 累積 JSON 字符串，最後一次解析
        accumulateToolCallArguments(delta.tool_calls)
    }
}
```

**流空閒看門狗**：90 秒無數據自動中止，觸發重試。

---

## 3. System Prompt 設計（對標上下文裝配 EP10）

### 3.1 三層上下文架構

Claude Code 的上下文組裝是整個系統的"心智構建"過程。借鑑其分層思想：

```
┌──────────────────────────────────────────────┐
│  Layer 1: System Prompt                     │
│  生命週期：整個 Agent 窗口存活期間不變        │
│  內容：身份定義 + 能力描述 + 行為規則          │
│  來源：Prompt 面板中使用者編輯的文本           │
├──────────────────────────────────────────────┤
│  Layer 2: 環境上下文                         │
│  生命週期：每輪重新採集（memoized）           │
│  內容：當前時間、OS 信息、桌面環境             │
├──────────────────────────────────────────────┤
│  Layer 3: 對話歷史                           │
│  生命週期：每輪追加                          │
│  內容：所有 user / assistant / tool 消息      │
└──────────────────────────────────────────────┘
```

### 3.2 System Prompt 的分層構建（按 Token 優先級排序）

```
System Prompt 組裝順序：
  1. 核心身份與規則     ← "你是一個 Windows 桌面助手..."
  2. 工具描述（全部）    ← open_app, read_file, ... 的 JSON Schema
  3. 環境信息           ← 當前時間、OS 版本、用戶名
  4. 行為約束           ← 輸出格式、語言偏好、行動規範
```

### 3.3 動態邊界標記（借鑑 DYNAMIC_BOUNDARY）

Claude Code 使用 `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` 標記將 System Prompt 分為兩個區域：

- **靜態區（邊界之前）**：跨會話可緩存 → 身份、規則、工具使用指南
- **動態區（邊界之後）**：每會話重建 → 環境信息、語言、Token 預算

**本項目簡化**：不做 LLM 級別的 prompt cache 管理（那是 API 服務端的事），但保留這個概念用於**前端的 Prompt 編輯器**
——靜態部分是模板，動態部分自動注入。

### 3.4 預設 System Prompt 模板

```
你是 Windows 桌面 AI 助手，可以直接操作使用者的電腦。

【核心能力】
- 開啟應用程式 (open_app)
- 讀取檔案內容 (read_file)
- 寫入內容到檔案 (write_file)
- 列出目錄下的檔案 (list_files)
- 執行命令列指令 (run_command)
- 擷取螢幕截圖 (screenshot)
- 讀寫剪貼簿 (clipboard_read / clipboard_write)
- 在瀏覽器中搜尋 (web_search)

【行為規則】
1. 分析使用者需求，決定需要調用哪些工具
2. 每次只執行必要的工具，不要過度操作
3. 工具執行後根據結果決定下一步
4. 使用繁體中文回答，清晰簡潔
5. 檔案路徑使用 Windows 格式（反斜線 \）
```

### 3.5 Prompt 面板設計

借鑑 Claude Code 的記憶文件優先級鏈（Managed → User → Project → Local），使用者在 Prompt 面板中可以看到：

```
┌─ Prompt 面板 ───────────────────────────────┐
│                                              │
│  模板選擇：[默認助手 ▾]                       │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  你可以編輯 System Prompt...             │  │
│  │                                         │  │
│  │  你是 Windows 桌面 AI 助手...            │  │
│  │                                         │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ─────── 分隔線（以下自動注入）───────        │
│  環境信息：自動採集，不可編輯                 │
│  工具列表：自動生成，不可編輯                 │
│                                              │
│  模型：[gpt-4o ▾]     溫度：[0.7]            │
│  最大輪數：[10]                              │
└──────────────────────────────────────────────┘
```

**優先級鏈**：Prompt 面板編輯內容 > 預設模板 > 空（必須有內容才能使用）

---

## 4. 工具系統設計（對標 EP02 工具系統）

### 4.1 統一工具介面

借鑑 Claude Code 的 `Tool` 介面 + `buildTool()` 工廠模式。每個工具只暴露三個核心屬性：

| 屬性           | 說明                                                              | 示例              |
|--------------|-----------------------------------------------------------------|-----------------|
| `definition` | OpenAI Function Calling 格式的 `{ name, description, parameters }` | LLM 看到的"功能表"    |
| `location`   | `'renderer'` \| `'main'`                                        | 在渲染端直接執行還是走 IPC |
| `execute`    | 執行函數（渲染端的同步執行；主進程的透過 IPC invoke）                                | 實際產生副作用的地方      |

### 4.2 工具分類

| 類別       | 工具                                 |   執行位置   | 說明                             |
|----------|------------------------------------|:--------:|--------------------------------|
| **應用操作** | `open_app`                         |   Main   | `shell.openPath()`             |
| **檔案讀**  | `read_file`、`list_files`           |   Main   | `fs.readFile`、`fs.readdir`     |
| **檔案寫**  | `write_file`                       |   Main   | `fs.writeFile`                 |
| **命令執行** | `run_command`                      |   Main   | `child_process.execFile`       |
| **螢幕**   | `screenshot`                       |   Main   | `desktopCapturer.getSources()` |
| **剪貼簿**  | `clipboard_read`、`clipboard_write` |   Main   | `electron.clipboard`           |
| **瀏覽器**  | `web_search`                       | Renderer | `window.open()`                |
| **時間**   | `get_current_time`                 | Renderer | `new Date().toISOString()`     |

**設計原則**：判斷工具執行位置的標準只有一個——**是否需要 Node.js / Electron API**。需要 → Main (IPC)，不需要 →
Renderer（直接執行）。

### 4.3 工具的 OpenAI Function Calling 格式

每個工具在註冊時，需提供 LLM 能理解的 JSON Schema。這是 LLM 認知世界的唯一途徑：

```typescript
// 以 open_app 為例
const openAppTool = {
    definition: {
        type: 'function' as const,
        function: {
            name: 'open_app',
            description: '在 Windows 上開啟一個應用程式。傳入應用程式的名稱或完整路徑。',
            parameters: {
                type: 'object',
                properties: {
                    appPath: {
                        type: 'string',
                        description: '應用的可執行檔路徑或系統註冊的應用名稱，如 notepad、calc、explorer',
                    },
                },
                required: ['appPath'],
            },
        },
    },
    location: 'main' as const,
}
```

**關鍵洞察（來自 Claude Code）**：工具的 `description` 和 `parameters.description` 直接決定 LLM 能不能正確判斷何時調用該工具。這些字符串是
Prompt Engineering 的一部分，需要精心編寫，不是隨便寫的註釋。

### 4.4 工具註冊與裝配

借鑑 Claude Code 的靜態數組 + 動態過濾模式。本項目更簡單：

```
工具註冊（全部硬編碼）
  │
  ▼
生成 OpenAITools[]（所有工具的 definition）
  │
  ▼
注入 System Prompt（作為 LLM 可用的工具清單）
  │
  ▼
LLM 響應中解析 tool_calls
  │
  ▼
按 tool_call.function.name 查找工具 → 按 location 路由執行
```

無需動態過濾（功能開關、權限規則、模式限制），因為：

- 本項目的工具數量少（≤10 個），全部發送不占太多 token
- 內網應用，無需權限矩陣

### 4.5 工具執行流水線（簡化版）

```
LLM 返回 tool_calls[]
  │
  ▼
遍歷每個 tool_call：
  ├── 1. 按 name 查找工具定義
  ├── 2. JSON.parse(tool_call.function.arguments)
  ├── 3. location === 'renderer' ?
  │       ├── 是 → 本地直接執行
  │       └── 否 → window.agentAPI.execTool(name, args) → IPC → Main handler
  ├── 4. 收集執行結果 { toolCallId, toolName, content, success }
  └── 5. 將結果以 { role: 'tool', tool_call_id, content } 格式注入消息列表
```

---

## 5. 流式處理架構（對標 EP15 服務層）

### 5.1 為什麼流式輸出至關重要

用戶體驗的核心。Claude Code 使用原始 SSE 而非 SDK Stream 來避免 O(n²) 問題。本項目更簡單——使用 openai SDK 的 streaming，因為：

- 工具數量少，tool_calls 的 JSON 不會特別大
- openai SDK 的 stream 迭代器已經足夠高效
- 便利性優先，不需要自己解析 SSE

### 5.2 流事件狀態機

```
stream 開始
  │
  ├── chunk.choices[0].delta.content
  │     → 追加到 UI（打字機效果）
  │     → 累積到 currentContent
  │
  ├── chunk.choices[0].delta.tool_calls
  │     → 按 index 累積 tool_call 的 function.arguments（字符串拼接）
  │     → 不在此階段解析 JSON
  │
  └── stream 結束
        ├── 若 tool_calls 為空 → finish_reason = stop → 循環結束
        └── 若 tool_calls 不為空 → JSON.parse(累積的 arguments)
              → 執行工具
              → 結果注入 → continue 循環
```

### 5.3 流空閒看門狗

借鑑 Claude Code 的 90 秒空閒超時：

```
每次收到 chunk 時重置計時器
  ↓
若 90 秒內無任何 chunk → AbortController.abort()
  ↓
捕獲 AbortError → 提示用戶"連線超時，請重試"
```

### 5.4 請求中斷

使用者點擊"中止"按鈕 → 觸發 `AbortController.abort()` → SDK 內部的中斷信號傳到 fetch → 流終止 → `catch` 捕獲
`AbortError` → 清理狀態。

---

## 6. 上下文壓縮策略（對標 EP11 壓縮系統）

### 6.1 為什麼需要壓縮

一次典型的 Agent 對話可能包含：

- System Prompt (~1K tokens)
- 用戶消息 (~100 tokens)
- 工具調用 + 結果 (~500 tokens)
- LLM 回應 (~500 tokens)

10 輪對話後約 12K tokens。加上工具返回的大檔案內容（如 read_file 返回 500 行代碼），可能迅速超出模型上下文窗口。

### 6.2 簡化版壓縮策略

Claude Code 有四層壓縮（微壓縮 → 截斷 → 自動壓縮 → 緊急壓縮）。本項目簡化為兩層：

**Layer 1：消息截斷**

```
當估算的總 tokens 超過閾值時（如 80% 上下文窗口）：
  1. 保留 System Prompt（必須）
  2. 保留最近 N 輪完整對話
  3. 對更早的輪次，用 AI 摘要替代原始內容（autocompact）
```

**Layer 2：工具結果截斷**

```
每個工具返回的 content 限制最大字符數：
  - read_file: 返回前 4000 字符 + "...(截斷)"
  - list_files: 返回前 2000 字符
  - run_command: 返回前 3000 字符
  - 其他：默認 2000 字符
```

### 6.3 Token 估算

Claude Code 使用三級精度估算。本項目簡化：

```
粗略估算：字節數 / 4（零成本，足夠用於截斷判斷）
```

---

## 7. 目錄結構（對標 Claude Code 工具目錄規範）

借鑑 Claude Code 每個工具自包含在獨立目錄中的設計：

```
src/
├── agent.html                          # HTML 入口（獨立窗口）
└── agent/
    ├── main.ts                         # Vue app 啟動入口
    ├── App.vue                         # 根佈局（Prompt 面板 + 聊天區）
    ├── AgentView.vue                   # 主視圖
    ├── components/
    │   ├── ChatPanel.vue               # 聊天面板（消息列表容器）
    │   ├── ChatMessage.vue             # 單條消息（文字 / 工具調用卡片）
    │   ├── ChatInput.vue               # 輸入框 + 發送 + 中止
    │   ├── ToolCallCard.vue            # 工具調用結果展示
    │   └── PromptPanel.vue             # System Prompt 編輯器
    ├── composables/
    │   ├── useAgentChat.ts             # ★ 核心：while(true) 循環 + 流式處理
    │   ├── useAgentConfig.ts           # API Key 加載/緩存/刷新
    │   └── useAgentTools.ts            # 工具註冊 + 執行路由（local / IPC）
    ├── tools/
    │   ├── index.ts                    # 工具註冊中心（靜態數組）
    │   ├── open-app.tool.ts            # open_app 工具定義
    │   ├── file.tool.ts                # read_file / write_file / list_files
    │   ├── command.tool.ts             # run_command
    │   ├── screenshot.tool.ts          # screenshot
    │   ├── clipboard.tool.ts           # clipboard_read / clipboard_write
    │   └── browser.tool.ts             # web_search / get_current_time
    ├── prompts.ts                      # System Prompt 模板
    ├── store.ts                        # Pinia store（對話歷史 + 配置狀態）
    └── types.ts                        # Agent 內部型別

electron/
├── preload/
│   └── agent.preload.ts                # Agent 窗口專用 preload
├── main/
│   ├── ipc-handlers/
│   │   └── agent.handlers.ts           # 系統工具 IPC handler
│   └── db/
│       └── features/
│           └── agent/
│               ├── schema.ts           # agent_configs / agent_messages 表
│               └── service.ts          # API Key 讀寫 + 對話歷史讀寫

electron/shared/
└── ipc-channels/
    └── agent.ts                         # Agent IPC 頻道常量
```

### 目錄設計原則（來自 Claude Code）

1. **每個工具自包含**：工具的定義、描述、參數 schema 放在同一個檔案中。工具之間互不交叉。
2. **composables 是核心**：`useAgentChat.ts` 是整個 Agent 的大腦（對標 `QueryEngine + query()`）。
3. **tools/ 是能力邊界**：`tools/index.ts` 是註冊中心（對標 `tools.ts` 中的 `getAllBaseTools()`）。

---

## 8. 窗口生命週期

### 8.1 打開方式

- 在主窗口內部功能頁面中，使用者點擊"AI Agent"按鈕
- 觸發 IPC → `windowManager.createAgentWindow()`
- Agent 窗口是獨立 `BrowserWindow`，遵循 `log-viewer` 模式

### 8.2 生命週期

```
createAgentWindow()
  │
  ├── 已存在且未銷毀 → show() + focus()（不重建）
  └── 不存在 → new BrowserWindow()
        ├── ready-to-show → show()
        ├── 使用者操作...
        └── closed → agentWindow = null
```

### 8.3 與主窗口的關係

- 獨立窗口，非主窗口的子頁面
- 有自己的 preload (`agent.preload.ts`)、HTML 入口 (`agent.html`)、Vue app
- 關閉 Agent 窗口不影響主窗口
- Agent 窗口的 API Key 和對話歷史寫入主進程的 SQLite，共用同一個 `app.db`

---

## 9. API Key 管理

### 9.1 獲取與緩存流程

```
Agent 窗口打開
  │
  ▼
useAgentConfig().loadConfig()
  │
  ├── 1. 讀取本地 DB (agentAPI.readConfig)
  │     ├── 命中 → 載入 { apiKey, baseUrl, model } → 完成
  │     └── 未命中 → 繼續
  │
  ├── 2. 調用 TMBOM 後端接口（複用現有 http-client + auth interceptor）
  │     GET /api/v1/agent/config（或類似現有接口）
  │     ← 返回 { apiKey, baseUrl, model }
  │
  └── 3. 寫入本地 DB (agentAPI.writeConfig)
        → 下次啟動直接從 DB 讀，不再調用後端
```

### 9.2 刷新策略

- 若 LLM API 調用返回 401 / 403 → 清除本地 DB 中的 apiKey → 提示使用者重新獲取
- API Key 無過期時間（由 TMBOM 後端管理），除非調用失敗否則不刷新

### 9.3 存儲安全

- 內網應用，不做加密存儲
- API Key 明文存在 SQLite 的 `agent_configs` 表中
- 若後續需要，可加上 `safeStorage.encryptString()` / `decryptString()`

---

## 10. IPC 頻道定義

借鑑現有項目的 IPC 模式，新增 agent 頻道：

| 頻道                   |   模式   | 方向              | 說明                       |
|----------------------|:------:|-----------------|--------------------------|
| `agent:exec-tool`    | invoke | Renderer → Main | 執行需要 Node.js 能力的系統工具     |
| `agent:read-config`  | invoke | Renderer → Main | 從 SQLite 讀取 API Key / 配置 |
| `agent:write-config` | invoke | Renderer → Main | 寫入 API Key / 配置到 SQLite  |
| `agent:get-history`  | invoke | Renderer → Main | 查詢對話歷史                   |
| `agent:save-message` | invoke | Renderer → Main | 保存單條消息到 SQLite           |

### 為什麼不使用 push 模式

Claude Code 使用 AsyncGenerator 做推送（`yield`）。但在 Electron IPC 環境中，invoke/handle 模式更自然：

- **invoke 用於請求-響應**：工具執行、配置讀寫
- **push 用於服務端主動推送**：本項目中 LLM 的流式輸出直接在渲染端透過 openai SDK 的 stream 消費，不需要主進程轉發

---

## 11. 數據庫設計

### 11.1 agent_configs（KV 配置表）

| 欄位           | 類型        | 說明                                                                              |
|--------------|-----------|---------------------------------------------------------------------------------|
| `key`        | TEXT (PK) | 配置鍵：`api_key`, `base_url`, `model`, `system_prompt`, `temperature`, `max_turns` |
| `value`      | TEXT      | 配置值                                                                             |
| `updated_at` | INTEGER   | 更新時間戳                                                                           |

### 11.2 agent_messages（對話消息表）

| 欄位                | 類型        | 說明                             |
|-------------------|-----------|--------------------------------|
| `id`              | TEXT (PK) | UUID                           |
| `conversation_id` | TEXT      | 對話 ID（同一對話的消息共享）               |
| `role`            | TEXT      | `user` / `assistant` / `tool`  |
| `content`         | TEXT      | 消息文本                           |
| `tool_calls`      | TEXT      | JSON，LLM 的 function calling 請求 |
| `tool_results`    | TEXT      | JSON，工具執行結果                    |
| `timestamp`       | INTEGER   | 時間戳                            |

---

## 12. 與現有系統的整合點

| 整合點                         | 說明                                                                     |
|-----------------------------|------------------------------------------------------------------------|
| **electron.vite.config.ts** | 新增 renderer 入口 `agent.html` + preload 入口 `agent.preload.ts`            |
| **WindowManager**           | 新增 `createAgentWindow()` 方法                                            |
| **IPC Handlers**            | 新增 `registerAgentHandlers()`                                           |
| **IPC Channels**            | 新增 `agent.ts`，合入 `IpcChannels`                                         |
| **DB Schema**               | 新增 `agent/` feature（`schema.ts` + `service.ts`），合入 `features/index.ts` |
| **主窗口觸發**                   | 內部功能或其他入口觸發 `agent:open-window` IPC                                    |
| **npm 依賴**                  | `npm install openai`（前端 SDK）                                           |
| **TMBOM 後端**                | 依賴現有接口獲取 API Key（若無則改為讓使用者手動輸入）                                        |

---

## 13. 與 Claude Code 架構的對標總結

| Claude Code 子系統                | 本項目對應                            | 差異                                       |
|--------------------------------|----------------------------------|------------------------------------------|
| **QueryEngine** (EP01)         | `useAgentChat.ts` 中的 `while` 循環  | 相同模式，大幅簡化（無 12 步流水線、無 error recovery 矩陣） |
| **Tool System** (EP02)         | `tools/` 目錄 + `useAgentTools.ts` | 相同自包含目錄模式，但工具數量從 42+ 降到 ~10              |
| **Context Assembly** (EP10)    | `prompts.ts` + `PromptPanel.vue` | 三層架構簡化，不做 `CLAUDE.md` 文件遍歷               |
| **Compact System** (EP11)      | 消息截斷 + 工具結果截斷                    | 從 4 層降到 2 層                              |
| **Services/API** (EP15)        | openai SDK + `useAgentChat`      | 直接用 SDK，不自建 queryModel / withRetry       |
| **Permission Pipeline** (EP07) | **不需要**                          | 內網應用，無安全審批                               |
| **Multi-Agent** (EP03/08)      | **暫不需要**                         | v1 只有單 Agent                             |
| **Hook System** (EP05)         | **暫不需要**                         | v1 不做插件/鉤子                               |
| **Session Persistence** (EP09) | `agent_messages` 表               | 持久化簡化（不支援 fork/resume）                   |

---

## 14. 實施優先級

```
Phase 1 (核心 MVP)：
  ├── Agent 窗口基礎設施（HTML、preload、WindowManager）
  ├── useAgentChat（while 循環 + openai SDK 流式調用）
  ├── 聊天 UI（ChatPanel + ChatInput + ChatMessage）
  └── 2-3 個工具（open_app + read_file + web_search）驗證循環

Phase 2 (工具完善)：
  ├── 剩餘工具（write_file、list_files、run_command、screenshot、clipboard）
  └── ToolCallCard 元件

Phase 3 (體驗優化)：
  ├── Prompt 面板（System Prompt 編輯 + 模板選擇）
  ├── 上下文壓縮（消息截斷 + 工具結果截斷）
  ├── API Key 管理（後端獲取 + DB 緩存）
  └── 對話歷史持久化
```
