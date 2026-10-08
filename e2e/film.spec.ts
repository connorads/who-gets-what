import { expect, test, type Page } from '@playwright/test'

const FILM = '/'

const film = (page: Page) => page.locator('article.film')

/** Make this page's browser report no WebGL2, as an old or locked-down browser would. */
async function withoutWebGl(page: Page): Promise<void> {
  await page.addInitScript({
    content: `(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
        return kind === 'webgl2' || kind === 'webgl' ? null : original.call(this, kind, ...rest);
      };
    })()`,
  })
}

/** Open the film and wait until its canvas has drawn. */
async function openWatch(page: Page, path = FILM): Promise<void> {
  await page.goto(path)
  await expect(film(page)).toHaveAttribute('data-engine', 'ready', { timeout: 30_000 })
}

const scrollY = (page: Page) => page.evaluate(() => window.scrollY)

// A playing film draws every frame, and the headless shell draws WebGL in
// software, so playback leaves the page slow to answer.
test.describe.configure({ timeout: 180_000 })
const SLOW = { timeout: 20_000 } as const

test('the server sends the poster figure, every chapter and the transcript', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto(FILM)

  await expect(page.getByRole('heading', { level: 1 })).toContainText('£299bn')
  await expect(film(page)).toHaveAttribute('data-mode', 'read')
  await expect(page.locator('section.film-chapter')).toHaveCount(7)
  await expect(page.locator('.film-still')).toHaveCount(6)
  await expect(page.locator('#transcript')).toContainText('£138 billion')
  // Play needs script; the explorer link does not.
  await expect(page.getByRole('button', { name: 'Play the film' })).toBeHidden()
  await expect(page.getByRole('link', { name: 'Skip to the map' })).toBeVisible()
  await context.close()
})

test('the film loads in Watch mode and draws its first frame', async ({ page }) => {
  await openWatch(page)

  await expect(film(page)).toHaveAttribute('data-mode', 'watch')
  await expect(page.locator('.film-canvas canvas')).toHaveCount(1)
  await expect(page.locator('.film-key')).toContainText('Each dot = £')
  await expect(film(page)).toHaveAttribute('data-player', 'idle')
  await expect(page.locator('.film-player')).toBeHidden()
})

test('Play starts the film, which scrolls itself under the narration', async ({ page }) => {
  await openWatch(page)

  await page.getByRole('button', { name: 'Play the film' }).click()

  await expect(film(page)).toHaveAttribute('data-player', 'playing', SLOW)
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
  await expect(page.locator('.film-captions')).toContainText('to allow for inflation', {
    timeout: 40_000,
  })
  expect(await scrollY(page)).toBeGreaterThan(300)
  const stored = await page.evaluate(() => window.localStorage.getItem('wgw-film-seen'))
  expect(stored).toBe('1')
})

test('the film waits for the guess, then plays on once it is locked', async ({ page }) => {
  await openWatch(page)
  await page.getByRole('button', { name: 'Play the film' }).click()
  await page.locator('.film-player__chapters summary').click()
  await page.getByRole('button', { name: '02 Your guess' }).click()

  await expect(film(page)).toHaveAttribute('data-player', 'guess', { timeout: 60_000 })
  await expect(page.locator('.film-captions')).toContainText("Now it's your turn")
  const waiting = await scrollY(page)
  await page.waitForTimeout(1000)
  expect(await scrollY(page)).toBe(waiting)

  await page.getByRole('button', { name: 'Lock in my guess' }).click()

  await expect(film(page)).toHaveAttribute('data-player', 'playing', SLOW)
  await expect.poll(() => scrollY(page), { timeout: 20_000 }).toBeGreaterThan(waiting + 100)
})

test('Skip guess carries on without a guess', async ({ page }) => {
  await openWatch(page)
  await page.getByRole('button', { name: 'Play the film' }).click()
  await page.locator('.film-player__chapters summary').click()
  await page.getByRole('button', { name: '02 Your guess' }).click()
  await expect(film(page)).toHaveAttribute('data-player', 'guess', { timeout: 60_000 })

  await page.getByRole('button', { name: 'Skip guess' }).click()

  await expect(film(page)).toHaveAttribute('data-player', 'playing', SLOW)
  const stored = await page.evaluate(() => window.localStorage.getItem('wgw-film-guess'))
  expect(stored).toBeNull()
})

test('a wheel scroll takes over, and Resume plays on from the beat on screen', async ({ page }) => {
  await openWatch(page)
  await page.getByRole('button', { name: 'Play the film' }).click()
  await expect.poll(() => scrollY(page), { timeout: 30_000 }).toBeGreaterThan(200)

  await page.mouse.move(700, 400)
  await page.mouse.wheel(0, 600)

  await expect(film(page)).toHaveAttribute('data-player', 'manual', SLOW)
  const resume = page.getByRole('button', { name: 'Resume' })
  await expect(resume).toBeVisible(SLOW)
  await expect(page.locator('.film-captions p')).toBeVisible()
  const held = await scrollY(page)
  await page.waitForTimeout(800)
  expect(Math.abs((await scrollY(page)) - held)).toBeLessThan(2)

  await resume.click()

  await expect(film(page)).toHaveAttribute('data-player', 'playing', SLOW)
  await expect.poll(() => scrollY(page), { timeout: 20_000 }).toBeGreaterThan(held + 50)
})

test('space pauses and plays, and the arrows step between lines', async ({ page }) => {
  await openWatch(page)
  await page.getByRole('button', { name: 'Play the film' }).click()
  await expect(film(page)).toHaveAttribute('data-player', 'playing', SLOW)
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })

  await page.keyboard.press('Space')
  await expect(film(page)).toHaveAttribute('data-player', 'paused', SLOW)
  const time = page.locator('.film-player__time')
  const before = await time.innerText()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(time).not.toHaveText(before, SLOW)
  await page.keyboard.press('Space')
  await expect(film(page)).toHaveAttribute('data-player', 'playing', SLOW)
})

test('Read mode works without WebGL: stills and words, no canvas', async ({ page }) => {
  await withoutWebGl(page)
  await page.goto(FILM)

  await expect(film(page)).toHaveAttribute('data-mode', 'read')
  await expect(page.locator('.film-still').first()).toBeVisible()
  await expect(page.locator('.film-canvas canvas')).toHaveCount(0)
  await expect(page.locator('#benefit-by-benefit')).toContainText('State Pension is the largest')
  await expect(page.getByRole('table').first()).toBeVisible()
})

test('?mode=read keeps the stills even where WebGL works', async ({ page }) => {
  await page.goto('/?mode=read')

  await expect(film(page)).toHaveAttribute('data-mode', 'read')
  await page.waitForTimeout(500)
  await expect(page.locator('.film-canvas canvas')).toHaveCount(0)
})

test('reduced motion shows the stills, which cross-fade in', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(FILM)

  await expect(film(page)).toHaveAttribute('data-mode', 'read')
  await expect(page.locator('.film-canvas canvas')).toHaveCount(0)
  const wall = page.locator('#benefit-by-benefit .film-still')
  await wall.scrollIntoViewIfNeeded()
  await expect(wall).toHaveAttribute('data-seen', 'true')
})

test('with reduced motion, Play steps through the stills with the voice', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(FILM)

  await page.getByRole('button', { name: 'Play the film' }).click()

  await expect(film(page)).toHaveAttribute('data-player', 'playing', SLOW)
  await expect(page.locator('#one-year')).toHaveAttribute('data-current', 'true')
  await expect(page.locator('.film-player__caption')).toContainText('In 2024-25', {
    timeout: 20_000,
  })
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('#your-guess')).toHaveAttribute('data-current', 'true')
  await expect(page.locator('.film-canvas canvas')).toHaveCount(0)
})

test('the skip link on the first frame goes to the explorer', async ({ page }) => {
  await page.goto(FILM)

  await page.getByRole('link', { name: 'Skip to the map' }).click()
  await expect(page).toHaveURL(/\/explore$/)
})

test('a returning viewer can watch again or go to the explorer', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('wgw-film-seen', '1'))
  await page.goto(FILM)

  await expect(page.getByRole('button', { name: 'Watch again' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Play the film' })).toBeHidden()
  await page.getByRole('link', { name: 'Explore the map' }).click()
  await expect(page).toHaveURL(/\/explore$/)
})

test('a guess moves by keyboard, locks, and stays on the device', async ({ page }) => {
  const sent: string[] = []
  page.on('request', (request) => {
    if (request.method() !== 'GET') sent.push(request.url())
  })
  await page.goto('/?mode=read')
  const pensioners = page.getByRole('slider', { name: 'Pensioners' })

  await pensioners.focus()
  await page.keyboard.press('PageUp')
  await expect(pensioners).toHaveValue('44')
  await page.getByRole('button', { name: 'Lock in my guess' }).click()

  await expect(page.locator('.film-reveal')).toContainText(
    'You guessed 44%. The real figure is 51.5%.',
  )

  const stored = await page.evaluate(() => window.localStorage.getItem('wgw-film-guess'))
  expect(stored).toContain('"locked":true')
  expect(sent).toEqual([])
})

test('a chapter link opens that chapter, ready to resume', async ({ page }) => {
  await openWatch(page, '/#every-constituency')

  await expect(film(page)).toHaveAttribute('data-player', 'manual', SLOW)
  await page.locator('.film-player__chapters summary').click()
  await expect(page.getByRole('button', { name: '04 Every constituency' })).toHaveAttribute(
    'aria-current',
    'step',
  )
})

test('/film redirects to the home page, keeping its parameters and chapter', async ({ page }) => {
  const response = await page.request.get('/film?mode=read', { maxRedirects: 0 })
  expect(response.status()).toBe(301)
  expect(response.headers()['location']).toMatch(/\/\?mode=read$/)

  await page.goto('/film?mode=read#benefit-by-benefit')
  await expect(page).toHaveURL(/\/\?mode=read#benefit-by-benefit$/)
  await expect(film(page)).toHaveAttribute('data-mode', 'read')
})
