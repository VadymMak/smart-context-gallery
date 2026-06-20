import { copyFileSync, mkdirSync, readdirSync } from 'fs'
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

console.log('FFmpeg files copied to /public/ffmpeg/')
