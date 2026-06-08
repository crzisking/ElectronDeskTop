/**
 * windows/ 內部共用基礎建設。
 *
 * 不對外暴露;各 window class 走 import-from-sibling。
 */

import {app} from 'electron'
import {resolveResourcePath} from '../utils/resources-path'

export const isDev = !app.isPackaged

/**
 * 應用圖標(Windows 任務欄、窗口標題欄使用)。
 * 走 resolveResourcePath:
 *  - dev:  <projectRoot>/resources/icons/icon.ico
 *  - prod: <install>/resources/resources/icons/icon.ico
 */
export const appIconPath = resolveResourcePath('icons', 'icon.ico')

/**
 * 取得當前窗口要 load 的 URL / 檔案路徑。
 * dev → vite dev server 提供的 URL;prod → out/renderer/ 下打包好的 html
 *
 * @param htmlRelPath 相對於 src/ 的 html 路徑,如 'windows/main/index.html'
 */
export function resolveRendererEntry(htmlRelPath: string): { url?: string; file?: string } {
    if (isDev && process.env['ELECTRON_RENDERER_URL']) {
        return {url: `${process.env['ELECTRON_RENDERER_URL']}/${htmlRelPath}`}
    }
    // __dirname 在 runtime 指向 out/main/,跳到 out/renderer/<htmlRelPath>
    return {file: htmlRelPath}
}
