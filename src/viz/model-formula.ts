/**
 * The modelled-spending formula written out from a published fit, so the
 * "Explained by age" chart shows every coefficient it uses (critique: publish
 * the formula beside the residual view).
 */

export interface FitTerm {
  readonly id: string
  readonly label: string
  readonly coefficient: number
}

const SHORT_LABEL: Readonly<Record<string, string>> = {
  'share-aged-0-15': 'share aged 0 to 15',
  'share-aged-66-plus': 'share aged 66 and over',
  'deprivation-decile': 'deprivation decile',
  'log-median-pay': 'ln(median pay)',
  'nation-wales': 'Wales',
  'nation-scotland': 'Scotland',
}

const number = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 })

const magnitude = (value: number): string => {
  const abs = Math.abs(value)
  return abs > 0 && abs < 1
    ? abs.toLocaleString('en-GB', { maximumSignificantDigits: 2 })
    : number.format(abs)
}

export interface FormulaPart {
  readonly sign: '+' | '−' | ''
  readonly text: string
}

/** Terms in design order as signed parts: `£−880`, `+ 9,950 × share aged 66 and over`, … */
export function formulaParts(terms: readonly FitTerm[]): readonly FormulaPart[] {
  return terms.map((term, i) => {
    const sign = term.coefficient < 0 ? '−' : i === 0 ? '' : '+'
    const label = SHORT_LABEL[term.id] ?? term.label
    const value = magnitude(term.coefficient)
    return {
      sign,
      text: term.id === 'intercept' ? `£${value}` : `£${value} × ${label}`,
    }
  })
}

export function formulaText(terms: readonly FitTerm[]): string {
  return formulaParts(terms)
    .map((part, i) =>
      i === 0 ? `${part.sign === '−' ? '−' : ''}${part.text}` : `${part.sign} ${part.text}`,
    )
    .join(' ')
}
