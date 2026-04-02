# 企業桌面客戶端

> 基於 Electron + Vue 3 + TypeScript + Element Plus 的企業內部桌面端統一入口

## 核心功能

| 功能 | 說明 |
|------|------|
| 統一平台頁面 | 公司各內部系統的快捷入口，支持 SSO 直通與 iframe 嵌入 |
| AI 快捷功能 | 文本處理、摘要生成、智能問答，對接公司 AI 後端 |
| 快速聯繫 | 搜索問題負責人，直接發送郵件聯繫 |
| 浮動小球 | 主窗口最小化後變為可拖動的懸浮球，右鍵快捷菜單 |

## 技術棧

- **桌面框架**：Electron 28+
- **前端框架**：Vue 3 + TypeScript
- **UI 組件庫**：Element Plus
- **構建工具**：electron-vite
- **狀態管理**：Pinia
- **路由**：Vue Router 4
- **HTTP 客戶端**：Axios

## 快速開始

```bash
# 安裝依賴（首次或更新 package.json 後執行）
npm install

# 開發模式啟動（主進程 + 渲染進程熱更新）
npm run dev

# 打包（Windows）
npm run build:win

# 打包（macOS）
npm run build:mac
```

### 啟動驗證清單

啟動後應依次驗證：

1. **主窗口**：顯示自定義標題欄 + 左側三個菜單項（統一平台、AI 快捷功能、快速聯繫）
2. **關閉主窗口**：點擊 `×` 後主窗口隱藏，屏幕右側出現圓形浮球
3. **浮球左鍵點擊**：主窗口重新顯示並置頂
4. **浮球右鍵菜單**：顯示自定義菜單（打開主窗口 / 頁面快捷跳轉 / 退出應用）
5. **浮球拖動**：按住左鍵拖動，松開後浮球吸附到最近的屏幕邊緣

### 配置說明

所有功能均由 `config/app-config.json` 驅動，修改後重啟應用生效：

- `sidebar.items` — 左側導航菜單項（圖標使用 Element Plus Icons 名稱）
- `floatingBall.quickMenu` — 浮球右鍵快捷菜單項
- `unifiedPlatform.systems` — 統一平台系統卡片（含 SSO 配置）
- `aiQuickFunctions.apiBaseUrl` — AI 服務接口地址
- `quickContact.apiBaseUrl` — 聯繫人搜索 + 郵件發送接口地址

## 文檔索引

| 文檔 | 內容 |
|------|------|
| [技術選型](docs/01-技术选型.md) | 框架對比、依賴清單、選型理由 |
| [架構設計](docs/02-架构设计.md) | 進程模型、IPC 通信、浮球窗口、窗口狀態機 |
| [功能設計](docs/03-功能设计.md) | 三大功能模塊的詳細設計與交互流程 |
| [配置說明](docs/04-配置说明.md) | app-config.json 完整 Schema 與示例 |
| [開發規範](docs/05-开发规范.md) | 目錄結構、Store 設計、API 層、編碼規範 |

## 目錄結構

```
.
├── config/
│   └── app-config.json          # 應用配置（導航、浮球菜單、API 地址等）
├── docs/                        # 設計文檔
├── electron/
│   ├── main/
│   │   ├── index.ts             # Electron 主進程入口
│   │   ├── window-manager.ts    # 主窗口 + 浮球窗口管理
│   │   ├── floating-ball.ts     # 浮球拖動 + 邊緣吸附邏輯
│   │   ├── tray-manager.ts      # 系統托盤管理
│   │   ├── config-manager.ts    # 配置文件讀寫
│   │   ├── ipc-handlers/        # IPC 處理器（按模塊拆分）
│   │   └── utils/logger.ts      # 日誌工具
│   ├── preload/
│   │   ├── index.ts             # 主窗口 preload（暴露 electronAPI）
│   │   └── floating-ball.preload.ts  # 浮球窗口 preload
│   └── shared/
│       └── ipc-channels.ts      # IPC 頻道常量（主進程/渲染進程共用）
├── src/
│   ├── api/                     # Axios HTTP 客戶端 + 各模塊 API
│   ├── components/
│   │   ├── layout/              # TitleBar / SidebarNav / AppLayout
│   │   └── common/              # IframeContainer / LoadingSpinner
│   ├── composables/
│   │   └── useAiStream.ts       # SSE 流式 AI 回答
│   ├── floating-ball/           # 浮球窗口獨立 Vue 應用
│   │   ├── main.ts
│   │   ├── App.vue
│   │   ├── FloatingBall.vue
│   │   └── QuickMenu.vue
│   ├── router/index.ts          # Vue Router（hash 模式）
│   ├── stores/                  # Pinia stores
│   ├── styles/global.css        # 全局樣式 + Element Plus 變量覆蓋
│   ├── types/                   # TypeScript 類型定義
│   ├── views/                   # 頁面組件
│   │   ├── Login/
│   │   ├── UnifiedPlatform/
│   │   ├── AiQuickFunctions/
│   │   └── QuickContact/
│   ├── main.ts                  # 主窗口 Vue 入口
│   └── App.vue                  # 主窗口根組件
├── index.html                   # 主窗口 HTML
├── floating-ball.html           # 浮球窗口 HTML
├── electron.vite.config.ts      # electron-vite 構建配置
└── package.json
```

## 項目狀態

- [x] 技術文檔（docs/）
- [x] 項目配置（package.json / tsconfig / electron.vite.config.ts）
- [x] 類型定義（src/types/）
- [x] 主進程（electron/main/）
- [x] IPC Handlers（electron/main/ipc-handlers/）
- [x] Preload 腳本（electron/preload/）
- [x] Pinia Stores（config / auth / ui）
- [x] Vue Router
- [x] API 層（http-client / interceptors / modules）
- [x] Composables（useAiStream）
- [x] 佈局組件（TitleBar / SidebarNav / AppLayout）
- [x] 統一平台頁面
- [x] AI 快捷功能頁面
- [x] 快速聯繫頁面
- [x] 浮球窗口應用
- [x] 根組件 + 全局樣式
- [x] 應用配置文件（config/app-config.json）
- [ ] 登錄功能（預留 LoginView 占位）
- [ ] 配置熱更新（fs.watchFile 監聽）
- [ ] 打包構建驗證
