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
; 本檔實作兩個 hook:
;   customInit / customUnInit:強殺所有殘留 ichiaDesktop process,避免 oneClick 升級時
;     舊版檔案(better-sqlite3 .node、Electron helper exe 等)被 OS 鎖住導致
;     uninstaller 拿 error code 2「Failed to uninstall old application files」
;   customUnInstall:卸載時清 HKCU Run 鍵,避免遺留「指向已刪 exe 的開機啟動項」
;
; 開機自啟「寫入」由 app 內 ensureAutoLaunchRegistered() 在每次啟動時呼叫
; app.setLoginItemSettings 完成,不在安裝階段處理。
; ─────────────────────────────────────────────────────────────────────────────

; ── 強殺殘留 process 的工具巨集 ─────────────────────────────────────────
; 為什麼必須做:
;   electron-updater 的 quitAndInstall() 在 app.quit() 後立刻 spawn installer,
;   主進程的退出是 async 的(GPU / utility / renderer 子進程需要時間清),
;   uninstaller 跑到刪檔步驟時若任何 process 還掛著,Windows 拒絕刪 → error code 2。
;
; 處理方式:
;   /F  強制終止(不等 process 回應 WM_CLOSE)
;   /T  連子 process 一起殺(Electron helper / utility)
;   退出碼 0 = 殺成功;128 = 找不到目標 process(本來就沒在跑,OK)
;   兩個都當成功,只有其他錯誤碼才視為失敗(但我們不阻斷安裝流程,只 sleep)
!macro KillRunningInstances
  DetailPrint "Stopping any running ichiaDesktop instances..."
  nsExec::Exec 'taskkill /F /T /IM "${PRODUCT_FILENAME}.exe"'
  Pop $0
  ; 給 OS 一點時間釋放 file handle (driver / antivirus 也要時間退出)
  Sleep 1500
!macroend

; ── customInit:安裝(含升級覆蓋)開始前 ─────────────────────────────
!macro customInit
  !insertmacro KillRunningInstances
!macroend

; ── customUnInit:解除安裝開始前(oneClick 升級時 installer 內也會跑這個)──
!macro customUnInit
  !insertmacro KillRunningInstances
!macroend

; ── customUnInstall:卸載完成步驟,清開機啟動項 ──────────────────────
!macro customUnInstall
  ; 註冊表鍵名規則:Electron app.setLoginItemSettings 使用 productName 當 Value name。
  ; 來源:package.json 的 build.productName = "ichiaDesktop"。
  ; 若未來改 productName,這一行也要同步更新。
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "ichiaDesktop"
!macroend
