/**
 * Behaviour for server-rendered data pages, wired by delegation on the page
 * root. Every control works from `data-*` attributes in the markup, so pages
 * ship this one small module instead of their own components. Without script
 * the pages still read: tables are complete and the basis switch is CSS.
 * Pages with long lists load `enhance-lists.ts` on demand.
 */
import { all } from './dom.ts'

const BASIS_KEY = 'wgw-basis'
const LISTS = '[data-sort], [data-filter], [data-area-search], [data-postcode]'

function store(key: string, value?: string): string | null {
  try {
    if (value !== undefined) localStorage.setItem(key, value)
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function restore(root: HTMLElement): void {
  const choices = [
    ['basis', store(BASIS_KEY)],
    ['level', new URLSearchParams(location.search).get('level')],
  ] as const
  for (const [name, value] of choices) {
    const options = all(root, `input[name="${name}"]`, HTMLInputElement)
    if (value !== null && options.some((input) => input.value === value)) {
      for (const input of options) input.checked = input.value === value
    }
  }
}

async function copy(button: HTMLElement, root: HTMLElement): Promise<void> {
  const scope = button.closest<HTMLElement>('[data-embed]') ?? root
  const source = scope.querySelector<HTMLElement>(button.dataset['copy'] ?? '')
  const status = scope.querySelector<HTMLElement>('[data-copy-status]')
  const text = source instanceof HTMLTextAreaElement ? source.value : (source?.textContent ?? '')
  try {
    await navigator.clipboard.writeText(text)
    if (status !== null) status.textContent = 'Copied.'
  } catch {
    if (source instanceof HTMLTextAreaElement) source.select()
    if (status !== null) status.textContent = 'Select the code and copy it.'
  }
}

export function enhance(root: HTMLElement): () => void {
  const controller = new AbortController()
  const { signal } = controller
  restore(root)
  // Script-only controls stay hidden in the markup until script can run them.
  for (const control of all(root, '[data-download-area]', HTMLElement)) control.hidden = false
  if (root.querySelector(LISTS) !== null) {
    void import('./enhance-lists.ts').then(({ wireLists }) => {
      if (!signal.aborted) wireLists(root, signal)
    })
  }

  root.addEventListener(
    'change',
    (event) => {
      const target = event.target
      if (target instanceof HTMLInputElement && target.name === 'basis') {
        store(BASIS_KEY, target.value)
      }
      if (target instanceof HTMLInputElement && target.name === 'level') {
        const url = new URL(location.href)
        if (target.value === 'constituency') url.searchParams.delete('level')
        else url.searchParams.set('level', target.value)
        history.replaceState(history.state, '', url)
      }
      if (target instanceof HTMLSelectElement && target.dataset['embedChart'] !== undefined) {
        const area = target.closest<HTMLElement>('[data-embed]')?.querySelector('textarea')
        if (area != null) area.value = target.selectedOptions[0]?.dataset['code'] ?? ''
      }
    },
    { signal },
  )

  root.addEventListener(
    'click',
    (event) => {
      if (!(event.target instanceof HTMLElement)) return
      const button = event.target.closest<HTMLElement>('[data-copy]')
      if (button !== null) void copy(button, root)
      const download = event.target.closest<HTMLElement>('[data-download-area]')
      if (download !== null && download.getAttribute('aria-disabled') !== 'true') {
        void import('./area-download.ts').then(({ downloadArea }) => downloadArea(download, root))
      }
    },
    { signal },
  )

  return () => controller.abort()
}
