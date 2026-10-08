/**
 * Words and phrases that generated and editorial copy never uses. The banned
 * list (ADR 0004) judges rather than describes; the style list is metaphor
 * and filler that an ordinary reader would not say. A page, template,
 * catalogue label or caveat that contains one fails its test. The lists live
 * in `contract/neutrality/`, and the pipeline's tests also read the banned one.
 */
import bannedWords from '../../contract/neutrality/banned-words.json' with { type: 'json' }
import styleWords from '../../contract/neutrality/style-words.json' with { type: 'json' }

export const BANNED_PHRASES: readonly string[] = bannedWords.phrases
export const STYLE_PHRASES: readonly string[] = styleWords.phrases

const escape = (phrase: string): string => phrase.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')

const wholeWords = (phrases: readonly string[]): RegExp =>
  new RegExp(`(?<![\\p{L}\\p{N}'-])(?:${phrases.map(escape).join('|')})(?![\\p{L}\\p{N}'-])`, 'giu')

const BANNED = wholeWords(BANNED_PHRASES)
const STYLE = wholeWords(STYLE_PHRASES)

const find = (pattern: RegExp, text: string): string[] => {
  const normalised = text.replaceAll(/[‘’]/g, "'").replaceAll(/\s+/g, ' ')
  return Array.from(normalised.matchAll(pattern), (match) => match[0].toLowerCase())
}

/** Every banned phrase in `text`, matched case-insensitively as whole words, in order. */
export function findBannedPhrases(text: string): string[] {
  return find(BANNED, text)
}

/** Every style-list phrase in `text`, matched the same way. */
export function findStylePhrases(text: string): string[] {
  return find(STYLE, text)
}
