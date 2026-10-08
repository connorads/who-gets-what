import { writeFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

/**
 * Frame timing during explorer morphs with the CPU throttled four times
 * (the budget in docs/architecture.md: 55 fps or more at p75, no long
 * animation frame over 50 ms). Run with `pnpm run perf:explore`; results
 * go to test-results/perf-explore.json.
 */

declare global {
  interface Window {
    perfFrames: number[]
    perfLoaf: number[]
    perfStop: boolean
  }
}

interface Sample {
  readonly change: string
  readonly frames: number
  readonly meanFps: number
  readonly p75Fps: number
  readonly worstFrameMs: number
  readonly longFrames: number
  readonly longestLoafMs: number
}

async function startRecording(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window
    w.perfFrames = []
    w.perfLoaf = []
    w.perfStop = false
    const tick = (t: number) => {
      w.perfFrames.push(t)
      if (!w.perfStop) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) w.perfLoaf.push(entry.duration)
    }).observe({ type: 'long-animation-frame' })
  })
}

async function stopRecording(page: Page, change: string): Promise<Sample> {
  const { frames, loaf } = await page.evaluate(() => {
    const w = window
    w.perfStop = true
    return { frames: w.perfFrames, loaf: w.perfLoaf }
  })
  const intervals = frames.slice(1).map((t, i) => t - (frames[i] ?? t))
  const sorted = intervals.toSorted((a, b) => a - b)
  const p75 = sorted[Math.floor(sorted.length * 0.75)] ?? 0
  const span = (frames.at(-1) ?? 0) - (frames[0] ?? 0)
  return {
    change,
    frames: intervals.length,
    meanFps: Math.round((intervals.length / span) * 1000 * 10) / 10,
    p75Fps: Math.round((1000 / p75) * 10) / 10,
    worstFrameMs: Math.round(sorted.at(-1) ?? 0),
    longFrames: loaf.filter((d) => d > 50).length,
    longestLoafMs: Math.round(Math.max(0, ...loaf)),
  }
}

test('@perf morph frame rates with a 4x CPU throttle', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/explore')
  await expect(page.locator('.stage')).toHaveAttribute('data-engine', 'ready', { timeout: 30_000 })
  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2')
    const info = gl?.getExtension('WEBGL_debug_renderer_info')
    return info ? String(gl?.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown'
  })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  await page.waitForTimeout(500)

  await page.locator('.refine > summary').click()
  const skyline = () => page.getByTestId('skyline-toggle').click()
  const changes: readonly [string, () => Promise<void>, number?][] = [
    ['map to swarm (first morph)', () => page.keyboard.press('s')],
    ['swarm to rank', () => page.keyboard.press('r')],
    ['rank to map', () => page.keyboard.press('m')],
    ['map to equal-size areas', () => page.keyboard.press('e')],
    ['equal-size areas to map', () => page.keyboard.press('m')],
    ['skyline reveal', skyline, 2000],
    ['skyline settles flat', skyline, 2000],
    ['map to swarm', () => page.keyboard.press('s')],
    [
      'denominator in swarm (Four rulers)',
      () =>
        page.getByRole('group', { name: 'Divide by' }).getByRole('link', { name: 'Total' }).click(),
    ],
  ]
  const measure = async (
    change: string,
    trigger: () => Promise<void>,
    ms = 1600,
  ): Promise<Sample> => {
    await startRecording(page)
    await trigger()
    // A morph takes 0.6 s, Four rulers 1.4 s and the skyline's camera 1.6 s; record past each end.
    await page.waitForTimeout(ms)
    const sample = await stopRecording(page, change)
    await page.waitForTimeout(400)
    return sample
  }
  // Each change is measured on its own, one after another.
  const samples = await changes.reduce<Promise<readonly Sample[]>>(
    async (done, [change, trigger, ms]) => [...(await done), await measure(change, trigger, ms)],
    Promise.resolve([]),
  )
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })

  const result = { measured: new Date().toISOString(), cpuThrottle: 4, renderer, samples }
  writeFileSync('test-results/perf-explore.json', `${JSON.stringify(result, null, 2)}\n`)
  console.warn(JSON.stringify(result, null, 2))
  expect(samples).toHaveLength(changes.length)
})
