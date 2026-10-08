import { createStart } from '@tanstack/react-start'
import { serverMarkupAdapter } from './lib/server-markup.ts'

export const startInstance = createStart(() => ({
  serializationAdapters: [serverMarkupAdapter],
}))
