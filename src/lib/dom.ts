/**
 * Typed DOM lookups for the page enhancers. They name `HTMLElement` types
 * explicitly: the Workers types in `worker-configuration.d.ts` declare their
 * own global `Element`.
 */
export const all = <T>(root: HTMLElement, selector: string, type: abstract new () => T) =>
  Array.from(root.querySelectorAll<HTMLElement>(selector)).flatMap((node) =>
    node instanceof type ? [node] : [],
  )
