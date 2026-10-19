// Draws demo.html frame by frame with Playwright's Chromium, then writes
// demo.mp4 and demo.gif with ffmpeg. Run: node frames.mjs
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const FPS = 24
const SECONDS = 11
const here = resolve(dirname(fileURLToPath(import.meta.url)))
const frames = join(here, 'frames')

const root = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright')
const builds = readdirSync(root).filter(name => /^chromium-\d+$/.test(name)).sort().reverse()
let exe = ''
for (const build of builds) {
  for (const sub of ['chrome-win64', 'chrome-win']) {
    const candidate = join(root, build, sub, 'chrome.exe')
    if (!exe && existsSync(candidate)) exe = candidate
  }
}
if (!exe) throw new Error(`no chromium under ${root}; run: npx playwright install chromium`)

rmSync(frames, { recursive: true, force: true })
mkdirSync(frames)
const browser = await chromium.launch({ executablePath: exe, headless: true, timeout: 60_000 })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
await page.goto(`file:///${here.replace(/\\/g, '/')}/demo.html?t=0`)
await page.evaluate(() => document.fonts.ready)
const count = FPS * SECONDS
for (let i = 0; i < count; i += 1) {
  await page.evaluate(t => window.render(t), (i * 1000) / FPS)
  await page.screenshot({ path: join(frames, `f_${String(i).padStart(4, '0')}.png`) })
}
await browser.close()
console.log(`drew ${count} frames`)

// FFMPEG may name the binary when it is not on PATH as `ffmpeg`.
const ffmpeg = process.env.FFMPEG ?? 'ffmpeg'
const run = args => {
  const result = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`ffmpeg failed (${result.error?.message ?? `exit ${result.status}`}): ${args.join(' ')}`)
}
const input = ['-framerate', String(FPS), '-i', join(frames, 'f_%04d.png')]
run([...input, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', join(here, 'demo.mp4')])
run([
  ...input,
  '-vf', 'fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=5',
  join(here, 'demo.gif'),
])
console.log('wrote demo.mp4 and demo.gif')
