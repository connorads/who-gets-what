import { readFileSync } from 'node:fs'
import { BUNDLE_FORMAT_VERSION, BUNDLE_MAGIC, type BundleHeader } from '../bundle.ts'
import { parseCatalogue, type Catalogue } from '../contract.ts'

const FIXTURES = new URL('../../../contract/fixtures/', import.meta.url)

/** Contract fixture shared with the pipeline's tests, parsed as plain JSON. */
export function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(name, FIXTURES), 'utf8'))
}

export function fixtureCatalogue(): Catalogue {
  const parsed = parseCatalogue(readFixture('catalogue.json'))
  if (!parsed.ok) throw new Error(parsed.error.problems.join('\n'))
  return parsed.value
}

/**
 * Reference encoder for the bundle format. Tests use it to build bundles; the
 * pipeline's writer must agree with it byte for byte outside the header.
 */
export function encodeBundle(
  header: BundleHeader,
  sections: readonly (Float32Array | Uint8Array | Uint16Array | Uint32Array)[],
): ArrayBuffer {
  const headerBytes = new TextEncoder().encode(JSON.stringify(header))
  const offsets: number[] = []
  let end = 12 + headerBytes.byteLength
  for (const section of sections) {
    const start = Math.ceil(end / 4) * 4
    offsets.push(start)
    end = start + section.byteLength
  }
  const buffer = new ArrayBuffer(end)
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  bytes.set(new TextEncoder().encode(BUNDLE_MAGIC), 0)
  view.setUint16(4, BUNDLE_FORMAT_VERSION, true)
  view.setUint16(6, 0, true)
  view.setUint32(8, headerBytes.byteLength, true)
  bytes.set(headerBytes, 12)
  sections.forEach((section, i) => {
    bytes.set(new Uint8Array(section.buffer, section.byteOffset, section.byteLength), offsets[i])
  })
  return buffer
}

export function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
