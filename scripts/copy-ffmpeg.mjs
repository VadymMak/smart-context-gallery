import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

const dest = resolve('public/ffmpeg')
mkdirSync(dest, { recursive: true })

// @ffmpeg/core files
const coreSrc = resolve('node_modules/@ffmpeg/core/dist/umd')
copyFileSync(`${coreSrc}/ffmpeg-core.js`, `${dest}/ffmpeg-core.js`)
copyFileSync(`${coreSrc}/ffmpeg-core.wasm`, `${dest}/ffmpeg-core.wasm`)

// @ffmpeg/ffmpeg files (main library + its chunks)
const ffmpegSrc = resolve('node_modules/@ffmpeg/ffmpeg/dist/umd')
readdirSync(ffmpegSrc).forEach(file => {
  copyFileSync(`${ffmpegSrc}/${file}`, `${dest}/${file}`)
})

// Patch ffmpeg.js — replace CDN publicPath with local path
const ffmpegJsPath = resolve('public/ffmpeg/ffmpeg.js')
let content = readFileSync(ffmpegJsPath, 'utf8')
content = content.replace(
  /https:\/\/cdn\.jsdelivr\.net\/npm\/@ffmpeg\/ffmpeg@[^"']+\/dist\/umd\//g,
  '/ffmpeg/'
)
content = content.replace(
  /https:\/\/unpkg\.com\/@ffmpeg\/ffmpeg@[^"']+\/dist\/umd\//g,
  '/ffmpeg/'
)
writeFileSync(ffmpegJsPath, content, 'utf8')
console.log('Patched ffmpeg.js publicPath → /ffmpeg/')

console.log('FFmpeg files copied to /public/ffmpeg/')
