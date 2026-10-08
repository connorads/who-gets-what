import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

/** Fail a test on any console error or failed same-origin request. */
function watch(page: Page): string[] {
  const problems: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text())
  })
  page.on('response', (response) => {
    if (response.url().startsWith('http://127.0.0.1') && response.status() >= 400) {
      problems.push(`${response.status()} ${response.url()}`)
    }
  })
  return problems
}

const AREAS = [
  {
    nation: 'English',
    path: '/area/constituency/E14001063-aldershot',
    name: 'Aldershot',
    text: 'Alex Baker',
  },
  {
    nation: 'Welsh',
    path: '/area/constituency/W07000081-aberafan-maesteg',
    name: 'Aberafan Maesteg',
    text: 'of 10 in Wales',
  },
  {
    nation: 'Scottish',
    path: '/area/local-authority/S12000036-city-of-edinburgh',
    name: 'City of Edinburgh',
    text: 'of 10 in Scotland',
  },
] as const

for (const area of AREAS) {
  test(`${area.nation} area page reads, switches basis and shows its tables`, async ({ page }) => {
    const problems = watch(page)
    const response = await page.goto(area.path)

    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(area.name)
    // Profile text can sit in a closed section, so it need only be on the page.
    await expect(page.getByText(area.text).first()).toBeAttached()
    await expect(page.locator('.dossier-head__lede')).toContainText('than in')

    const headline = page.locator('.glance__value').first()
    const real = await headline.innerText()
    await page.locator('label:has(input[value="nominal"])').first().click()
    await expect(headline).not.toHaveText(real)
    await expect(page.locator('.basis-picker__note').first()).toContainText('cash terms')

    await page.getByText('Show the numbers').first().click()
    await expect(page.locator('table').first()).toBeVisible()
    expect(problems).toEqual([])
  })
}

test('an area page saves its figures as CSV in the chosen basis', async ({ page }) => {
  const problems = watch(page)
  await page.goto('/area/constituency/E14001063-aldershot')
  await page.locator('label:has(input[value="nominal"])').first().click()
  await page.getByText('Every figure, in one table').click()

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download these figures (CSV)' }).click(),
  ])
  const lines = (await readFile(await download.path(), 'utf8')).trimEnd().split('\r\n')

  expect(download.suggestedFilename()).toBe('who-gets-what-e14001063-aldershot-nominal.csv')
  expect(lines[0]).toMatch(/^area_code,area_name,level,measure_id,/)
  expect(lines.length).toBeGreaterThan(20)
  expect(lines[1]).toMatch(/^E14001063,Aldershot,constituency,/)
  expect(lines.some((line) => line.includes('"cash terms, not adjusted for prices"'))).toBe(true)
  await expect(page.locator('[data-download-status]')).toHaveText('Saved.')
  expect(problems).toEqual([])
})

test('without script an area page offers no download button', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto('/area/constituency/E14001063-aldershot')
  await page.getByText('Every figure, in one table').click()

  await expect(page.getByRole('button', { name: 'Download these figures (CSV)' })).toBeHidden()
  await expect(page.getByRole('link', { name: 'Download all the data' })).toBeVisible()
  await context.close()
})

test('the data page serves each table from this site with the checksum it lists', async ({
  page,
}) => {
  await page.goto('/data')
  const table = page.locator('.data-table').filter({ hasText: 'dim_period' })
  await table.getByText('SHA-256 checksums').click()
  const listed = await table
    .locator('.data-hashes div')
    .filter({ hasText: 'dim_period.csv' })
    .locator('code')
    .innerText()

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    table.getByRole('link', { name: 'CSV', exact: true }).click(),
  ])
  const bytes = await readFile(await download.path())

  expect(new URL(download.url()).origin).toBe(new URL(page.url()).origin)
  expect(download.suggestedFilename()).toBe('dim_period.csv')
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(listed)
})

test('a wrong slug redirects to the canonical area page', async ({ page }) => {
  await page.goto('/area/constituency/E14001063-old-name')

  await expect(page).toHaveURL(/\/area\/constituency\/E14001063-aldershot$/)
})

test('the comparison swaps denominators', async ({ page }) => {
  const problems = watch(page)
  const response = await page.goto('/area/constituency/E14001063-aldershot/vs/E14001174-clacton')

  expect(response?.status()).toBe(200)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Aldershot and Clacton')
  await expect(page.locator('[data-measure-panel="group"]')).toBeVisible()
  await page.locator('label:has(input[value="total"])').click()
  await expect(page.locator('[data-measure-panel="total"]')).toBeVisible()
  await expect(page.locator('[data-measure-panel="group"]')).toBeHidden()
  expect(problems).toEqual([])
})

test('a ranking filters by nation and switches level', async ({ page }) => {
  const problems = watch(page)
  await page.goto('/rank/spend-pensioner/per-aged-66-plus')

  const constituencies = page.locator('[data-level-panel="constituency"]')
  await constituencies.getByLabel('Nation').selectOption('scotland')
  await expect(constituencies.locator('[data-filter-count]')).toHaveText('57 shown')
  await constituencies.locator('button[data-sort="name"]').click()
  await expect(constituencies.locator('tbody tr:not([hidden]) th').first()).toHaveText(/^Aberdeen/)

  await page.locator('label:has(input[value="local-authority"])').click()
  await expect(page).toHaveURL(/level=local-authority/)
  await expect(page.locator('[data-level-panel="local-authority"]')).toBeVisible()
  expect(problems).toEqual([])
})

test('the methods page states the rules from the catalogue', async ({ page }) => {
  const problems = watch(page)
  await page.goto('/methods')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('How we worked out the figures')
  await expect(page.getByRole('heading', { level: 2 })).toContainText([
    'Who do we divide by?',
    'How do we adjust for inflation?',
    'Which figures are estimates?',
    'How do we include Scotland?',
    'How do ranks work?',
    'What made spending change?',
    'How do we work out the expected level?',
    'How do we find similar areas?',
  ])
  await expect(page.getByText('V = P × R × A × 52')).toBeVisible()
  expect(problems).toEqual([])
})

test('an embed shows the chart it names and no site chrome', async ({ page }) => {
  await page.goto('/embed/area/constituency/E14001063?chart=neighbours')

  await expect(page.locator('.embed [data-chart="neighbours"]')).toBeVisible()
  await expect(page.locator('.embed [data-chart="spend"]')).toBeHidden()
  await expect(page.locator('.site-header')).toHaveCount(0)
})

test('an unknown page is a 404', async ({ page }) => {
  const response = await page.goto('/area/constituency/E99999999-nowhere')

  expect(response?.status()).toBe(404)
})
