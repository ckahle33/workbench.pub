# Design system: workbench.pub (Workprint world)

Derived from the shipped code in `src/styles/` (entry `src/styles.css`). Swiss/International style taken from the owner's Workprint boards (`.superpowers/design-reference/`). Light only.

## Tokens (`src/styles/base.css`)

| Token | Value | Use |
|---|---|---|
| `--ink` | `#111111` | text, rules, primary buttons, dark tiles |
| `--paper` | `#ffffff` | background |
| `--ink-soft` | `#3a3a3a` | card excerpts (11.4:1) |
| `--muted` | `#5c5c5c` | secondary text, mono labels (6.7:1 on white, 5.9:1 on panel) |
| `--hairline` | `#dcdcdc` | 1px rules between list rows, image edges |
| `--panel` | `#f2f2f2` | missing-photo panel, sub-form, hover fill |
| `--grey-mid` / `--grey-light` | `#9a9a9a` / `#c7c7c7` | decoration and disabled borders only, never text |
| `--accent` | `#d0201a` | the one red: newest update numeral, the first step's numeral on the About page, current marker, in-progress status, errors, hover (5.38:1 on white, 4.81:1 on `--panel`) |

Spacing scale: `--s-1` 8, `--s-2` 16, `--s-3` 24, `--s-4` 32, `--s-5` 48, `--s-6` 64, `--s-7` 96 px. Headings get more space above than below (section `margin-top: --s-6`, title-to-content `--s-3`; timeline entry `--s-5` above, `--s-4` below). Layout: 1200px column, `--gutter` 24px (16px under 480px).

Rules: `--rule` 2px ink (under header, above sections, asides, lists, form sections), `--rule-thin` 1px ink (between timeline entries, boxed items), `--rule-hair` 1px hairline (list rows).

## Type

- Sans: Inter Tight (variable, latin subset, self-hosted from `@fontsource-variable/inter-tight`), fallback Helvetica, Arial. Body 16px / 1.45.
- Mono: IBM Plex Mono 400/500 (`@fontsource/ibm-plex-mono`, latin). Only for metadata, labels, dates, counts, table heads.
- Scale: project title `clamp(56px, 11vw, 148px)` / .88 / -0.055em / 800 (long titles over 40 chars: `clamp(40px, 6.4vw, 88px)`); profile name `clamp(56px, 10vw, 136px)`; feed/topic title `clamp(56px, 8vw, 72px)`; 404 `clamp(96px, 24vw, 280px)`; form titles `clamp(48px, 9vw, 96px)`; section title 40px/-0.04em; entry heading 30px/-0.03em (24px on phones); card title 28px/700; table title 24px/700; timeline numeral 56px/800/-0.05em (36px on phones).
- Mono label (`.label`, `.meta-line`): 12-13px, uppercase, 0.04em, `--muted`. Handles and DIDs keep their case (`.as-is`).
- Dates `MM.DD.YYYY` (US, month first, viewer's local timezone), all produced by `formatDate` in `src/format.ts`; no time of day is shown, in `<time dateTime>` with the ISO value; tabular numerals on dates and counts.

## Components

- Footer: a 2px rule, the wordmark label at the left, About and GitHub links at the right (`SiteFooter`), on every page.
- Header: wordmark `workbench.pub` (red dot), nav (Latest, About, New project black button), right group (profile link, Sign out / Sign in) with `margin-left: auto`; current page underlined 2px, offset 6px.
- Buttons: square. Default = white, 2px ink border, 600 14px, 44px min height. `.btn-primary` = ink fill (hover accent). `.btn-small` 1px border for owner actions. `.btn-text` underlined text button. `.btn-danger` accent border. `[aria-disabled=true]` / `:disabled` = grey border, muted text, `progress` / `not-allowed` cursor, no hover change.
- Status badge: square, 1px border, 13px/600. In progress = accent; finished = ink; paused = dashed muted.
- Project page: 12-column head (meta line, title, summary span 7, author + Follow span 5), timeline (`96px | 1fr`, numeral from `updateCount`, newest red), aside of `.side-block`s (FACTS `dl`, PARTS chips, Report).
- Photos: own aspect ratio (no dimensions in records). One photo: capped at `min(72vh, 720px)`. Several: fixed-height contact-sheet row. Failed load: grey panel with "PHOTO UNAVAILABLE" and the alt text.
- Feed card: 4:3 visual (photo `cover`, or typographic tile: project title in 800 on black or white-with-border, stable per project), mono label, project title link, update heading link, 2-line excerpt. Grid `repeat(auto-fill, minmax(min(100%, 320px), 1fr))`, gaps 48/32.
- Topic filter: ruled list with red square on the current row; a horizontal scrolling row under 900px.
- Project table: ruled, mono heads; stacks into blocks under 600px.
- Count strip (profile): 4 columns of 48px/800 numbers; only when the whole list is loaded.
- Forms: mono caps labels above square 1px ink fields, 16px text, 48px min height, 2px ink focus outline offset 2px; invalid = 2px accent border + accent message (`role=alert`); counts in mono, right-aligned; fieldsets are ruled sections with a 24px/800 legend; select chevron drawn with gradients; file input button styled as a secondary button; submit row under a 2px rule.
- States: loading = mono `LOADING…` line; empty / not found = boxed sentence + next action; error = accent-bordered box; Load more = full-width secondary button.
- Browser surfaces: `::selection` ink/white, accent caret, ink-on-panel scrollbars, underline offset 0.2em.

## Do / don't

- Do: one red per view region, rules instead of boxes, generous space above headings, real data only (counts only when complete).
- Don't: shadows, gradients as decoration, rounded corners (the 44px avatar circle is the only round thing), icons or emoji as decoration, grey text on grey below 4.5:1, hex values outside the token block, dark mode.
- Motion: 120ms colour transitions on links and buttons only; disabled under `prefers-reduced-motion`.
