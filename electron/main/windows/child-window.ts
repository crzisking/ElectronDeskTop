/**
 * openChildWindow — 通用「在新 Electron 子窗口打開指定 URL」工廠函式。
 *
 * 用於 unifiedPlatform 中 openMode='electron-window' 的系統入口。
 *
 * 為什麼是函式而非 class:每次呼叫就建一個新窗口,沒有 lifecycle / 狀態需要追蹤,
 * 純粹是「丟個 URL,給我一個 BrowserWindow」。
 *
 * 安全:用 allowedDomains 白名單限制可加載的 URL host;空白名單拒絕所有。
 */

import {BrowserWindow} from 'electron'
import {logger} from '../utils/logger'
import {safeOpenExternal} from '../utils/safe-shell'
import {appIconPath} from './_shared'

/**
 * @param url            要加載的系統 URL
 * @param title          窗口標題
 * @param allowedDomains 允許加載的 host 白名單(空表示全拒)
 */
export function openChildWindow(url: string, title: string, allowedDomains: string[] = []): BrowserWindow {
    const child = new BrowserWindow({
        width: 1200,
        height: 800,
        title,
        icon: appIconPath,
        frame: true,
        autoHideMenuBar: true,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            // 子窗口故意不用 sandbox:true。
            // 主窗 / 浮球用 sandbox 是因為 preload 暴露了 contextBridge;子窗口沒有 preload,
            // sandbox 沒有額外收益;且 ERP/BI/BPM 等內網系統在 OS 級沙箱下偶有空白現象,
            // 跟「網頁是受信任內網」場景對齊。
            sandbox: false,
        },
    })

    child.setMenuBarVisibility(false)
    child.removeMenu()

    // URL 解析 + 白名單校驗
    let parsedUrl: URL
    try {
        parsedUrl = new URL(url)
    } catch {
        logger.warn(`子窗口 URL 格式無效,拒絕打開: ${url}`, 'ChildWindow')
        child.close()
        return child
    }

    if (!allowedDomains.includes(parsedUrl.hostname)) {
        logger.warn(`子窗口 URL 域名不在白名單內,拒絕打開: ${parsedUrl.hostname}`, 'ChildWindow')
        child.close()
        return child
    }

    // 載入失敗時記錄具體錯誤碼,排查空白窗口問題
    child.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        // -3 = ABORTED,通常是用戶取消,忽略
        if (errorCode === -3 || !isMainFrame) return
        logger.error(
            `子窗口加載失敗: ${validatedURL} (${errorCode} ${errorDescription})`,
            'ChildWindow',
        )
    })

    child.loadURL(url).catch((err) => {
        // 窗口在載入完成前被關閉時 Electron reject promise,不算真錯誤
        if (child.isDestroyed() || err?.code === 'ERR_ABORTED' || err?.errno === -3 || err?.errno === -2) {
            logger.info(`子窗口 loadURL 被中斷(已關閉或載入取消): ${url}`, 'ChildWindow')
            return
        }
        logger.error(`子窗口 loadURL 拋異常: ${url}`, 'ChildWindow', err)
    })

    // 子窗口內的外部連結走系統瀏覽器
    child.webContents.setWindowOpenHandler(({url: linkUrl}) => {
        safeOpenExternal(linkUrl)
        return {action: 'deny'}
    })

    logger.info(`子窗口已創建: ${title} → ${url}`, 'ChildWindow')
    return child
}
