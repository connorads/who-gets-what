import { z } from 'zod/mini'

/**
 * Benefit families group a DWP benefit with its Social Security Scotland
 * replacement, so GB comparisons do not show devolution as a fall in Scotland.
 * Members, administrators and replacement dates live in `meta/benefits.json`.
 */
export const BenefitFamily = z.enum([
  'state-pension',
  'pension-credit',
  'attendance-allowance',
  'winter-fuel',
  'personal-independence',
  'disability-living',
  'carers',
  'universal-credit',
  'housing-benefit',
  'employment-support',
  'jobseekers',
  'income-support',
  'other',
])
export type BenefitFamily = z.infer<typeof BenefitFamily>

/** Source benefit code, e.g. `PIP` (DWP) or `ADP` (Social Security Scotland). */
export const BenefitCode = z
  .string()
  .check(z.regex(/^[A-Z][A-Z0-9_]*$/))
  .brand<'BenefitCode'>()
export type BenefitCode = z.infer<typeof BenefitCode>

export const Administrator = z.enum(['DWP', 'SSS'])
export type Administrator = z.infer<typeof Administrator>
