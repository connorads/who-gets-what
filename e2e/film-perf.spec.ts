import { writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

/**
 * Frame timing while the film scrubs through each chapter, with the CPU
 * throttled four times. Each chapter is scrolled from its start to its rest
 * frame over 4 s at a steady speed. Run with `pnpm run perf:explore`, which
 * runs every @perf spec; results go to test-results/perf-film.json. The
 * headless shell draws WebGL in software, so record real-GPU numbers with
 * playwright-cli (docs/film/engineering.md).
 */

interface Sample {
  readonly chapter: string
  readonly frames: number
  readonly meanFps: number
  readonly p75Fps: number
  readonly worstFrameMs: number
  readonly longFrames: number
  readonly longestLoafMs: number
}

const CHAPTERS = [
  'one-year',
  'your-guess',
  'benefit-by-benefit',
  'every-constituency',
  'spending-per-person',
  'north-south-or-age',
  'your-area',
] as const

for (const grain of ['10m', '1m'] as const) {
  test(`@perf film frame rates per chapter, £${grain} grains, 4x CPU throttle`, async ({
    page,
  }) => {
    test.setTimeout(180_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`/?grain=${grain}`)
    await expect(page.locator('article.film')).toHaveAttribute('data-engine', 'ready', {
      timeout: 60_000,
    })
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })

    const measure = (chapter: string): Promise<Sample> =>
      page.evaluate(async (id): Promise<Sample> => {
        const section = document.getElementById(id)
        if (section === null) throw new Error(`No chapter ${id}`)
        const top = section.getBoundingClientRect().top + window.scrollY
        const end = top + section.offsetHeight - window.innerHeight * 0.3
        window.scrollTo({ top, behavior: 'instant' })
        await new Promise((resolve) => setTimeout(resolve, 600))
        const frames: number[] = []
        const loaf: number[] = []
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) loaf.push(entry.duration)
        })
        observer.observe({ type: 'long-animation-frame' })
        const duration = 4000
        const t0 = performance.now()
        await new Promise<void>((resolve) => {
          const tick = (t: number) => {
            frames.push(t)
            const k = Math.min((t - t0) / duration, 1)
            window.scrollTo({ top: top + (end - top) * k, behavior: 'instant' })
            if (k < 1) requestAnimationFrame(tick)
            else resolve()
          }
          requestAnimationFrame(tick)
        })
        await new Promise((resolve) => setTimeout(resolve, 300))
        observer.disconnect()
        const intervals = frames.slice(1).map((t, i) => t - (frames[i] ?? t))
        const sorted = intervals.toSorted((a, b) => a - b)
        const p75 = sorted[Math.floor(sorted.length * 0.75)] ?? 1
        const span = (frames.at(-1) ?? 0) - (frames[0] ?? 0)
        return {
          chapter: id,
          frames: intervals.length,
          meanFps: Math.round((intervals.length / span) * 10_000) / 10,
          p75Fps: Math.round(10_000 / p75) / 10,
          worstFrameMs: Math.round(sorted.at(-1) ?? 0),
          longFrames: loaf.filter((d) => d > 50).length,
          longestLoafMs: Math.round(Math.max(0, ...loaf)),
        }
      }, chapter)
    // One chapter after another, never overlapping.
    const samples = await CHAPTERS.reduce<Promise<readonly Sample[]>>(
      async (done, chapter) => [...(await done), await measure(chapter)],
      Promise.resolve([]),
    )
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
    const result = { measured: new Date().toISOString(), grain, cpuThrottle: 4, samples }
    writeFileSync(`test-results/perf-film-${grain}.json`, `${JSON.stringify(result, null, 2)}\n`)
    console.warn(JSON.stringify(result, null, 2))
    expect(samples).toHaveLength(CHAPTERS.length)
  })
}
