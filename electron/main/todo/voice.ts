/**
 * 桌面代辦 · 觸發 Windows 11 系統語音輸入(Win+H)(docs/23 §2)。
 *
 * 不自建 STT:合成一次 LWin+H,由 OS 把辨識文字打進「當前聚焦的輸入框」(= 錄入窗的 input)。
 * 用 user32 keybd_event(免重型原生依賴,PowerShell P/Invoke)。
 * 護欄:只在使用者點 🎤 時觸發(此刻錄入窗已聚焦);失敗靜默,手打不受影響。
 */

import {spawn} from 'child_process'
import {logger} from '../utils/logger'

const TAG = 'todo.voice'

// LWin=0x5B,H=0x48,KEYEVENTF_KEYUP=2
const PS = [
    "Add-Type -Name K -Namespace W -MemberDefinition '[DllImport(\"user32.dll\")] public static extern void keybd_event(byte b,byte s,uint f,int e);';",
    '[W.K]::keybd_event(0x5B,0,0,0);',
    '[W.K]::keybd_event(0x48,0,0,0);',
    'Start-Sleep -Milliseconds 40;',
    '[W.K]::keybd_event(0x48,0,2,0);',
    '[W.K]::keybd_event(0x5B,0,2,0);',
].join(' ')

/** 觸發系統語音輸入;非 Windows 或失敗都靜默 no-op */
export function triggerWindowsVoice(): void {
    if (process.platform !== 'win32') return
    try {
        const child = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', PS], {
            windowsHide: true,
            stdio: 'ignore',
        })
        child.on('error', (e) => logger.warn(`語音觸發失敗:${e.message}`, TAG))
    } catch (err) {
        logger.warn(`語音觸發異常:${(err as Error).message}`, TAG)
    }
}
