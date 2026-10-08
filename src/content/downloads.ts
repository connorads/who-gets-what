/**
 * What each download table holds, column by column, for the data page. A
 * test checks every column here against the CSV headers of the pinned
 * release, so the dictionary cannot drift from the files.
 */

export type ColumnType = 'text' | 'integer' | 'number' | 'list'

export interface Column {
  readonly name: string
  readonly type: ColumnType
  readonly description: string
}

export interface TableDictionary {
  readonly description: string
  readonly columns: readonly Column[]
}

const col = (name: string, type: ColumnType, description: string): Column => ({
  name,
  type,
  description,
})

const LEVEL = col('level', 'text', 'constituency or local-authority.')
const CODE = col('code', 'text', 'GSS code of the area (PCON24 or LAD23).')
const FLAGS = col(
  'flags',
  'integer',
  'Value flags as a bit field: 1 apportioned, 2 modelled, 4 survey, 8 suppressed, 16 partial coverage, 32 harmonised, 64 small population, 128 series break.',
)
const SOURCE = col('source', 'text', 'Source id; the sources table on this page names each one.')
const METHOD = col('method', 'text', 'measured, apportioned or modelled.')

export const DOWNLOAD_TABLES: Readonly<Record<string, TableDictionary>> = {
  dim_area: {
    description:
      'Every area: code, name, level, boundary set, centroid, land area, nation, region and hex position.',
    columns: [
      LEVEL,
      col('code', 'text', 'GSS code of the area.'),
      col('name', 'text', 'Area name.'),
      col('boundary_set', 'text', 'PCON24 for constituencies, LAD23 for local authorities.'),
      col('lon', 'number', 'Longitude of the centroid, WGS84.'),
      col('lat', 'number', 'Latitude of the centroid, WGS84.'),
      col('area_km2', 'number', 'Land area in square kilometres.'),
      col('nation', 'text', 'england, wales or scotland.'),
      col('region_code', 'text', 'GSS code of the region or nation.'),
      col('hex_q', 'integer', 'Hex map column (Open Innovations layout, odd-r).'),
      col('hex_r', 'integer', 'Hex map row (Open Innovations layout, odd-r).'),
      col('population', 'integer', 'Residents at the latest mid-year estimate.'),
      col('region_name', 'text', 'Name of the region or nation.'),
      col('slug', 'text', 'URL name of the area page.'),
    ],
  },
  dim_benefit: {
    description: 'Benefit codes, labels, families and the years each one counts.',
    columns: [
      col('code', 'text', 'Benefit code.'),
      col('label', 'text', 'Benefit name.'),
      col(
        'family',
        'text',
        'Benefit family that pairs a DWP benefit with its Scottish replacement.',
      ),
      col('parent_code', 'text', 'Code of the benefit this one is a part of, if any.'),
      col('administrator', 'text', 'DWP or SSS (Social Security Scotland).'),
      col('nations', 'list', 'Nations the benefit is paid in.'),
      col('from_fy', 'text', 'First fiscal year counted, if it starts within the series.'),
      col('to_fy', 'text', 'Last fiscal year counted, if it ends within the series.'),
      col(
        'devolved_from_fy',
        'text',
        'Fiscal year from which Scotland counts the replacement instead.',
      ),
    ],
  },
  dim_period: {
    description: 'Fiscal years with GDP deflator and CPI price factors.',
    columns: [
      col('fiscal_year', 'text', 'Fiscal year, April to March, as 2024-25.'),
      col('status', 'text', 'outturn or forecast.'),
      col('gdp_deflator', 'number', 'HM Treasury GDP deflator index.'),
      col('cpi', 'number', 'ONS CPI index, mean of the months published for the year.'),
      col('cpi_months', 'integer', 'Months of CPI in that mean.'),
      col('real_gdp', 'number', 'Multiplier from cash to the price base year, by GDP deflator.'),
      col('real_cpi', 'number', 'Multiplier from cash to the price base year, by CPI.'),
    ],
  },
  dim_representation: {
    description:
      'Constituency Members of Parliament: member, party as text and date first elected.',
    columns: [
      col('code', 'text', 'GSS code of the constituency.'),
      col('member', 'text', 'Member of Parliament.'),
      col('party', 'text', 'Party, as text.'),
      col('since', 'text', 'Date the member first held the seat, ISO 8601.'),
    ],
  },
  bridge_area_overlap: {
    description: 'Population shares between constituencies and local authorities.',
    columns: [
      col('constituency', 'text', 'GSS code of the constituency.'),
      col('local_authority', 'text', 'GSS code of the local authority.'),
      col('population', 'number', 'Residents in both areas.'),
      col(
        'share_of_constituency',
        'number',
        'Those residents as a share of the constituency, 0 to 1.',
      ),
      col(
        'share_of_local_authority',
        'number',
        'Those residents as a share of the local authority, 0 to 1.',
      ),
    ],
  },
  fact_spend_area: {
    description: 'Spending by area, fiscal year and benefit, in cash pounds, with flags.',
    columns: [
      LEVEL,
      CODE,
      col('fiscal_year', 'text', 'Fiscal year, as 2024-25.'),
      col('benefit_code', 'text', 'Benefit code (dim_benefit).'),
      col('family', 'text', 'Benefit family.'),
      col('value_gbp', 'number', 'Spending in cash pounds, not adjusted for prices.'),
      FLAGS,
      METHOD,
      SOURCE,
    ],
  },
  fact_caseload_area: {
    description: 'Claimants and mean awards by area, benefit and month, with flags.',
    columns: [
      LEVEL,
      CODE,
      col('month', 'text', 'Snapshot month, as 2026-03.'),
      col('benefit_code', 'text', 'Benefit code (dim_benefit).'),
      col('caseload', 'number', 'People receiving the benefit.'),
      col('mean_weekly_gbp', 'number', 'Mean weekly award in cash pounds, where published.'),
      FLAGS,
      METHOD,
      SOURCE,
      col('family', 'text', 'Benefit family.'),
    ],
  },
  fact_population: {
    description: 'Mid-year population by area and age band.',
    columns: [
      LEVEL,
      CODE,
      col('mid_year', 'integer', 'Year of the mid-year (30 June) estimate.'),
      col('total', 'integer', 'All residents.'),
      col('aged_0_15', 'integer', 'Residents aged 0 to 15.'),
      col('aged_16_64', 'integer', 'Residents aged 16 to 64.'),
      col('aged_66_plus', 'integer', 'Residents aged 66 and over.'),
      SOURCE,
    ],
  },
  fact_tax_area: {
    description: 'Income tax paid by residents by area and fiscal year (HMRC survey estimates).',
    columns: [
      LEVEL,
      CODE,
      col('fiscal_year', 'text', 'Fiscal year, as 2023-24.'),
      col('income_tax_gbp', 'number', 'Income tax only, cash pounds, survey estimate.'),
      col('taxpayers', 'number', 'Income taxpayers, survey estimate.'),
      FLAGS,
      SOURCE,
    ],
  },
  fact_context: {
    description: 'Deprivation deciles within each nation, median pay and other area context.',
    columns: [
      LEVEL,
      CODE,
      col('indicator', 'text', 'What the value measures, such as deprivation-decile.'),
      col('period', 'text', 'Edition or period of the indicator.'),
      col(
        'value',
        'number',
        'The value; deprivation ranks and deciles compare areas within one nation only.',
      ),
      SOURCE,
    ],
  },
  fact_election_2024: {
    description:
      'General election of 4 July 2024 by constituency: every candidate, party as text, votes, electorate and majority.',
    columns: [
      col('constituency', 'text', 'GSS code of the constituency.'),
      col('polling_date', 'text', 'Polling day, ISO 8601.'),
      col('electorate', 'integer', 'Registered electors.'),
      col('valid_votes', 'integer', 'Valid votes cast.'),
      col('invalid_votes', 'integer', 'Rejected ballots.'),
      col('position', 'integer', 'Finishing position, 1 for the winner.'),
      col('candidate', 'text', 'Candidate name.'),
      col('party', 'text', 'Party, as text.'),
      col('votes', 'integer', 'Votes for the candidate.'),
      col('vote_share', 'number', 'Votes over valid votes, 0 to 1.'),
      col('majority', 'number', "Winning margin in votes, on the winner's row only."),
    ],
  },
  fact_pip_condition: {
    description:
      'Personal Independence Payment claimants by main disabling condition group, by area and for England and Wales, at the latest month.',
    columns: [
      LEVEL,
      CODE,
      col('month', 'text', 'Snapshot month, as 2026-07.'),
      col('condition', 'text', 'Condition group id.'),
      col('condition_label', 'text', 'Condition group name.'),
      col('claimants', 'integer', 'Claimants in the group; empty where withheld.'),
      FLAGS,
      SOURCE,
    ],
  },
}

export interface DownloadFile {
  readonly path: string
  /** The canonical table, such as `fact_spend_area`. */
  readonly table: string
  /** The split a CSV covers, such as `constituency-2024-25`; empty for a whole table. */
  readonly part: string
  readonly format: 'CSV' | 'Parquet'
  readonly bytes: number
  readonly sha256: string
}

type ManifestFiles = Readonly<Record<string, { readonly bytes: number; readonly sha256: string }>>

/** The pipeline's archive of every table file; releases before it was added have none. */
export const ARCHIVE = 'downloads/all-tables.zip'

/** The archive's size and checksum, when the release has one. */
export function archiveFile(
  files: ManifestFiles,
): { readonly path: string; readonly bytes: number; readonly sha256: string } | undefined {
  const file = files[ARCHIVE]
  return file === undefined ? undefined : { path: ARCHIVE, ...file }
}

/** Table files from a manifest's file list, sorted by table, part and format. */
export function downloadFiles(files: ManifestFiles): readonly DownloadFile[] {
  return Object.entries(files)
    .filter(([path]) => path.startsWith('downloads/') && path !== ARCHIVE)
    .map(([path, file]): DownloadFile => {
      const name = path.slice('downloads/'.length)
      const dot = name.lastIndexOf('.')
      const stem = name.slice(0, dot)
      const extension = name.slice(dot + 1)
      const dash = stem.indexOf('-')
      return {
        path,
        table: dash === -1 ? stem : stem.slice(0, dash),
        part: dash === -1 ? '' : stem.slice(dash + 1),
        format: extension === 'parquet' ? 'Parquet' : 'CSV',
        bytes: file.bytes,
        sha256: file.sha256,
      }
    })
    .toSorted(
      (a, b) =>
        a.table.localeCompare(b.table) ||
        a.part.localeCompare(b.part) ||
        a.format.localeCompare(b.format),
    )
}
