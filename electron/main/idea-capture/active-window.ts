/**
 * 讀一次前景視窗標題(docs/21 §3.3)。
 *
 * ⚠️ 邊界:這只是「快捷鍵按下瞬間,你正在看哪個視窗」的一句上下文線索。
 *    **不截圖、不探測 process/exe/URL、不與 work-collect 監控聯動**(獨立實作)。
 *    純 best-effort —— 拿不到就回空字串,絕不阻塞速記流程。
 *
 * 實作:Windows 用 PowerShell + user32 GetForegroundWindow/GetWindowText 讀標題,
 *      短超時;非 Windows 或任何失敗都回 ''。
 */

import {execFile} from 'child_process'
import {logger} from '../utils/logger'

const TAG = 'idea.active-window'

const PS_SCRIPT = `
$ErrorActionPreference='SilentlyContinue'
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class W {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
}
"@
$h=[W]::GetForegroundWindow()
$sb=New-Object System.Text.StringBuilder 512
[void][W]::GetWindowText($h,$sb,512)
$sb.ToString()
`.trim()

/**
 * 取前景視窗標題(≤300 字);非 Windows / 逾時 / 失敗回 ''。
 * @param timeoutMs 逾時(預設 1500ms,不拖慢速記小窗彈出)
 */
export function getForegroundWindowTitle(timeoutMs = 1500): Promise<string> {
    if (process.platform !== 'win32') return Promise.resolve('')

    return new Promise((resolve) => {
        execFile(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT],
            {timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024},
            (err, stdout) => {
                if (err) {
                    logger.debug(`前景視窗標題讀取失敗(忽略):${err.message}`, TAG)
                    return resolve('')
                }
                const title = (stdout || '').trim().replace(/\s+/g, ' ')
                resolve(title.length > 300 ? title.slice(0, 300) : title)
            },
        )
    })
}
