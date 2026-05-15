; ─────────────────────────────────────────────────────────────────────────────
; ichiaDesktop NSIS 客製化腳本
;
; electron-builder 在 NSIS 模板中提供以下 hook macro 給開發者覆寫:
;   customInit          — 安裝開始前
;   customInstall       — 安裝步驟中
;   customUnInit        — 卸載開始前
;   customUnInstall     — 卸載步驟中
;   customHeader        — 自訂腳本最頂部
;
; 本檔僅實作 customUnInstall:卸載時清掉 HKCU Run 鍵,
; 避免遺留「指向已刪除 exe 的開機啟動項」造成下次登入彈錯誤。
;
; 開機自啟「寫入」由 app 內 ensureAutoLaunchRegistered() 在每次啟動時呼叫
; app.setLoginItemSettings 完成,不在安裝階段處理 — 因為:
;   1. NSIS 寫入時還沒拿到實際 exe 路徑(installer 變數),不如 Electron 自動處理可靠
;   2. 集中在 app 啟動處,後續若升級改了 productName / 路徑,Electron 會幫忙同步
; ─────────────────────────────────────────────────────────────────────────────

!macro customUnInstall
  ; 註冊表鍵名規則:Electron app.setLoginItemSettings 使用 productName 當 Value name。
  ; 來源:package.json 的 build.productName = "ichiaDesktop"。
  ; 若未來改 productName,這一行也要同步更新。
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "ichiaDesktop"
!macroend
