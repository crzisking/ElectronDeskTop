/**
 * 從 ichia.png 生成所有應用所需的圖標文件
 *
 * 輸出：
 *  - resources/icons/icon.png              (256x256, Linux app icon)
 *  - resources/icons/icon.ico              (Windows app icon, 多尺寸)
 *  - resources/icons/tray-icon.png         (32x32, Windows/Linux 托盤)
 *  - resources/icons/tray-iconTemplate.png (22x22, macOS 托盤)
 *  - src/assets/logo.png                   (128x128, Vue 組件用)
 */

import { createRequire } from 'module'
const require = createRequire(import.meta.url)

const Jimp = require('jimp')
const { default: pngToIco } = await import('png-to-ico')
const { writeFileSync, mkdirSync } = require('fs')
const { join, dirname } = require('path')
const { fileURLToPath } = require('url')

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')
const iconsDir = join(projectRoot, 'resources', 'icons')
const assetsDir = join(projectRoot, 'src', 'assets')
const source = join(iconsDir, 'ichia.png')

mkdirSync(assetsDir, { recursive: true })

/**
 * 將 logo 等比縮放並置中到正方形畫布上
 * @param {number} size 目標正方形尺寸
 * @param {object} bg 背景色 { r, g, b, a }
 */
async function resizeToSquare(size, bg = { r: 255, g: 255, b: 255, a: 255 }) {
  const img = await Jimp.read(source)
  const srcW = img.getWidth()
  const srcH = img.getHeight()

  // 等比縮放，使較長邊 = size
  const scale = Math.min(size / srcW, size / srcH)
  const newW = Math.round(srcW * scale)
  const newH = Math.round(srcH * scale)

  img.resize(newW, newH)

  // 創建正方形背景畫布
  const bgColor = Jimp.rgbaToInt(bg.r, bg.g, bg.b, bg.a)
  const canvas = new Jimp(size, size, bgColor)

  // 將 logo 置中貼上
  const x = Math.round((size - newW) / 2)
  const y = Math.round((size - newH) / 2)
  canvas.composite(img, x, y)

  return canvas
}

async function generateIcons() {
  console.log('開始生成圖標...')

  // 1. 生成各尺寸 PNG（白色背景）
  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const pngBuffers = {}

  for (const size of sizes) {
    const canvas = await resizeToSquare(size, { r: 255, g: 255, b: 255, a: 255 })
    pngBuffers[size] = await canvas.getBufferAsync(Jimp.MIME_PNG)
    console.log(`  PNG ${size}x${size} OK`)
  }

  // icon.png (256x256) — Linux app icon
  writeFileSync(join(iconsDir, 'icon.png'), pngBuffers[256])
  console.log('-> icon.png (256x256)')

  // 2. 生成 icon.ico (Windows) — 多尺寸
  const icoBuffer = await pngToIco(
    [16, 24, 32, 48, 64, 128, 256].map(s => pngBuffers[s])
  )
  writeFileSync(join(iconsDir, 'icon.ico'), icoBuffer)
  console.log('-> icon.ico (multi-size)')

  // 3. tray-icon.png (32x32) — Windows/Linux 系統托盤
  writeFileSync(join(iconsDir, 'tray-icon.png'), pngBuffers[32])
  console.log('-> tray-icon.png (32x32)')

  // 4. tray-iconTemplate.png (22x22) — macOS 托盤（透明背景）
  const trayMac = await resizeToSquare(22, { r: 0, g: 0, b: 0, a: 0 })
  const trayMacBuf = await trayMac.getBufferAsync(Jimp.MIME_PNG)
  writeFileSync(join(iconsDir, 'tray-iconTemplate.png'), trayMacBuf)
  console.log('-> tray-iconTemplate.png (22x22)')

  // 5. src/assets/logo.png — Vue 組件使用（透明背景）
  const logo = await resizeToSquare(128, { r: 0, g: 0, b: 0, a: 0 })
  const logoBuf = await logo.getBufferAsync(Jimp.MIME_PNG)
  writeFileSync(join(assetsDir, 'logo.png'), logoBuf)
  console.log('-> src/assets/logo.png (128x128)')

  console.log('\n所有圖標生成完成！')
}

generateIcons().catch(console.error)
