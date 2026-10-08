import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

/** A string field of parsed JSON, or an empty string. */
function text(value: unknown, key: string): string {
  const field: unknown =
    typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
  return typeof field === 'string' ? field : ''
}

const release = text(JSON.parse(readFileSync('data.lock.json', 'utf8')), 'release')

const leaders = (page: Page) => page.getByTestId('leaders')

async function topTen(page: Page): Promise<readonly string[]> {
  return leaders(page)
    .getByRole('region', { name: 'Highest 10' })
    .locator('.leader-name')
    .allTextContents()
}

test('server renders the default state as SVG, lists and a table', async ({ page }) => {
  await page.goto('/explore')

  await expect(page.getByRole('heading', { level: 1 })).toContainText('has the highest')
  await expect(page.locator('.stage-svg')).toBeVisible()
  await expect(page.locator('table.area-table tbody tr')).toHaveCount(50)
  expect(await topTen(page)).toHaveLength(10)

  await page.getByRole('button', { name: 'Show all 632 constituencies' }).click()
  await expect(page.locator('table.area-table tbody tr')).toHaveCount(632)
})

test('without JavaScript the default view is the real map, with London again in an inset', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto('/explore')

  await expect(page.locator('.stage')).toHaveAttribute('data-view', 'map')
  const sprite = `/data/${release}/layout/constituency/map.svg#a`
  // Every constituency once on the map, and London's 75 again in the inset.
  await expect(page.locator(`.stage-svg use[href^="${sprite}"][fill^="var(--"]`)).toHaveCount(
    632 + 75,
  )
  await expect(page.locator('.stage-svg text', { hasText: 'London' })).toBeVisible()
  await page.locator('.refine > summary').click()
  await expect(page.getByRole('group', { name: 'Chart' }).getByRole('link')).toHaveText([
    /Map/,
    /Equal-size areas/,
    /Dots by age/,
    /Ranked list/,
  ])
  await context.close()
})

test('a constituency picked in the London inset is selected', async ({ page }) => {
  const meta: unknown = await (
    await page.request.get(`/data/${release}/meta/areas-constituency.json`)
  ).json()
  const areas: unknown = typeof meta === 'object' && meta !== null ? Reflect.get(meta, 'areas') : []
  const london = new Set(
    (Array.isArray(areas) ? areas : [])
      .filter((area) => text(area, 'region') === 'E12000007')
      .map((area) => text(area, 'code')),
  )
  expect(london.size).toBe(75)
  await page.goto('/explore')
  await expect(page.locator('.stage')).toHaveAttribute('data-engine', 'ready', { timeout: 30_000 })
  const inset = page.getByTestId('stage-inset')
  await expect(inset).toBeVisible({ timeout: 10_000 })
  await inset.scrollIntoViewIfNeeded()
  const box = await inset.boundingBox()
  if (box === null) throw new Error('the inset has no box')

  // North of the Thames, which runs through the middle of the inset. The canvas
  // ignores the pointer while marks move, so the hover repeats until it lands.
  const x = box.x + box.width * 0.5
  const y = box.y + box.height * 0.3
  await expect(async () => {
    await page.mouse.move(x - 2, y)
    await page.mouse.move(x, y)
    await expect(page.locator('.stage-tooltip')).toBeVisible({ timeout: 500 })
  }).toPass({ timeout: 15_000 })
  await page.mouse.click(x, y)

  await expect(page).toHaveURL(/[?&]sel=E14\d{6}/)
  const code = new URL(page.url()).searchParams.get('sel') ?? ''
  expect(london.has(code)).toBe(true)
})

test('the 3D skyline rises on the real map and settles flat', async ({ page }) => {
  // SwiftShader draws the rising extrusion at about 4 frames a second, so the
  // rise holds the main thread for about 25 s and a click waits for it.
  test.slow()
  await page.goto('/explore?view=hex')
  await expect(page.locator('.stage')).toHaveAttribute('data-engine', 'ready', { timeout: 30_000 })
  const toggle = page.getByTestId('skyline-toggle')

  await toggle.click()
  // The skyline stands on the map, so the equal-size view gives way to it.
  await expect(page).not.toHaveURL(/view=hex/)
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('skyline-key')).toContainText('Height from zero')
  await expect(page.getByTestId('skyline-key')).toContainText('London')

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('skyline-key')).toHaveCount(0)
})

test('councils have no equal-size view, and a link asking for one opens the map', async ({
  page,
}) => {
  await page.goto('/explore?level=local-authority&view=hex')

  await expect(page.locator('.stage')).toHaveAttribute('data-view', 'map')
  await page.locator('.refine > summary').click()
  await expect(page.getByRole('group', { name: 'Chart' }).getByRole('link')).toHaveText([
    /Map/,
    /Dots by age/,
    /Ranked list/,
  ])
})

test('the server renders the state a shared link names', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto('/explore?level=local-authority&view=rank')

  await expect(page.locator('.stage')).toHaveAttribute('data-view', 'rank')
  await expect(page.locator('table.area-table tbody tr')).toHaveCount(50)
  // Without JavaScript the full ranking is a league table page away.
  await expect(
    page.getByRole('link', { name: /League table of every local authority/ }),
  ).toHaveAttribute('href', /^\/rank\/[^/]+\/[^/?]+\?level=local-authority$/)
  await context.close()
})

test('a denominator change updates the URL, the canvas and the top ten', async ({ page }) => {
  await page.goto('/explore')
  await expect(page.locator('.stage')).toHaveAttribute('data-engine', 'ready', { timeout: 20_000 })
  const before = await topTen(page)

  await page.locator('.refine > summary').click()
  await page.getByRole('group', { name: 'Count' }).getByRole('link', { name: 'Total' }).click()

  await expect(page).toHaveURL(/[?&]denom=total(?:&|$)/)
  // Four rulers: the list re-sorts last, after the dots and the bump lines.
  await expect(leaders(page)).toHaveAttribute('data-denominator', 'total')
  const after = await topTen(page)
  expect(after).toHaveLength(10)
  expect(after).not.toEqual(before)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('has the highest total')
})

test('keyboard readers move through areas and hear each value and rank', async ({ page }) => {
  await page.goto('/explore?view=rank')
  const navigator = page.getByRole('list', { name: /in rank order/ })
  await expect(navigator).toBeAttached()

  await navigator.getByRole('button').first().focus()
  await page.keyboard.press('ArrowDown')

  await expect(page.getByTestId('stage-announcer')).toContainText(/2nd of 631 constituencies/)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/[?&]sel=[EWS]\d{8}/)
  // A selection re-runs the loader; with the whole suite in parallel on a software GPU it can take over 5 s.
  await expect(page.getByTestId('selected-value')).not.toHaveText('No value', { timeout: 15_000 })
})

test('download this view saves a CSV of every area', async ({ page }) => {
  await page.goto('/explore?level=local-authority&denom=total&basis=nominal')

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download this view (CSV)' }).click(),
  ])
  const lines = (await readFile(await download.path(), 'utf8')).trimEnd().split('\r\n')

  expect(download.suggestedFilename()).toMatch(
    /^who-gets-what-local-authority-[a-z-]+-total-[\d-]+-nominal\.csv$/,
  )
  expect(lines[0]).toMatch(/^area_code,area_name,level,measure_id,/)
  expect(lines).toHaveLength(351)
  expect(lines[1]).toContain(',"cash terms, not adjusted for prices",')
})
