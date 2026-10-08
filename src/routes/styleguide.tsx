import { createFileRoute } from '@tanstack/react-router'
import { ChevronDownIcon } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { PageHeader } from '#/components/PageHeader'
import { Monogram, Wordmark } from '#/components/Wordmark'
import { Badge } from '#/components/ui/badge.tsx'
import { Button } from '#/components/ui/button.tsx'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '#/components/ui/command.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu.tsx'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select.tsx'
import { Separator } from '#/components/ui/separator.tsx'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '#/components/ui/sheet.tsx'
import { Slider } from '#/components/ui/slider.tsx'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table.tsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs.tsx'
import { ToggleGroup, ToggleGroupItem } from '#/components/ui/toggle-group.tsx'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '#/components/ui/tooltip.tsx'
import { contrastRatio } from '#/design/contrast.ts'
import {
  SURFACE_TOKENS,
  TEXT_TOKENS,
  readColourTokens,
  type ThemedColour,
} from '#/design/tokens.ts'
import { BenefitFamily } from '#/domain/benefit.ts'
import { pageTitle } from '#/lib/site.ts'
import css from '../styles.css?raw'

export const Route = createFileRoute('/styleguide')({
  head: () => ({
    meta: [{ title: pageTitle('Styleguide') }, { name: 'robots', content: 'noindex, nofollow' }],
  }),
  component: Styleguide,
})

const TOKENS = readColourTokens(css)

function token(name: string): ThemedColour {
  return TOKENS.get(name) ?? { light: '#000000', dark: '#000000' }
}

const FAMILY_LABEL: Record<BenefitFamily, string> = {
  'state-pension': 'State Pension',
  'pension-credit': 'Pension Credit',
  'attendance-allowance': 'Attendance Allowance and PADP',
  'winter-fuel': 'Winter Fuel and PAWHP',
  'personal-independence': 'PIP and ADP',
  'disability-living': 'DLA and CDP',
  carers: "Carer's Allowance and CSP",
  'universal-credit': 'Universal Credit',
  'housing-benefit': 'Housing Benefit',
  'employment-support': 'ESA',
  jobseekers: "Jobseeker's Allowance",
  'income-support': 'Income Support',
  other: 'Other',
}

const MOTION = [
  ['--dur-chip', '90 ms', 'Chips, toggles, link underlines'],
  ['--dur-row', '180 ms', 'Table rows, list re-sorts'],
  ['--dur-panel', '300 ms', 'Panels and sheets'],
  ['--dur-morph', '600 ms', 'Explorer view morphs, the ceiling'],
  ['--dur-film', '1.8 s', 'Film camera moves (1.6 to 2.0 s)'],
  ['--dur-fade', '120 ms', 'Cross-fades that replace motion when reduced'],
] as const

const RANKED = [
  ['First area', '1', '£0,000'],
  ['Second area', '2', '£0,000'],
  ['Third area', '3', '£0,000'],
] as const

function Styleguide() {
  return (
    <TooltipProvider delayDuration={200}>
      <PageHeader kicker="Styleguide · not indexed" title="Colours, type and page parts">
        <p>
          Tokens, type and components for Who Gets What. Every colour below is read from{' '}
          <code className="font-mono text-sm">src/styles.css</code>, so the ratios are the ones the
          browser renders.
        </p>
      </PageHeader>

      <Section kicker="01" title="Identity">
        <div className="flex flex-wrap items-center gap-10">
          <Wordmark />
          <Monogram className="size-16 text-ink" />
          <div className="max-w-sm text-sm text-ink-muted">
            Gold marks benefit spending. Grey marks income tax. Terracotta marks the buttons and
            links you can use.
          </div>
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <MetalCard
            name="Gold"
            hex="#c9a35e"
            meaning="Benefit spending and people receiving benefits"
          />
          <MetalCard name="Grey" hex="#9c9aae" meaning="Income tax" />
        </div>
      </Section>

      <Section kicker="02" title="Text on surfaces">
        <p className="mb-6 max-w-prose text-sm text-ink-muted">
          Contrast for each text token on each surface, in both themes. WCAG 2.2 AA needs 4.5:1.
        </p>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Token</TableHead>
                {SURFACE_TOKENS.map((s) => (
                  <TableHead key={s} className="text-right">
                    on {s}, light
                  </TableHead>
                ))}
                {SURFACE_TOKENS.map((s) => (
                  <TableHead key={`${s}-dark`} className="text-right">
                    on {s}, dark
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {TEXT_TOKENS.map((t) => (
                <TableRow key={t}>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <Chip colour={token(t)} />
                      <code className="font-mono text-xs">--{t}</code>
                    </span>
                  </TableCell>
                  {(['light', 'dark'] as const).flatMap((theme) =>
                    SURFACE_TOKENS.map((s) => (
                      <TableCell key={`${theme}-${s}`} className="text-right font-mono tabular">
                        {contrastRatio(token(t)[theme], token(s)[theme]).toFixed(2)}:1
                      </TableCell>
                    )),
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>

      <Section kicker="03" title="Benefit families">
        <p className="mb-6 max-w-prose text-sm text-ink-muted">
          Gold and brown for pensioner benefits, clay for disability and carers, and teal for
          working-age benefits. Lightness changes between groups, so the closest pair stays at a
          CIEDE2000 difference of 5 or more under simulated protanopia, deuteranopia and tritanopia.
          Charts also label every part.
        </p>
        <ul className="grid border-t border-l border-rule sm:grid-cols-2 lg:grid-cols-3">
          {BenefitFamily.options.map((family) => (
            <li
              key={family}
              className="flex items-center gap-4 border-r border-b border-rule bg-surface p-3"
            >
              <span
                className="h-10 w-16 shrink-0 border border-rule"
                style={{ background: `var(--family-${family})` }}
              />
              <span className="min-w-0">
                <span className="block text-sm">{FAMILY_LABEL[family]}</span>
                <code className="block font-mono text-xs text-ink-muted">
                  {token(`family-${family}`).light}
                </code>
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <HalftoneSample label="Published" />
          <HalftoneSample label="Estimated or shared out" halftone />
          <HalftoneSample label="Survey estimate" halftone pewter />
        </div>
      </Section>

      <Section kicker="04" title="Scales">
        <Ramp label="Diverging: below, middle, above" prefix="div" count={9} />
        <Ramp label="Sequential gold" prefix="seq-brass" count={6} />
        <Ramp label="Sequential grey" prefix="seq-pewter" count={6} />
        <p className="mt-4 text-sm text-ink-muted">
          No red and green, and no party colours. Party is set in text only.
        </p>
      </Section>

      <Section kicker="05" title="Type">
        <div className="space-y-8">
          <Specimen label="Display · Bricolage Grotesque">
            <p className="font-display text-display">Where benefit money goes</p>
          </Specimen>
          <Specimen label="Headline · Bricolage Grotesque">
            <p className="font-display text-headline">
              Spending per person aged 66 and over, <em>2024-25</em>
            </p>
          </Specimen>
          <Specimen label="Title · Bricolage Grotesque">
            <p className="font-display text-title">Attendance Allowance and PADP</p>
          </Specimen>
          <Specimen label="Body · Atkinson Hyperlegible Next">
            <p className="max-w-prose">
              Higher than in 82% of constituencies on this measure. The figure is estimated from the
              number of people claiming and their average payment, in 2026-27 prices.
            </p>
          </Specimen>
          <Specimen label="Kicker · Atkinson Hyperlegible Next, semibold">
            <p className="kicker">Per 1,000 people aged 16 to 64</p>
          </Specimen>
          <Specimen label="Figures · Geist Mono, tabular">
            <p className="font-mono text-2xl tabular">£1,234,567 · 0.93 · 12.5</p>
            <p className="font-mono text-2xl tabular">£9,876,543 · 1.04 · 98.1</p>
          </Specimen>
        </div>
      </Section>

      <Section kicker="06" title="Motion">
        <p className="mb-6 max-w-prose text-sm text-ink-muted">
          Hover a bar to run it. With reduced motion on, chips and rows cut, panels and morphs
          become 120 ms fades, and film moves cut.
        </p>
        <ul>
          {MOTION.map(([name, value, use]) => (
            <li
              key={name}
              className="rule-t grid grid-cols-[8rem_4rem_1fr] items-center gap-4 py-3 text-sm sm:grid-cols-[9rem_5rem_1fr_12rem]"
            >
              <code className="font-mono text-xs">{name}</code>
              <span className="font-mono text-xs tabular text-ink-muted">{value}</span>
              <span className="text-ink-muted">{use}</span>
              <span className="motion-demo col-span-3 sm:col-span-1" style={durationStyle(name)}>
                <span />
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section kicker="07" title="Components">
        <div className="grid gap-10 lg:grid-cols-2">
          <Demo label="Button">
            <div className="flex flex-wrap gap-2">
              <Button>Explore the map</Button>
              <Button variant="outline">Find an area</Button>
              <Button variant="secondary">Download CSV</Button>
              <Button variant="ghost">Reset</Button>
              <Button variant="link">Methods</Button>
            </div>
          </Demo>
          <Demo label="Badge">
            <div className="flex flex-wrap gap-2">
              <Badge>Published</Badge>
              <Badge variant="secondary">Shared out</Badge>
              <Badge variant="outline">Estimated</Badge>
              <Badge variant="outline">Small population</Badge>
            </div>
          </Demo>
          <Demo label="Toggle group · basis">
            <ToggleGroup
              type="single"
              defaultValue="real-gdp"
              variant="outline"
              aria-label="Price basis"
            >
              <ToggleGroupItem value="real-gdp">
                Adjusted for inflation (GDP deflator)
              </ToggleGroupItem>
              <ToggleGroupItem value="real-cpi">Adjusted for inflation (CPI)</ToggleGroupItem>
              <ToggleGroupItem value="nominal">Cash, not adjusted</ToggleGroupItem>
            </ToggleGroup>
          </Demo>
          <Demo label="Select · denominator">
            <Select defaultValue="per-aged-66-plus">
              <SelectTrigger className="w-72" aria-label="Denominator">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="total">Total</SelectItem>
                <SelectItem value="per-resident">Per resident</SelectItem>
                <SelectItem value="per-aged-16-64">Per person aged 16 to 64</SelectItem>
                <SelectItem value="per-aged-66-plus">Per person aged 66 and over</SelectItem>
              </SelectContent>
            </Select>
          </Demo>
          <Demo label="Tabs · view">
            <Tabs defaultValue="hex">
              <TabsList>
                <TabsTrigger value="hex">Hex</TabsTrigger>
                <TabsTrigger value="map">Map</TabsTrigger>
                <TabsTrigger value="swarm">Dots by age</TabsTrigger>
                <TabsTrigger value="rank">Ranked list</TabsTrigger>
              </TabsList>
              <TabsContent value="hex" className="pt-3 text-sm text-ink-muted">
                Equal hexagons, one per area.
              </TabsContent>
              <TabsContent value="map" className="pt-3 text-sm text-ink-muted">
                Real boundaries.
              </TabsContent>
              <TabsContent value="swarm" className="pt-3 text-sm text-ink-muted">
                Areas spread by value.
              </TabsContent>
              <TabsContent value="rank" className="pt-3 text-sm text-ink-muted">
                Areas in order.
              </TabsContent>
            </Tabs>
          </Demo>
          <Demo label="Slider · period">
            <Slider defaultValue={[14]} min={0} max={14} step={1} aria-label="Year" />
            <div className="mt-2 flex justify-between font-mono text-xs tabular text-ink-muted">
              <span>2010-11</span>
              <span>2024-25</span>
            </div>
          </Demo>
          <Demo label="Tooltip and dropdown menu">
            <div className="flex flex-wrap gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline">Source</Button>
                </TooltipTrigger>
                <TooltipContent>DWP benefit expenditure by area, 2024-25</TooltipContent>
              </Tooltip>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    Download <ChevronDownIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel>Format</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem>CSV</DropdownMenuItem>
                  <DropdownMenuItem>Parquet</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </Demo>
          <Demo label="Sheet">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline">Show the limits</Button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>Limits of the figures</SheetTitle>
                  <SheetDescription>
                    Sample text. Some figures are estimated from the number of people claiming and
                    their average payment.
                  </SheetDescription>
                </SheetHeader>
              </SheetContent>
            </Sheet>
          </Demo>
          <Demo label="Command · area search">
            <Command className="h-auto border border-rule">
              <CommandInput placeholder="Search areas" />
              <CommandList>
                <CommandEmpty>No area matches.</CommandEmpty>
                <CommandGroup heading="Constituencies">
                  <CommandItem>First constituency</CommandItem>
                  <CommandItem>Second constituency</CommandItem>
                </CommandGroup>
                <CommandGroup heading="Local authorities">
                  <CommandItem>First council</CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
          </Demo>
          <Demo label="Table and separator">
            <Table>
              <TableCaption>Specimen rows, not data. Per person aged 66 and over.</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Area</TableHead>
                  <TableHead className="text-right">Rank</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {RANKED.map(([area, rank, value]) => (
                  <TableRow key={area}>
                    <TableCell>{area}</TableCell>
                    <TableCell className="text-right font-mono tabular">{rank}</TableCell>
                    <TableCell className="text-right font-mono tabular">{value}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Separator className="my-4" />
            <p className="text-xs text-ink-muted">Source: DWP. Prices: 2026-27.</p>
          </Demo>
        </div>
      </Section>
    </TooltipProvider>
  )
}

function durationStyle(name: string): CSSProperties & Record<'--d', string> {
  return { '--d': `var(${name})` }
}

function Section({
  kicker,
  title,
  children,
}: {
  kicker: string
  title: string
  children: ReactNode
}) {
  return (
    <section className="rule-t mt-14 pt-8">
      <p className="font-mono text-sm text-brass-ink tabular">{kicker}</p>
      <h2 className="mt-2 mb-8 font-display text-headline">{title}</h2>
      {children}
    </section>
  )
}

function Chip({ colour }: { colour: ThemedColour }) {
  return (
    <span className="flex overflow-hidden border border-rule" aria-hidden="true">
      <span className="size-4" style={{ background: colour.light }} />
      <span className="size-4" style={{ background: colour.dark }} />
    </span>
  )
}

function MetalCard({ name, hex, meaning }: { name: string; hex: string; meaning: string }) {
  return (
    <div className="border border-rule bg-surface">
      <div className="h-24" style={{ background: hex }} />
      <div className="flex items-baseline justify-between gap-4 p-4">
        <span className="font-display text-title">{name}</span>
        <code className="font-mono text-xs text-ink-muted">{hex}</code>
      </div>
      <p className="px-4 pb-4 text-sm text-ink-muted">{meaning}</p>
    </div>
  )
}

function HalftoneSample({
  label,
  halftone = false,
  pewter = false,
}: {
  label: string
  halftone?: boolean
  pewter?: boolean
}) {
  const metal = pewter ? 'var(--pewter)' : 'var(--brass)'
  const ink = pewter ? 'var(--pewter-ink)' : 'var(--brass-ink)'
  return (
    <figure>
      <div
        className={`h-20 border border-rule ${halftone ? 'halftone' : ''}`}
        style={
          halftone
            ? { color: ink, backgroundColor: `color-mix(in oklab, ${metal} 35%, transparent)` }
            : { background: metal }
        }
      />
      <figcaption className="mt-2 text-sm text-ink-muted">{label}</figcaption>
    </figure>
  )
}

function Ramp({ label, prefix, count }: { label: string; prefix: string; count: number }) {
  const steps = Array.from({ length: count }, (_, i) => `${prefix}-${i + 1}`)
  return (
    <figure className="mb-6">
      <figcaption className="kicker mb-2">{label}</figcaption>
      <div className="flex border border-rule">
        {steps.map((step) => (
          <span
            key={step}
            className="h-12 flex-1"
            style={{ background: `var(--${step})` }}
            title={`--${step}`}
          />
        ))}
      </div>
    </figure>
  )
}

function Specimen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rule-t grid gap-3 pt-4 md:grid-cols-[14rem_1fr]">
      <p className="kicker">{label}</p>
      <div>{children}</div>
    </div>
  )
}

function Demo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border border-rule bg-surface p-5">
      <p className="kicker mb-4">{label}</p>
      {children}
    </div>
  )
}
