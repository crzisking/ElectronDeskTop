/**
 * 統一解析 `resources/` 目錄(圖標、靜態資源等)的絕對路徑。
 *
 * 為什麼需要這個 helper:
 *  - dev:`resources/` 在專案根,用 `app.getAppPath()` 拿得到
 *  - prod:`resources/` 是 `package.json` 的 `extraResources` 拷貝出來的,
 *    位置在 `<install>/resources/resources/`(雙層 resources 是因為 `to: "resources"`),
 *    而 `app.getAppPath()` 此時指向 `app.asar` 內部,根本不含這些檔
 *
 * 用法:
 *   resolveResourcePath('icons', 'tray-icon.png')
 *     → dev:  <projectRoot>/resources/icons/tray-icon.png
 *     → prod: <install>/resources/resources/icons/tray-icon.png
 *
 * 若改變了 package.json 的 extraResources `to` 欄位,這支 helper 要跟著調整。
 */

import {app} from 'electron'
import {join} from 'path'

/** `resources/` 在 dev / prod 各自的根目錄 */
function getResourcesBaseDir(): string {
  return app.isPackaged
    // prod:跟 app.asar 同層的 resources/,內含 extraResources 拷貝過來的內容
    ? join(process.resourcesPath, 'resources')
    // dev:專案根
    : join(app.getAppPath(), 'resources')
}

/**
 * 取 `resources/` 內任一檔的絕對路徑。
 * @param segments 相對 `resources/` 的路徑片段,例如 `'icons', 'tray-icon.png'`
 */
export function resolveResourcePath(...segments: string[]): string {
  return join(getResourcesBaseDir(), ...segments)
}
