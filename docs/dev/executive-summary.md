# docs/executive-summary.html — how it was made and how to refresh it

`docs/executive-summary.html` is the one-page brief for engineering leadership: what the app is, why we
built it now, what it showed, and what to do next. It is a **single self-contained file** — no external
CSS, no web fonts, no scripts, both screenshots inlined as base64 JPEG data URLs. Open it from disk, mail
it, or print it; it needs nothing else.

**This page ships publicly, so every figure on it comes from the bundled synthetic demo dataset**
(`tests/fixtures/projects` — 7 fictional projects, 62 sessions, ~35 days), never from a real person's
transcripts. The banner text says so explicitly. If you're regenerating this page, point the server at
the demo fixtures, not at `~/.claude/projects`.

Constraints it has to keep meeting:

| | |
|---|---|
| file size | 208 KB (budget: ≤ 1.5 MB) |
| print | exactly **1 page** on A4 **and** Letter at 14 mm margins |
| accessibility | axe with `wcag2a/2aa/21a/21aa/22aa/best-practice`: **0 violations** at 1280 px, 390 px and 640 px (200 % zoom) |
| layout | no horizontal overflow at 320 / 390 / 768 / 1024 / 1440 px |
| privacy | no real person, employer or team name, no "internal" label, no byline, no session titles/prompt text/snippets beyond what the demo dataset's own fictional titles already show — see "Privacy rules" below |

Design follows the app's "Ledger" language (SPEC §8) but re-declares it locally: paper `#F4EFE6`,
sheet `#FBF8F2`, ink `#17150F`, hairlines `rgba(23,21,15,.14)`, one red `#B42318` for cost, one green
`#1F7A5C` for savings. Fraunces and Geist are *not* bundled — the file falls back to
`"Iowan Old Style", Charter, Georgia, serif` for display, the system sans for body, `ui-monospace` for
figures, all with `font-variant-numeric: tabular-nums slashed-zero`.

---

## 1. The numbers in the page, and where each came from

**Snapshot: 2026-09-09, against the built server serving the synthetic demo dataset on
`http://127.0.0.1:4145`** (`status.roots = ["/tmp/claude/demo/claude-cost-analyzer/projects"]`, 7
projects, 62 sessions, 11,257 requests). The demo dataset is fixed, so a re-read a day later should
reproduce the same numbers exactly — unlike a real corpus, it does not keep growing.

Every `/api/*` call needs the loopback auth cookie and the two guard headers (see `server/auth.ts`):

```sh
J=$TMPDIR/cca_cookies.txt
curl -s -c "$J" -X POST http://127.0.0.1:4145/api/auth/session \
  -H 'Origin: http://127.0.0.1:4145' -H 'Sec-Fetch-Site: same-origin'
curl -s -b "$J" -H 'Sec-Fetch-Site: same-origin' http://127.0.0.1:4145/api/analytics/overview   # default range = last 30 days
```

### 1.1 KPI strip — `GET /api/analytics/overview` (no range = last 30 days, `2026-08-11 → 2026-09-09`)

| shown on the page | value used | exact API value | field |
|---|---|---|---|
| Spend, last 30 days | $957 | 956.7659991999999 | `totals.cost.total` |
| Prompts typed | 1,102 | 1102 | `totals.prompts` |
| …billed API calls | 9,089 | 9089 | `totals.requests` |
| …8 API calls each | 8 | 9089 / 1102 = 8.25 | derived |
| Cost per prompt | $0.87 | 0.8682087107078039 | `totals.costPerPrompt` |
| Cache hit ratio | 96% | 0.9624876485556425 | `totals.cacheHitRatio` |
| August, pay-per-token | $422 | 422.15998525 | `plan.months[month="2026-08"].apiCost` |
| …no plan configured | — | `plan.preset = "none"`, `monthlyUsd: 0` | the demo has no plan set, so the page says to compare in Settings instead of inventing a plan number |
| September forecast | $2,365 | 2364.7070125 | `budget.forecast` (linear: 709.41 spent ÷ 9 days elapsed × 30) |

Confirmed against a screenshot of the Overview page at the same range (`hero-overview.paper.png`):
$956.77, 9,089 requests, 51 sessions with requests, 1,102 prompts, 96% cache hit ratio, $0.87/prompt.

### 1.2 "What it revealed" — whole history

Range `?from=2000-01-01&to=2026-12-31` (the demo's real span is 2026-08-07 → 2026-09-09, so the page
calls it "7 Aug – 9 Sep 2026"). Whole-history totals: spend **$1,035.17**, 56 sessions (`hideScratch`
excludes 5–6 scratch sessions out of 62), 9,818 requests, 1,210 prompts.

The findings come from `GET /api/analytics/insights` (ranked by `impactUsd`) and
`GET /api/analytics/tools`, both over the whole-history range:

| page line | $ / % shown | source | raw value |
|---|---|---|---|
| Long conversations are the bill | $85, "179.4k" | insight `long-context-sessions` | `impactUsd` 84.71, "1 session ran above 150.0k average context", metric `179.4k` |
| Model choice is the biggest lever | $401 cheaper ($267 vs $668) | insight `model-mix-opus-to-sonnet` | `impactUsd` 401.28; explanation "$668.31 of opus spend re-priced at Sonnet 5 list prices comes to $267.03 for the same tokens" |
| Shell output is expensive to keep | $3.14, 14.6% | `/api/analytics/tools` → `Bash` | `carryCost` 3.138479274567524; share = `Bash.carryCost` ÷ Σ `carryCost` over all tools (21.484349284421196) = 14.6% |
| A third of context cost is text nobody typed | 34% (< 1% + 33%) | `overview.byCategory.estimated`, whole history | see below |

The 34% is derived, not a single insight, same method as before:

```
context cost (exact)  = cost.input + cost.cacheWrite + cost.cacheRead
                      = 0.19 + 223.74 + 282.33                        = $506.26
hooks   (est.)        = byCategory.estimated.hooks    = $2.19  = 0.43%
harness (est.)        = byCategory.estimated.harness  = $2.53  = 0.50%
                                                hooks + harness      ≈ <1%
baseline (est.)       = byCategory.estimated.baseline = $169.27 = 33.4% → 33%
                                                                total ≈ 34%
```

The insights endpoint's own `tool-carry-cost` insight picks whichever tool has the single largest carry
cost (`Read`, $9.52, 44.3% of total carry) rather than the shell-specific figure the page wants, so that
line is computed directly from `/api/analytics/tools` instead of quoted from the insight.

The callout below the findings ("The priciest conversation…") replaces the old "building this app" note,
which doesn't exist for a synthetic dataset. It quotes `GET /api/sessions?sort=cost&limit=5`'s top
result: session `502989a9-2558-4004-8a31-290ad695aa24` ("Draft the Q4 platform reliability review",
`/Users/dev/notes`), cost $88.72, 705 requests, 656 tool calls, 4 agents, `activeMs` 14,961,163 ms
(4h 09m) — the same session shown in the second hero screenshot.

### 1.3 Figures quoted from elsewhere

- **"586 unit tests and 101 browser tests"**, WCAG 2.2 AA in both themes — the project's verified state
  (`npm test`, `npx playwright test`), unrelated to which dataset is loaded. Not re-run while writing
  this page; re-check before relying on the exact counts.
- **Prices** — Anthropic list prices, platform.claude.com, September 2026 (SPEC §5.2). Stated on the
  page under the KPI strip and in the footer, and editable in the app's Settings.

## 2. Refreshing the numbers

The shipped HTML is **not** templated — the figures are literal text. To update it:

1. Start the built server against the demo fixtures on a spare port (never a real `~/.claude/projects`
   or a live `CCA_HOME`), do the cookie handshake, and re-run the calls in §1.
2. Edit the numbers in place. They live in: the six `<dd class="num">` values in `.kpis` (plus their
   `<span class="sub">` captions), the date range in `.stripnote`, the four `<span class="amt">` amounts
   and `<span class="why">` sentences in `ul.findings`, the callout paragraph below them, and the date
   in `<footer>`.
3. Re-run the checks in §4. The page has some slack on both paper sizes; adding a line of copy can push
   it to two pages — recheck after any wording change, not just after a number change.

## 3. Refreshing the screenshots

The page embeds JPEGs cut from `docs/screenshots/hero-overview.paper.png` and
`hero-session.paper.png` (1440×900, paper theme, from `npm run screenshot` against the demo dataset).
Regenerate those PNGs first, then re-crop and re-encode:

```sh
# overview: no crop, scale to 980 wide
ffmpeg -y -i docs/screenshots/hero-overview.paper.png -vf "scale=980:613" /tmp/overview-980.png
sips -s format jpeg -s formatOptions 72 /tmp/overview-980.png --out /tmp/overview.jpg   # or ffmpeg -update 1 -q:v 5

# session: crop the left rail off (x:264) and a half-cut heading off the bottom (h:878), then scale
ffmpeg -y -i docs/screenshots/hero-session.paper.png -vf "crop=1176:878:264:0,scale=980:732" /tmp/session-980.png
sips -s format jpeg -s formatOptions 72 /tmp/session-980.png --out /tmp/session.jpg
```

`sips -s format jpeg` can fail with "Cannot write to file …" inside a sandboxed shell (it stages through
a temp file the sandbox denies); pass `dangerouslyDisableSandbox: true`, or use
`ffmpeg -update 1 -q:v 5 out.jpg` instead, which doesn't need the intermediate file.

Base64-embed with:

```sh
base64 -i /tmp/overview.jpg | tr -d '\n' > /tmp/overview.b64   # then splice into the <img src="data:image/jpeg;base64,...">
```

| image | crop from the 1440×900 PNG | out | JPEG |
|---|---|---|---|
| Overview | none | 980×613 | q~72, ~65 KB |
| Session summary | `x:264, y:0, w:1176, h:878` | 980×732 | q~72, ~80 KB |

The session crop is **not** cosmetic. `x:264` removes the left rail, which lists subagent names derived
from their opening prompts (fictional in the demo dataset, but still cropped for consistency);
`h:878` drops a heading that the 900 px capture cut in half. 980 px wide keeps the whole file well under
the 1.5 MB budget even with both images inlined.

The two `alt` texts describe what the figures *say* (the actual headline values), not "screenshot of the
Overview page". Rewrite them if the screenshots change.

## 4. Verifying a change

Run these with `@playwright/test`, already a devDependency, from the repo root — `npx tsx` opens a unix
socket that sandboxed shells reject, so use `node --import tsx/esm` or plain `node` on a `.mjs` scratch
script, and pass `dangerouslyDisableSandbox: true` (loopback + browser).

1. **No overflow.** Load the file at 1280×900 and 390×844 and check
   `document.documentElement.scrollWidth === document.documentElement.clientWidth` at both.
2. **Look at it.** Screenshot both viewports and read the images: numbers legible, both heroes render,
   no leftover placeholder text.
3. **Print, both paper sizes, one page each.** `page.pdf({ format, margin: 14mm ×4, printBackground:
   true })` for `A4` and `Letter`, then count `/Type\s*\/Page[^s]/` matches in the PDF bytes (a plain
   `/Type /Page/g` count also matches `/Type /Pages`, so anchor on the character after `Page`). Must be
   `1` for both.
4. **Privacy.** Run the repo's standard sensitive-string grep (username / employer / repo-path
   patterns; see the task runbook, not spelled out here so this line doesn't trip its own check) over
   both this file and `docs/executive-summary.html`, and `node scripts/check-privacy.mjs`. Both must
   come back clean.

## 5. Privacy rules this file must keep

- No real person, employer or team name, no "internal" label, no byline. Dates are "September 2026"
  granularity except the footer's "figures captured" line, which may name the day the snapshot was
  taken — never the time of day or a timezone (a timezone abbreviation is a location hint).
- Every figure must trace to the bundled synthetic demo dataset, not to any real transcript. If a real
  server is ever pointed at during editing, only copy over numbers, never screenshots, without
  re-generating the screenshots from the demo dataset first.
- The demo dataset's own fictional session titles and project paths (e.g. "Draft the Q4 platform
  reliability review", `/Users/dev/notes`) are fine to show — they are not real work, and the app's
  own screenshots already show them. The session hero screenshot still crops the left rail, which lists
  subagent names, purely for layout — those names are also fictional.
- Aggregates only, and the banner says plainly that the numbers are from a synthetic demo dataset, not a
  real team's spend, so nobody reads $957/month as a real cost.
