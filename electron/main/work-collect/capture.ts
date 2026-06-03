/**
 * 採集截圖 + dHash + 可見視窗清單。
 *
 * 純 Infrastructure 層:只跟 Electron 截圖 API 打交道,不知業務規則。
 */

import {desktopCapturer, NativeImage, screen} from 'electron'

export class CaptureService {
    /** 主螢幕全屏截圖 */
    async captureScreenshot(): Promise<NativeImage> {
        const {width, height} = screen.getPrimaryDisplay().workAreaSize
        const sources = await desktopCapturer.getSources({types: ['screen'], thumbnailSize: {width, height}})
        return sources[0].thumbnail
    }

    /** 可見視窗標題,排除自家 app,最多 10 個 */
    async collectVisibleWindowTitles(): Promise<string[]> {
        const sources = await desktopCapturer.getSources({types: ['window'], thumbnailSize: {width: 0, height: 0}})
        return sources.map((s) => s.name).filter((n) => n && !/ichia ?desktop/i.test(n)).slice(0, 10)
    }

    /**
     * dHash:9×8 灰階差分 → 64 bit,回 16 hex。
     * 兩張圖 Hamming 距離 ≤ ~10 視為畫面未變(idle 判定用)。
     */
    computeDHash(img: NativeImage): string {
        const small = img.resize({width: 9, height: 8, quality: 'good'})
        const bgra = small.toBitmap()
        const gray = new Uint8Array(9 * 8)
        for (let i = 0, j = 0; i < bgra.length; i += 4, j++) {
            gray[j] = (bgra[i + 2] * 299 + bgra[i + 1] * 587 + bgra[i] * 114) / 1000 | 0
        }
        let hex = ''
        for (let y = 0; y < 8; y++) {
            let row = 0
            for (let x = 0; x < 8; x++) {
                if (gray[y * 9 + x] > gray[y * 9 + x + 1]) row |= 1 << (7 - x)
            }
            hex += row.toString(16).padStart(2, '0')
        }
        return hex
    }

    /** 從視窗標題抽 app 名:`foo.ts - VSCode` → `VSCode` */
    extractAppHint(title: string): string {
        const parts = title.split(' - ')
        return parts.length > 1 ? parts[parts.length - 1].trim() : title
    }
}
