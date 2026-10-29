# Design

The design as shipped in `packages/web`. Values come from the code; when this
file and the code disagree, the code wins and this file is the one to fix.

- Tokens: `src/index.css` (per mode) mapped by `tailwind.config.js`
- Components: `src/components/ui/`
- Dashboard: `src/components/Dashboard.tsx`, `src/components/dashboard/`

## Principles

- **Two modes, never mixed on one screen.** `Shell mode="dark"` is the
  dashboard. `Shell mode="light"` is everything you configure: Settings, the
  wizard, Unlock, Add / Reconfigure, the install screen.
- **Night mode** applies to light screens only. A sun/moon button in the top bar
  (`hooks/useNight.ts`, stored in `localStorage` under `stupeflix.night`) gives
  the whole screen the dark tokens, so the two modes still never mix. It is
  module state, so switching screens does not flash white. If storage is
  unavailable the screen starts light.
- **Colours are semantic tokens, never a colour name.** The token palette
  *replaces* Tailwind's, so `bg-gray-800` generates nothing. `white` remains,
  for text on the accent.
- **The accent is for the next step only**: Add service, Restart, Next, Start
  Setup. It is a fill under white text and never text on its own.
- **Each fact is shown once**, where it is used. "N of M running" sits next to
  the Services heading, the disk only in Libraries, and the container state on
  the row rather than the billboard.
- **A problem shows where it is**: on its service's row or billboard, under its
  field. There is no separate alert block.
- Nothing in `ui/` branches on the mode. A component names a role and the mode
  decides its value.

## Tokens

RGB channels (`--page: 20 22 31`) so `/alpha` works (`bg-fg/10`). `line`,
`fail-bg` and `secondary` are whole values and are used as they are.

| Token | Dark (dashboard, night) | Light | Role |
|---|---|---|---|
| `page` | `#14161F` | `#F4F4F4` | Screen ground |
| `card` | `#222532` | `#FFFFFF` | Cards, fields, selected nav item |
| `raised` | `#323646` | `#EDEDED` | One step above a card |
| `fg` | `#FFFFFF` | `#221F1F` | Text, `solid` button fill, focus ink |
| `muted` | `#B4B7C4` | `#6D6D6D` | Secondary text |
| `faint` | `#808494` | `#6D6D6D` | Tertiary text, field hover edge |
| `track` | `#5C6173` | `#D6D6D6` | Switch off, progress track |
| `field` | `#44485A` | `#C8C8C8` | Field hairline at rest |
| `ok` | `#46D369` | `#1E7A3C` | Running, done |
| `warn` | `#E3A64A` | `#8A5A00` | Degraded, "worth knowing" |
| `fail` | `#F6434F` | `#C11119` | Exited, refused field, failed step |
| `fail-bg` | `fail` at 12% | `#FDECEC` | Failed badge ground |
| `link` / hover | `#448EF4` / `#78ACF6` | `#0071EB` / `#005BBD` | Links |
| `line` (default border) | `rgb(200 210 255)` at 12% | `#E6E6E6` | Dividers |
| `secondary` | `rgb(109 112 130 / 0.7)` | `fg` at 8% | `secondary` button |

Shared across modes (`:root`):

| Token | Value | Role |
|---|---|---|
| `accent` | `#E50914` (`229 9 20`) | Next step. Hover = 84% mixed with black, pressed = 73%. Changing it is one line. |
| `stage` | `#0B0D14` | Top bar, dashboard ground |

Service tiles: `hsl(<hue> var(--tile-s) var(--tile-l))`. Dark mode uses
34% / 18% with the glyph at 70% / 64%, and light mode uses 45% / 92% with the
glyph at 55% / 34%.

### Dashboard ink ladder (computed from the alphas)

The dark neutrals lean towards an ink blue (hue ≈ 230) instead of a pure grey:
on `#000` and `#141414` the service tints read as mud, and a biased neutral
ties the cards to the ground they sit on. The night mode of the light screens
takes the same tokens.

ink stage `#0B0D14` → glass sheet behind the cards `#14161F` (`page`) →
resting card ≈ `#191B24` (library tile) → secondary button ≈ `#505261`.
Service cards leave the ladder: their ground is their hue.

## Type

- **Inter Tight** at 400, 500, 700, 800 and 900, and **JetBrains Mono** at 400
  and 500, self-hosted via `@fontsource` (latin) in `main.tsx`. The API's CSP
  blocks other origins, so Google Fonts cannot be used.
- Mono is only for paths, file names, keys and errors (`Input mono`).
- Weight carries the hierarchy. Never use uppercase tracked labels.

| Role | Classes |
|---|---|
| Wordmark "STUPEFLIX" (text, in `accent`) | `text-[28px] font-black tracking-[-0.02em]` |
| Billboard name | `text-5xl font-black leading-none tracking-[-0.02em]` |
| NavLayout title (Settings, wizard) | `text-[40px] font-extrabold` |
| Settings page title | `text-[32px] font-bold` |
| Section heading (Services, Libraries) | `text-2xl font-bold` |
| Body, row title | 16 / 400, 16 / 700 |
| Meta, category, status word | `text-[13px]`–`text-[15px]` |

## Shape

- Use `rounded` (4px) for controls, fields and tiles. Use `rounded-lg` (8px) for
  cards (Settings and wizard cards, library tiles; service cards are 10px). Use
  `rounded-full` only for the switch, dots and the ⋯ button.
- Light screens are flat: no shadows, no gradients. Depth comes from `page` →
  `card`.
- **The only exception is liquid glass, on the dashboard only** (see below).

## Components (`src/components/ui/`)

Extend a component with a variant rather than copying its classes.

- **Shell**: every screen's frame. It holds a top bar pinned to the dark tokens
  in either mode, with the wordmark on the left and `actions` on the right. On
  light screens the night toggle comes before the actions. `pb-[72px]`.
  `overlay` makes the bar transparent from `lg` and the ground `stage`, for a
  screen whose first block is black and starts under it (`lg:-mt-[72px]`).
  Below `lg` the bar can wrap, so it stays solid. `BackLink` is the bar's way
  back (ghost sm), and `Spinner` shows while the first query loads.
- **Button** / `buttonClass(variant, size)` (the latter also works on `<a>` or
  `<label>`):
  - `primary`: accent fill, white text. Next step only.
  - `secondary`: translucent grey on the billboard's black, `hover:brightness-125`.
  - `solid`: `fg` as fill, `card` as text (Open on the billboard, Copy in Settings).
  - `outline`: 1px `fg` border. `ghost`: text only, `hover:bg-fg/10`.
  - Sizes: `sm` h-9 (top bar), `md` h-10 (page actions, billboard), `lg` h-12.
    Bold, `rounded`, disabled at 40% opacity.
- **Input** / `fieldClass({ error, mono, select })`: h-11, `bg-card`, `rounded`,
  15px. At rest it has a `border-field` hairline. Hover darkens it to
  `border-faint`, and focus gives `border-fg` plus `ring-1 ring-fg`. `error`
  draws a 2px `fail` border, and the caller writes the sentence. Disabled loses
  its border and sits on `bg-page` with `text-muted`: still grey, a value you
  cannot change. Use `fieldClass()` for any field laid out by hand. `suggestions`
  uses a native `datalist`.
- **Select**: a native `<select>` with `fieldClass({ select: true })`. The
  `.field-select` rule removes the platform arrow and draws a `#808080` chevron
  at `right 0.875rem`.
- **Toggle** / **Switch**: a 40×22 track that is `bg-fg` on and `bg-track` off,
  with a `bg-card` knob. `role="switch"`.
- **RadioGroup**: `bg-card` cards with a `rounded-lg` border-2. Selected is
  `border-fg`, hover is `border-line`.
- **NavLayout**: the account-page layout of Settings and the wizard. A title and
  nav column (`flex-[1_1_220px]`) sits beside the content
  (`flex-[999_1_680px]`, `md:pt-16`), max 1200px, wrapping to one column on a
  phone. `navItemClass(current)` puts the current item on `bg-card`.
- **StatusBadge**: step states. pending ○ muted, in_progress ◔ bold, completed
  and skipped ✓ `ok`, failed ✗ `fail` on `fail-bg`.
- **Collapse**: anything that opens or closes. It measures its content and
  animates the height (Web Animations API, 320ms). The closed state is zero
  height plus `inert`. Space its content with padding, not margin.
- **ServiceIcon** (`sm` 20px, `md` 34px, `fill`): reads
  `src/icons/<id>.svg` by filename and falls back to `_default.svg`.
  **serviceTint(id)**: a picked hue per service (with a hash fallback), and the
  mode supplies saturation and lightness. An icon without `currentColor` gets a
  neutral tile (`fg` at 8%). Use dashboardicons' monochrome variant with
  `fill="currentColor"`.
- **ActionIcon**: Heroicons outline paths by name, for template `actions:` and
  UI glyphs (`cog`, `key`, `check`…).

## Dashboard (dark)

Top bar (overlay): `Add service` (primary sm, hidden when nothing is left to
install) and `Settings` (ghost sm, cog).

**Billboard** (`dashboard/Billboard.tsx`): the selected service on
`bg-stage`, under a halo of its own hue, starting under the bar from `lg` (`lg:-mt-[72px] lg:pt-[72px]
lg:pb-16`).
- Name only, with no status word and no category, since the picked card shows
  both. Below it are the `info:` readouts row (15px muted), then condition
  reasons in `warn`, then the buttons.
- Buttons: `Restart` (primary, only when exited), `Open` (solid with a play
  glyph, absent when there is no port or the service is down), the template's
  `actions:` (secondary), `Credentials` (secondary, key → check "Copied"), then
  the ⋯ menu (restart / reconfigure / help / remove). Help, present only when
  the template has `notes`, opens them in a `Collapse` panel under the buttons,
  closed by its X or by picking another service.
- Watermark: the service glyph at 20rem, tinted, `right-[20%]`, `top-6` so its
  tip stays clear of the browser's edge, opacity 20% (8% when exited). It shows
  from `lg` only, and is open at the bottom so the glass passes over it.
- Halo: `.billboard-halo`, two radial gradients in `hsl(var(--fh) …)` — 65% /
  32% at 55% alpha behind the glyph, 50% / 22% at 35% from the top-right
  corner. `--fh` is the `serviceHue`, registered with `@property` so picking
  another card slides the hue over 0.9s rather than cutting. At every width.
  None for a full-colour logo (no hue); 30% opacity when exited.

**Glass sheet**: the page below the billboard is one full-width, square-cornered
`.glass-sheet` (absolute, `-z-10`, down to the screen's bottom past the Shell padding). From
`lg` it overlaps the billboard's last 2.5rem (`lg:-mt-10`) with the glyph
showing through.
- Fill: `page` at 15% at the top, 60% by 72px, solid by 140px — clear where it
  crosses the billboard, grey behind the cards — plus a light sheen (`fg` 7% →
  1.5% at 56px → 0 at 120px).
- `backdrop-filter: blur(3px) saturate(200%)`.
- Rim: inset box-shadows (1px top line at `fg` 12%, 1px all round at 5%, a soft
  18px inner glow). It is light catching an edge, not a border.

**Services** (`ServicesSection.tsx`): heading plus "N of M running" (`ok` when
all are up, `warn` when some are, `faint` when none are). Cards sit in a grid
(`minmax(250px,1fr)`, `gap-5`: the zoom needs the room). Each card is
`.tint-card`, 104px high, `rounded-[10px]`: a 135° gradient in the service's
hue (`serviceHue`, `--h`; `--c: 0` turns it grey for a full-colour logo) —
48% / 20% at 80% alpha, to 34% / 11% at 45% by 70% — name
(17px bold) and category at the top, the glyph as a 110px watermark cut by the
bottom-right corner (30% opacity), and the status badge at the bottom
(`rowStatus`): a glass pill (`bg-fg/[0.07]`, inset 1px rim) with white text,
colour only in its 7px dot (`TONE_DOT`). Every badge is `w-[5.5rem]` whatever
the word, content centred; "Incomplete" is the longest and fits. A non-running
state wins over the first condition.

The tint says the state only when it is bad news. Running and the warn states
share one tint. **Exited** (`is-off`) dulls it to 8% saturation, the glyph to
12% and desaturated, the text to muted. Only the red dot keeps its colour.
**Missing** (`is-gone`) is a ghost: no fill, a dashed 1px outline,
`grayscale(1)` at 38% opacity (60% on hover or picked).

Hover zooms to 103% and draws a rim and halo in the card's own hue. Picked
holds 102% with a stronger rim (60%) and a `0 0 28px -6px` halo. Exited and
Missing glow white, having no hue worth showing. The glow fades in over 0.9s,
the zoom over 0.35s. A glow at full strength on click reads as a flash.
Reduced motion drops the zoom. Picking a card swaps the billboard.

**Liquid glass, light**, over the tint and the glow rather than instead of
them, and never a blur: the glyph stays where it is. A 1px rim (`::before`,
mask-composite) runs from `fg` 25% top-left to 2% and back up to 11%
bottom-right; an arc of highlight (`--glass-arc`, `fg` 8%) crosses the top; an
inner shadow (`--glass-depth`) gives the bottom some depth; a 150px sheen at
`fg` 5.4% follows the pointer on hover (`--mx`/`--my`). The badge takes a 13%
top line. Missing has no glass. A version that blurred the glyph behind frost
was rejected: nothing was recognisable any more.

**Libraries** (`LibraryTiles.tsx`): `.glass-card rounded-lg` tiles, one per
library (count at 22px) plus Disk (used of total, a 4px `track` bar filled with
`accent`).

`.glass-card`: `fg` at 2% under the same light liquid glass as the service
cards (rim, arc, depth; no sheen), in the components layer so utilities win
over it.

## Configure screens (light, or night)

Settings and the wizard use `NavLayout`, with content on `rounded-lg bg-card`
cards (`p-6` or `px-6`). Settings pages are Templates, Configuration and Access
token. The wizard nav lists the steps: a past step is a way back, steps ahead
are unreachable, and a running setup locks them all. A requirement shows under
the service that has it, and a failure under the row that failed.

## Rejected (do not retry)

- A fade between billboard and page: it read as a cut, then as fog.
- A flat hairline where the page meets the billboard: it read as a seam.
- A frosted pane over the billboard itself.
- A grey ground behind the glass: it showed as a band through it.
- A rounded or inset sheet instead of a square, full-width one.
- Opaque grey library tiles next to glass rows. Use one material on the sheet.
- Status word or category on the billboard, and numbered rows.
- Poster rails (empty posters with only a logo), a profile gate (it hid the
  readouts), a stack-sized hero, and a "Needs attention" block.
- A `max-height` or `grid-template-rows` collapse, or `visibility: hidden`
  (see Collapse).
- Hashed tile hues: services collide, so hues are picked.
