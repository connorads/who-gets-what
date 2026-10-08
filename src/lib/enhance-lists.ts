/**
 * Behaviour for pages with long lists: sortable and filterable tables
 * (rankings), the area name filter and the postcode lookup. `enhance` loads
 * this module only on pages that have one, so dossiers do not download it.
 */
import { all } from './dom.ts'

function filterRows(scope: HTMLElement): void {
  const filters = all(scope, 'select[data-filter]', HTMLSelectElement)
  let shown = 0
  for (const row of all(scope, 'tbody tr', HTMLTableRowElement)) {
    const visible = filters.every((filter) => {
      const key = filter.dataset['filter'] ?? ''
      return filter.value === '' || row.dataset[key] === filter.value
    })
    row.hidden = !visible
    if (visible) shown += 1
  }
  const count = scope.querySelector<HTMLElement>('[data-filter-count]')
  if (count !== null) count.textContent = `${shown.toLocaleString('en-GB')} shown`
}

function sortRows(button: HTMLElement): void {
  const table = button.closest<HTMLTableElement>('table')
  const body = table?.tBodies[0]
  const key = button.dataset['sort']
  const header = button.closest<HTMLElement>('th')
  if (table == null || body === undefined || key === undefined || header === null) return
  const descending = header.getAttribute('aria-sort') === 'ascending'
  for (const th of all(table, 'th[aria-sort]', HTMLTableCellElement)) {
    th.removeAttribute('aria-sort')
  }
  header.setAttribute('aria-sort', descending ? 'descending' : 'ascending')
  const value = (row: HTMLTableRowElement) =>
    key === 'name' ? (row.querySelector('th')?.textContent ?? '') : (row.dataset[key] ?? '')
  const rows = Array.from(body.rows).toSorted((a, b) => {
    const x = value(a)
    const y = value(b)
    const order =
      key === 'name'
        ? x.localeCompare(y, 'en-GB')
        : (x === '' ? Infinity : Number(x)) - (y === '' ? Infinity : Number(y))
    return descending ? -order : order
  })
  for (const row of rows) body.appendChild(row)
}

function search(input: HTMLInputElement): void {
  const scope = input.closest<HTMLElement>('[data-search-scope]')
  if (scope === null) return
  const query = input.value.trim().toLowerCase()
  let shown = 0
  for (const item of all(scope, '[data-name]', HTMLElement)) {
    const visible = query === '' || (item.dataset['name'] ?? '').includes(query)
    item.hidden = !visible
    if (visible) shown += 1
  }
  for (const group of all(scope, '[data-search-group]', HTMLElement)) {
    group.hidden = group.querySelector('[data-name]:not([hidden])') === null
  }
  const count = scope.querySelector<HTMLElement>('[data-search-count]')
  if (count !== null) {
    count.textContent =
      query === '' ? '' : `${shown} ${shown === 1 ? 'area matches' : 'areas match'}.`
  }
}

const field = (body: unknown, key: string): unknown =>
  typeof body === 'object' && body !== null ? Reflect.get(body, key) : undefined

const POSTCODE_LEVELS = ['parliamentary_constituency_2024', 'admin_district'] as const

async function lookupPostcode(form: HTMLFormElement, root: HTMLElement): Promise<void> {
  const input = form.elements.namedItem('postcode')
  const status = form.querySelector<HTMLElement>('[data-postcode-status]')
  if (!(input instanceof HTMLInputElement) || status === null) return
  const say = (...parts: (string | Node)[]) => status.replaceChildren(...parts)
  const postcode = input.value.trim()
  if (postcode === '') return say('Enter a postcode.')
  say('Looking up…')
  try {
    const response = await fetch(
      `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`,
    )
    const result = response.ok ? field(await response.json(), 'result') : undefined
    if (result === undefined) return say(`No postcode ${postcode.toUpperCase()} was found.`)
    if (field(result, 'country') === 'Northern Ireland') {
      return say('Northern Ireland is not covered: its benefits are run by its own department.')
    }
    const named = field(result, 'postcode')
    const found = typeof named === 'string' ? named : postcode.toUpperCase()
    const codes = field(result, 'codes')
    const links = POSTCODE_LEVELS.flatMap((key) => {
      const code = field(codes, key)
      if (typeof code !== 'string') return []
      const link = root.querySelector<HTMLElement>(`[data-code="${CSS.escape(code)}"] a`)
      return link instanceof HTMLAnchorElement ? [link] : []
    })
    if (links.length === 0) return say(`No area page covers ${found}.`)
    say(
      `${found} is in `,
      ...links.flatMap((link, i) => {
        const anchor = document.createElement('a')
        anchor.href = link.href
        anchor.textContent = link.textContent
        const level = link.closest<HTMLElement>('[data-level-label]')?.dataset['levelLabel'] ?? ''
        return [i > 0 ? ' and ' : '', anchor, level === '' ? '' : ` (${level})`]
      }),
      '.',
    )
  } catch {
    say('The postcode service did not answer. Search by name instead.')
  }
}

export function wireLists(root: HTMLElement, signal: AbortSignal): void {
  root.addEventListener(
    'change',
    (event) => {
      const target = event.target
      if (target instanceof HTMLSelectElement && target.dataset['filter'] !== undefined) {
        const scope = target.closest<HTMLElement>('[data-table-scope]')
        if (scope !== null) filterRows(scope)
      }
    },
    { signal },
  )
  root.addEventListener(
    'click',
    (event) => {
      if (!(event.target instanceof HTMLElement)) return
      const button = event.target.closest<HTMLElement>('[data-sort]')
      if (button !== null) sortRows(button)
    },
    { signal },
  )
  root.addEventListener(
    'input',
    (event) => {
      const target = event.target
      if (target instanceof HTMLInputElement && target.dataset['areaSearch'] !== undefined) {
        search(target)
      }
    },
    { signal },
  )
  root.addEventListener(
    'submit',
    (event) => {
      const target = event.target
      if (target instanceof HTMLFormElement && target.dataset['postcode'] !== undefined) {
        event.preventDefault()
        void lookupPostcode(target, root)
      }
    },
    { signal },
  )
}
