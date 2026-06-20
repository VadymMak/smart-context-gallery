import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { resolve } from 'path'

const src = resolve('node_modules/@ffmpeg/core/dist/umd')
const dest = resolve('public/ffmpeg')
mkdirSync(dest, { recursive: true })
copyFileSync(`${src}/ffmpeg-core.js`, `${dest}/ffmpeg-core.js`)
copyFileSync(`${src}/ffmpeg-core.wasm`, `${dest}/ffmpeg-core.wasm`)

const workerSrc = `${src}/ffmpeg-core.worker.js`
if (existsSync(workerSrc)) {
  copyFileSync(workerSrc, `${dest}/ffmpeg-core.worker.js`)
  console.log('FFmpeg core + worker copied to /public/ffmpeg')
} else {
  console.log('FFmpeg core copied to /public/ffmpeg (no worker file in this build)')
}
