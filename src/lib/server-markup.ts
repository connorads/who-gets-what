import { createSerializationAdapter } from '@tanstack/react-router'

/**
 * Page markup a server function rendered. A route loader wraps the string in
 * this class so it reaches the browser once, as HTML: the adapter below
 * dehydrates it as empty, and `StaticMarkup` keeps the server's DOM on
 * hydration. A client-side navigation calls the server function and gets the
 * markup as a plain string.
 */
export class ServerMarkup {
  readonly html: string
  constructor(html: string) {
    this.html = html
  }
}

export const serverMarkupAdapter = createSerializationAdapter({
  key: 'server-markup',
  test: (value): value is ServerMarkup => value instanceof ServerMarkup,
  toSerializable: () => '',
  fromSerializable: () => new ServerMarkup(''),
})
