import { copyFileSync, mkdirSync } from 'fs'
import { resolve } from 'path'

const src = resolve('node_modules/@ffmpeg/core/dist/umd')
const dest = resolve('public/ffmpeg')
mkdirSync(dest, { recursive: true })
copyFileSync(`${src}/ffmpeg-core.js`, `${dest}/ffmpeg-core.js`)
copyFileSync(`${src}/ffmpeg-core.wasm`, `${dest}/ffmpeg-core.wasm`)
console.log('FFmpeg core copied to /public/ffmpeg')
