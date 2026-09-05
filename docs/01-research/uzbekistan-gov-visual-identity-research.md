# Uzbekistan government visual identity — research for WorkPortal

Compiled 2026-09-05. This report exists to answer one design question: **what does "serious yet
modern" mean inside the actual visual world of Uzbek e-government**, so that WorkPortal's palette
and type choices read as *of* that world without literally being a copy of any single portal in it.

Every colour and font claim below is tagged:
- **OFFICIAL** — published in a law, decree, or resolution.
- **OBSERVED** — extracted live from a site's shipped CSS/HTML in this session (curl + WebFetch),
  i.e. what the browser actually renders, not a claim about brand intent.
- **PROPOSED** — invented for this report, not found anywhere.

## Methodology note (read before trusting a number)

This session's `WebSearch` tool budget was already exhausted (0 of the requested queries returned
results — "200 of 200 WebSearch calls" had been used elsewhere before this task started) despite the
brief asking for ≥14 `WebSearch` calls. To still do documentary research rather than write from
memory, I fell back to: (1) direct `curl` fetches of DuckDuckGo's HTML/Lite endpoints, which
succeeded for two query batches before DuckDuckGo rate-limited the IP with an "anomalous traffic"
page (Bing and Ecosia returned geo-mismatched or JS-shell pages; Marginalia returned no relevant
results); (2) 23 `WebFetch` calls against Wikipedia, `lex.uz`, `digital.uz`'s own sub-pages, and the
other portals, several of which 404'd (no Wikipedia article exists for "Digital Uzbekistan 2030" or
"New Uzbekistan" as standalone titles; Google Fonts specimen pages are JS-rendered and returned no
character-set data to a text fetch); and (3) **direct `curl` retrieval of the live HTML and CSS
bundles of all six requested portals plus Ukraine's Diia**, which is the most reliable source in this
report because it is exact bytes, not an AI paraphrase of bytes. Two facts I could not verify live
this session — the decree numbers for "Digital Uzbekistan – 2030" and the "New Uzbekistan" strategy —
are given from general knowledge and flagged **UNVERIFIED THIS SESSION**; re-check them against
`lex.uz` before quoting them in anything official. `eGov.kz` (Kazakhstan) timed out from this network
for the entire session and `gosuslugi.ru` served an anti-bot JavaScript challenge page to the fetcher,
so neither yielded OBSERVED CSS; both are covered qualitatively only.

---

## 1. The Ministry of Digital Technologies' identity

**Official name (OBSERVED on digital.uz):** "Ministry of Digital Technologies of the Republic of
Uzbekistan." The ministry has been renamed five times as the state's telecom/IT portfolio was
reorganised — this lineage matters because it explains why so many "official" artifacts (old logos,
old domain names) are actually one or two rebrands out of date:

| Name | Established | Instrument |
|---|---|---|
| Ministry of Communications of the UzSSR | 8 Jan 1955 | Resolution No. 1795 |
| Uzbekistan Agency for Posts and Telecommunications | — | — |
| Uzbek Agency for Communications and Informatization | 30 May 2002 | Decree No. 3080 |
| State Committee for Communications, Informatization and Telecommunication Technologies | 16 Oct 2012 | Decree No. 4475 |
| Ministry for Development of Information Technologies and Communications | 4 Feb 2015 | Decree No. 4702 |
| **Ministry of Digital Technologies** (current) | 21 Dec 2022 | Decree No. PF-269 |

Source: digital.uz's own "History of the ministry" page (OFFICIAL, self-published).

**Logo:** digital.uz's header does not render a distinct ministry emblem in the fetched markup — it
uses the same "Uzbekistan Gerb" (state coat-of-arms) PNG (`gerb_in.8de8c8a8.png`) that `gov.uz`
mounts in its navbar, alt-texted literally `"Uzbekistan Gerb"`. In other words: **OBSERVED**, the
ministry's own portal and the national portal both lean on the *state emblem*, not a bespoke ministry
mark, as the primary trust signal in the header. There is no separate "ministry brand mark" distinct
from the state emblem visible in the fetched HTML.

**Colour tokens — OBSERVED, extracted from digital.uz's and gov.uz's shipped CSS (they are
byte-identical, see §3):**
```
--color-primary:      #013d8c   (deep navy — brand/action colour)
--color-secondary:    #707070   (neutral grey)
--color-text-primary: #043b87   (near-identical navy, used for body links/headings)
--color-border:       #e1e1e1   (light neutral border)
footer/dark accent:   #143797   (a darker, more saturated navy)
```
Supporting tones seen in the same bundles: `#004094` (another navy variant), `#048708` (a green,
almost certainly a status/"success" colour rather than brand), `#cc950f` (amber/warning), and a
cluster of Mantine-default blues (`#1675e0`, `#2299dd`, `#228be6`) used for focus rings and links —
those last three are **framework defaults** (Mantine UI's stock palette), not ministry-specific
choices, and should not be read as "official."

**Typography:** **Montserrat**, loaded through **Mantine UI** (`--mantine-font-family`,
`--mantine-font-family-headings`) — OBSERVED, identical stack on `gov.uz`. No serif or display face is
used; body and headings share the one grotesque.

**Brand book / presentation template:** none found. No press-kit, media-kit, or downloadable brand
guideline page turned up on `digital.uz`, and no such document is indexed by the search attempts that
succeeded before the rate-limit. This is itself a finding: **there is no publicly discoverable
ministry brand book** — what exists instead is a *de facto* design system baked into the shared
Next.js/Mantine template that `digital.uz` and `gov.uz` both run on (see §3). Treat "the ministry's
identity" as this shipped CSS, not as a governed brand standard.

---

## 2. National symbols: flag, emblem, and rules on use

**Flag — OFFICIAL, Law No. 407-XII "On the State Flag of the Republic of Uzbekistan," adopted 18
November 1991.** The law is explicit that Uzbekistan does **not** publish hex/RGB/CMYK/Pantone values
for the flag — colours are legally defined only by name: *azure* (blue, "sky and clear water… the
colour of the Turkic peoples"), *white* ("peace and good luck"), *green* ("nature, new life, good
harvest"), and *red* fimbriations ("the power of life"). Construction geometry is specified precisely
even though colour is not: on a 125×250 cm flag the blue/white/green bands are 40 cm each, separated
by 2.5 cm red fimbriations; a white crescent moon and twelve white five-pointed stars sit on the blue
band. **Practical consequence for this project: there is no OFFICIAL hex for the flag blue/green** —
any hex you see quoted online (including "traditional" Pantone matches some agencies use) is a
private approximation, not a legal value, and WorkPortal should not claim otherwise.

**Emblem — OFFICIAL, Law No. 616-XII "On the State Emblem of the Republic of Uzbekistan," adopted 2
July 1992.** Elements: a Khumo (mythical bird) with spread wings framing a rising sun over mountains
and green valley; cotton bolls (left) and wheat ears (right) bound in ribbons carrying the flag's
colours; an eight-pointed Rub el Hizb star at the top enclosing a crescent and star; the Amu Darya and
Syr Darya rivers running through the valley; a base banner reading "Oʻzbekiston" in Latin script. As
with the flag, the fetched sources give iconography, not a published colour palette, and no explicit
usage-restriction clause surfaced in what could be retrieved this session (post-Soviet state-symbol
laws in the region typically reserve the emblem for state bodies and prohibit its use as a decorative
or commercial mark, but I could not confirm Uzbekistan's specific enforcement clause live — treat this
as a strong convention, not a confirmed prohibition, until checked against the full text on `lex.uz`).

**Observed real-world practice:** both `gov.uz` and `digital.uz` place the literal state emblem
graphic in their site header (see §1) — i.e. the working norm for *national and ministry* portals is
to display the emblem directly. Neither `my.gov.uz`, `id.egov.uz`, `it-park.uz`, nor `uzinfocom.uz`
does this in their fetched markup — subordinate agencies and enterprises use their own logotypes
instead. **This is the pattern WorkPortal should follow**: the emblem/tricolour belongs to the state's
own top-level portals; an internal department tool sits at the "subordinate agency" tier and should
use its own mark, not the coat of arms.

---

## 3. Government website standards: the unified `gov.uz` platform

**The operative instrument is Cabinet of Ministers Resolution No. 54, dated 31 January 2025**, "On
measures to further improve the activity of official websites of state bodies and organizations"
(OFFICIAL, retrieved via `lex.uz`). Key provisions:

- **Unified platform, "Single Window" principle:** from **1 March 2025**, state bodies' official
  websites must run exclusively on the shared `gov.uz` platform (newly created bodies get one month
  from formation to launch). This is not a style guide — it is a hosting/CMS mandate.
- **Governance:** the Ministry of Digital Technologies oversees the policy; **UZINFOCOM** (state
  enterprise) is the named platform operator.
- **Content standards:** information must be current, accurate, and organised by subject blocks;
  agency heads bear "personal responsibility" for their site's upkeep on the platform.
- **Security:** compliance is checked twice yearly by the Cybersecurity Center.
- **Languages, OBSERVED directly on `gov.uz`:** the site ships five locale routes — `/uz` (Uzbek
  Latin, default), `/oz` (Uzbek Cyrillic), `/ru` (Russian), `/qr` (Qaraqalpaq/Karakalpak — reflecting
  Karakalpakstan's co-official status), and `/en` (English).
- **Accessibility, OBSERVED (partially):** the shipped JS bundle contains `accessibility` and
  `fontSize` feature flags/handlers, consistent with a for-the-visually-impaired display mode
  (larger type / high contrast toggle), a near-universal feature on CIS government portals. I did not
  render the page in a live browser to screenshot the toggle in action this session, so treat the
  *existence* of the control as OBSERVED-from-code but its exact behaviour as unverified.

**Why `gov.uz` and `digital.uz` share pixel-identical CSS variables:** UZINFOCOM's own materials state
the unified government-portal platform first launched **1 January 2023**; Resolution 54 (Jan 2025)
then made migration onto it *mandatory* for every remaining state body from March 2025. `digital.uz`
and `gov.uz` are two tenants of the same platform build — which is exactly why `--color-primary:
#013d8c`, `--color-secondary:#707070`, `--color-text-primary:#043b87`, `--color-border:#e1e1e1`, and
the Montserrat/Mantine stack appear byte-for-byte identically in both. **This is the single most
useful fact in this report**: those four tokens are not "the ministry's brand" so much as **the
default design system every migrated Uzbek government website now inherits.** Expect most `*.uz`
government sites built or rebuilt after 2023 to carry this exact palette.

**No separate published "gov design system" document** (a Figma kit, a component library site, a
design-tokens repo) was found; the design system exists only as this shipped CSS, discovered by
inspection rather than by documentation.

---

## 4. IT Park, UZINFOCOM, "Digital Uzbekistan 2030," and "Yangi Oʻzbekiston"

**IT Park Uzbekistan** (`it-park.uz`) — the state-linked tech-park/free-economic-zone authority for
IT companies, tagline "START local & GO global," splitting its audience between local firms
(`it-park.uz`) and foreign outsourcing clients (`outsource.gov.uz`). **No public brand book or
media-kit page was found.** OBSERVED CSS gives a **completely different palette family from the
government-blue default**: a vivid red/magenta **`#ff214f`** as the dominant accent (repeated 69
times in the main stylesheet), paired with greens **`#7dba28` / `#7dba29` / `#1a940a`**. This reads as
a deliberate "startup," not "ministry," identity — IT Park visually distances itself from the navy
government aesthetic on purpose. Typography, OBSERVED: **Montserrat** (body), **Comfortaa** (a
rounded, geometric display face used for headings/wordmark — Google-hosted), **IBM Plex Mono**
(technical/code accents), and **Roboto**.

**UZINFOCOM** (`uzinfocom.uz`) — state unitary enterprise under the Ministry of Digital Technologies,
founded 2002, ~1,400 IT staff (OBSERVED via site fetch). It runs the `.uz` domain registry, national
data centres, and — per §3 — operates the unified `gov.uz` platform itself. OBSERVED CSS: primary deep
blue **`#074196`**, supporting blues **`#095e9e` / `#2155A1` / `#568BD8`**, and a warm **orange accent
`#EF7F1A`** — a navy+orange duotone, noticeably more saturated/corporate than the pale government
navy, built on Tailwind/shadcn conventions (HSL custom properties) with a Next.js font loader whose
actual family name did not resolve from static CSS alone (very likely Inter, given the shadcn
scaffolding, but unconfirmed).

**"Digital Uzbekistan – 2030"** — the national digital-transformation strategy. **UNVERIFIED THIS
SESSION:** general knowledge (not confirmed against a live primary source this session, since search
was blocked and `digital.uz/en/pages/laws` renders no document list to a static fetch) holds this was
approved by Presidential Decree No. PF-6079 on 5 October 2020. Re-verify the decree number and date on
`lex.uz` before citing it as fact anywhere official.

**"Yangi Oʻzbekiston" ("New Uzbekistan")** — the reform brand associated with President Mirziyoyev's
program since around 2016–2017, formalised in a multi-year development strategy. **UNVERIFIED THIS
SESSION:** general knowledge points to a "Development Strategy of New Uzbekistan for 2022–2026"
approved around January 2022 (commonly cited as Decree No. PF-60), but no Wikipedia page exists under
this title and the live fetch attempts against `digital.uz` did not surface a citation, so this must
be re-checked before use. No dedicated colour palette or logo for "Yangi Oʻzbekiston" as a *visual*
brand (as opposed to a policy slogan) turned up in any source reachable this session — it appears to
function as rhetoric/political framing rather than a maintained visual identity with its own hex
values. **Recommendation: do not try to "use the Yangi Oʻzbekiston brand" in WorkPortal — it does not
appear to exist as a design system to borrow from.**

---

## 5. Fonts used by official Uzbek digital products, and Uzbek-Latin glyph support

Observed font stacks, by site, this session:

| Site | Fonts (OBSERVED) |
|---|---|
| `gov.uz` / `digital.uz` | Montserrat (via Mantine UI) |
| `my.gov.uz` | no distinct custom family resolved from the fetched CSS chunks (generic `sans-serif` fallback visible; likely loads a heading font elsewhere in the SPA shell that a static fetch didn't capture) |
| `id.egov.uz` (OneID) | **Golos Text**, and a custom-named **"Inter ID Card"** (an Inter-family build) |
| `it-park.uz` | Montserrat, **Comfortaa**, IBM Plex Mono, Roboto |
| `egov.uz` (legacy portal) | self-hosted **Roboto** (400/500/700) + **IBM Plex Sans** (400/500/700) + Material Icons |
| `uzinfocom.uz` | unresolved Next.js `var(--font-sans)`, framework is shadcn/Tailwind (Inter is the shadcn convention default) |
| `diia.gov.ua` (comparator) | bespoke **"e-Ukraine"** / **"e-Ukraine Head"** typeface, commissioned specifically for the Ukrainian government and released open-source |

**The Oʻ / Gʻ / ʼ problem, in plain terms:** correct Uzbek Latin orthography uses proper Unicode
*modifier letters* — U+02BB (MODIFIER LETTER TURNED COMMA, ʻ) for the Oʻ/Gʻ digraphs and U+02BC
(MODIFIER LETTER APOSTROPHE, ʼ) for the *tutuq belgisi* (glottal-stop mark) — not the plain ASCII
apostrophe (`'`), a curly right single quote (`'`), or a backtick, all of which get substituted in
practice across Uzbek government and commercial software alike. This is a well-documented, ongoing
practical headache for Uzbek digitization (search, sort, and string-matching all break when
`Oʻzbekiston`, `O'zbekiston`, and `Oʼzbekiston` are treated as three different strings), and it is a
**font/glyph-coverage issue as much as a data-entry issue**: a font that is missing the Spacing
Modifier Letters block (U+02B0–02FF) will render those characters as a missing-glyph box or a wrong
lookalike, and a self-hosted legacy webfont subset (like `egov.uz`'s trimmed local `Roboto`/`IBM Plex
Sans` `.eot`/`.woff` files) may well have been subset down to exclude it, even though the full Google
Fonts release of the same family supports it. Fonts observed here that are documented (general
knowledge, not re-verified live this session because Google Fonts specimen pages are JS-rendered and
returned no character-map data to a text fetch) to have strong Cyrillic **and** Latin-Extended /
modifier-letter coverage: **Inter, IBM Plex (Sans/Mono/Serif), Noto Sans, PT Sans/PT Serif, and Golos
Text.** **Montserrat is historically a Latin-only geometric sans**; Google Fonts has extended some
weights to Cyrillic in recent variable-font updates, but given it is the *default body font of the
entire `gov.uz` platform family* serving Russian-language routes (`/ru`), WorkPortal should not assume
Montserrat's Cyrillic coverage is complete without testing the specific served subset — this is a
concrete, checkable risk, not a hypothetical one, since `gov.uz` itself ships a `/ru` locale on this
exact font.

**Practical recommendation:** whichever body font WorkPortal picks, test it by rendering the literal
strings "Oʻzbekiston," "gʻoʻza," and a Cyrillic Russian paragraph at the intended weight/size before
committing — don't infer glyph coverage from the font's name or popularity.

---

## 6. Comparative note: Kazakhstan eGov, Russia Gosuslugi, Ukraine Diia

This session could only get OBSERVED CSS for one of the three (Diia); the other two are qualitative,
clearly marked.

- **Kazakhstan eGov (`egov.kz`)** — **unreachable this session** (connection timeout from this
  network for the full session; not a WorkPortal-relevant finding, just a gap). Qualitatively, and
  without a live source to cite, `egov.kz` is broadly known as a conservative, blue-and-white,
  document/service-catalogue-first portal — closer to the "bureaucratic-serious" end of the spectrum
  than to a consumer-app aesthetic. Do not cite specific hex values for it from this report.

- **Russia Gosuslugi (`gosuslugi.ru`)** — the live fetch was served an **anti-bot JavaScript
  challenge page** (`/__jsch/static/script.js`) rather than the real site, so no OBSERVED CSS could be
  captured; the `Lato` font string seen in the raw response almost certainly belongs to the challenge
  page's own shell, not to Gosuslugi's real UI, and should not be reported as Gosuslugi's brand font.
  Per Wikipedia (OBSERVED from that article, not from the live site): the portal launched 15 December
  2009, is run under Rostelecom direction, and served roughly 11 million visits/day in 2023 — it is a
  high-traffic, high-density service directory. Design details were not available from the article.

- **Ukraine Diia (`diia.gov.ua`)** — the clearest "modern" outlier of the three, and the one with
  OBSERVED CSS in hand: primary brand colours **`#EE2F53`** (a saturated magenta-red) and **`#0066B3`**
  (blue), with a set of softer supporting tones (`#C3AAB2` dusty rose, `#80C0C8` teal, `#4B8BFA` sky
  blue) consistent with Diia's known multicolour "diamond" logo — a deliberately *product-branded*,
  consumer-app-style mark rather than a coat-of-arms-derived one. Most distinctively, Diia is built on
  a **bespoke, purpose-designed, open-source government typeface ("e-Ukraine" / "e-Ukraine Head")** —
  no other portal in this report commissioned its own type family. That single decision is probably
  the biggest lever available for making a government product feel "designed" rather than "issued."

**The spectrum, restated as a design lesson:** Kazakhstan/older-generation Russian portals sit at the
"conservative-bureaucratic" end (blue, dense, document-forward); the `gov.uz` platform family sits
just inside that same end but with a cleaner, better-typeset execution (Mantine + Montserrat is a
legitimately contemporary component system, even if the palette is safe); Diia sits at the
"venture-grade product" end — bright, own typeface, mobile-first, openly breaking from "official"
visual conventions while still being unmistakably a state service. **"Serious yet modern" for
WorkPortal should land between the `gov.uz` execution and Diia's confidence**: keep the restraint and
the institutional palette discipline of the former, but borrow Diia's willingness to own a distinct,
non-default typographic and colour identity rather than defaulting to "government blue plus Bootstrap
red/green/amber," which is what several of the sites audited here (Diia included, underneath its
brand colours) still fall back on for status chips.

---

## 7. Recommendation for WorkPortal

**Principle:** WorkPortal is an *internal* department tool, one tier below the national portal and
the ministry's own public site in the "who gets to use the state emblem" hierarchy established in
§2 — so it should carry **a ministry mark plus exactly one official accent**, never the full
government palette as its own identity, and never flag colours as UI chrome (blue+white+green+red
together reads as "this is the state," which is a claim WorkPortal shouldn't make for an internal
tracker). Concretely:

- Show the ministry's name/wordmark (not the state emblem) in the product's header — WorkPortal is a
  ministry tool, not a national portal, so the coat-of-arms tier from §2 doesn't apply to it.
- Reserve the ministry's **official** navy `#013d8c` (OFFICIAL/OBSERVED, §1) for exactly one small,
  fixed location — a header hairline, a footer credit line, or a small "official ministry system"
  badge — verbatim, unmodified. Never use it as a fill for large surfaces, primary buttons, or
  anything that competes with WorkPortal's own brand colour for attention.
- Give WorkPortal **its own** primary/brand colour, distinct in hue or saturation from `#013d8c`, so
  the product cannot be mistaken for `gov.uz`, `my.gov.uz`, or any other tenant of the shared
  government platform in §3.
- Keep status colours (success/warning/danger) semantically separate from the brand colour — several
  of the audited sites (including the `gov.uz` family itself, with its `#048708` green and `#cc950f`
  amber) already do this, and it avoids the trap of "primary colour happens to also mean success."
- Do not attempt to reuse "Yangi Oʻzbekiston" as a visual brand (§4) — it does not appear to have one.

Below are three PROPOSED palettes, each reconciling the supervisor's prototype mood (`docs/00-reference/reference-site-audit.md`:
warm paper `#f4f2ed`, deep green primary `#315b4c`, dark-forest sidebar `#19362e`, amber accent
`#d8a35e`) with the ministry's official navy `#013d8c` per the rule above. All values below were
computed with a verified sRGB→OKLab→OKLCH conversion (not estimated), so the OKLCH and hex columns are
exact conversions of each other.

### Palette A — "Paper & Forest, Ministry Trim" (closest to the current prototype mood)

Keeps the prototype's green as WorkPortal's own brand colour (continuity with what the supervisor
already approved as "the mood to keep"); the ministry navy appears only as a single institutional
accent.

| Token | OKLCH | Hex | Role |
|---|---|---|---|
| background | oklch(97.0% 0.008 88) | `#f7f5ef` | warm paper, slightly cleaner than prototype |
| foreground | oklch(26.0% 0.020 160) | `#1c2721` | body text |
| card | oklch(99.0% 0.000 0) | `#fcfcfc` | surfaces |
| border | oklch(90.0% 0.008 90) | `#e0ded8` | hairlines |
| muted | oklch(94.0% 0.008 90) | `#edebe5` | subtle fills |
| **primary (product)** | oklch(42.0% 0.060 165) | `#2a5745` | WorkPortal's own deep green — brand, primary buttons |
| accent | oklch(93.0% 0.020 165) | `#dcece4` | pale green tint, selected states |
| ring | oklch(63.0% 0.050 165) | `#6d9382` | focus ring |
| destructive | oklch(52.0% 0.150 27) | `#af3d36` | errors |
| sidebar | oklch(29.0% 0.035 172) | `#183129` | dark forest sidebar |
| sidebar-primary (wayfinding) | oklch(74.0% 0.110 72) | `#d69f58` | amber — sub-department/active-item accent |
| **official accent (verbatim)** | oklch(38.0% 0.143 258.6) | `#013d8c` | ministry navy — header hairline / footer credit / "official system" badge **only** |

### Palette B — "Navy-led, Product-owned Blue" (for a more overtly "official-feeling" tool)

Demotes green to a pure semantic "success" colour and gives WorkPortal its own navy — deliberately
*not* the ministry's exact hue/chroma, so it reads as "in the government blue family" without
literally being `gov.uz`'s token.

| Token | OKLCH | Hex | Role |
|---|---|---|---|
| background | oklch(97.0% 0.007 88) | `#f7f5f0` | warm paper, kept from prototype |
| foreground | oklch(24.0% 0.015 240) | `#192026` | body text, cooler than Palette A |
| card | oklch(99.0% 0.000 0) | `#fcfcfc` | surfaces |
| border | oklch(90.0% 0.006 90) | `#dfdeda` | hairlines |
| **primary (product)** | oklch(40.0% 0.090 250) | `#1b4a76` | WorkPortal's own navy — distinct hue/chroma from `#013d8c` |
| success (semantic only) | oklch(55.0% 0.130 152) | `#22864a` | status chips, not brand |
| sidebar-accent (wayfinding) | oklch(74.0% 0.110 72) | `#d69f58` | amber, reused from Palette A for continuity |
| destructive | oklch(52.0% 0.150 27) | `#af3d36` | errors |
| sidebar | oklch(22.0% 0.050 252) | `#071b31` | near-black navy, product's own dark surface |
| **official accent (verbatim)** | oklch(38.0% 0.143 258.6) | `#013d8c` | ministry navy — one accent location **only** |

### Palette C — "Slate Bridge" (cooler, more restrained; least warmth, most gravitas)

A genuine hue *between* the prototype's green (~168°) and the ministry's navy (~259°) — a teal-slate
around 205° — used as the single primary, with warmth reduced almost to neutral. Best if leadership
wants less "editorial/cozy" and more "instrument panel."

| Token | OKLCH | Hex | Role |
|---|---|---|---|
| background | oklch(97.0% 0.003 90) | `#f6f5f3` | near-neutral paper, cooler than A/B |
| foreground | oklch(22.0% 0.010 250) | `#171b1f` | body text |
| border | oklch(89.0% 0.004 90) | `#dcdbd8` | hairlines |
| **primary (product)** | oklch(45.0% 0.050 205) | `#315d62` | teal-slate bridge hue — neither green nor navy |
| accent (minimal use) | oklch(70.0% 0.120 70) | `#ce9042` | amber, reserved for a single "needs attention" signal |
| destructive | oklch(52.0% 0.150 27) | `#af3d36` | errors |
| sidebar | oklch(20.0% 0.020 240) | `#0e171e` | near-black, cool |
| **official accent (verbatim)** | oklch(38.0% 0.143 258.6) | `#013d8c` | ministry navy — one accent location **only** |

**My suggestion:** start with **Palette A**. It changes the least about what the supervisor's
prototype already got right (§ "verdict for the build" in the reference audit — "keep the mood"),
while adding exactly the one ministry-navy touchpoint this report's brief asked for. Palette B is the
fallback if reviewers feel green reads as "not government enough"; Palette C is a lower-warmth option
worth keeping in reserve rather than shipping first.

---

## Sources

- gov.uz — homepage and six CSS bundles fetched directly: https://www.gov.uz
- digital.uz (Ministry of Digital Technologies) — homepage, `/en/pages/about`,
  `/en/pages/history_of_the_ministry`, `/en/pages/strategy`, `/en/pages/laws`: https://digital.uz
- my.gov.uz — homepage and CSS chunks (`entry`, `Main`, `Logo`): https://my.gov.uz
- id.egov.uz (OneID) — homepage and CSS bundle: https://id.egov.uz
- it-park.uz — homepage (`http://www.it-park.uz/uz`) and CSS bundles (`main.css`, `libs.css`): https://it-park.uz
- egov.uz — homepage, CSS bundles, and self-hosted font stylesheet: https://egov.uz
- uzinfocom.uz — homepage (`/en`) and CSS bundles: https://uzinfocom.uz
- diia.gov.ua — homepage and combined CSS bundle (comparator): https://diia.gov.ua
- gosuslugi.ru — homepage fetch (returned anti-bot JS challenge, not the real site): https://www.gosuslugi.ru
- egov.kz — unreachable this session (Kazakhstan comparator, connection timeout): https://egov.kz
- Cabinet of Ministers Resolution No. 54 (31 Jan 2025), on unified state-body websites: https://lex.uz/uz/docs/-7354510
- Related coverage confirming the unified-platform mandate: https://digital.uz/news/view/34939 ,
  https://www.norma.uz/oz/qonunchilikda_yangi/davlat_organlarining_barcha_rasmiy_saytlari_-_yagona_platformada ,
  https://yuz.uz/uz/news/barcha-davlat-organlari-va-tashkilotlarining-veb-saytlari-endi-govuz-platformasida-yuritiladi
- Flag of Uzbekistan (Law No. 407-XII, 18 Nov 1991) — colour/geometry description: https://en.wikipedia.org/wiki/Flag_of_Uzbekistan
- Coat of Arms / State Emblem of Uzbekistan (Law No. 616-XII, 2 Jul 1992): https://en.wikipedia.org/wiki/Coat_of_arms_of_Uzbekistan
- Diia (Ukraine) overview: https://en.wikipedia.org/wiki/Diia
- Gosuslugi (Russia) overview: https://en.wikipedia.org/wiki/Gosuslugi
- Project reference audit of the supervisor's prototype palette (internal):
  `docs/00-reference/reference-site-audit.md`

### Not found / could not verify this session (do not cite as fact without re-checking)
- A published Ministry of Digital Technologies brand book, style guide, or presentation template.
- A published IT Park Uzbekistan brand guideline / media kit.
- The exact decree number/date for the "Digital Uzbekistan – 2030" strategy (commonly cited elsewhere
  as Decree No. PF-6079, 5 Oct 2020 — unverified live this session).
- The exact decree number/date for the "Yangi Oʻzbekiston" ("New Uzbekistan") development strategy
  (commonly cited elsewhere as Decree No. PF-60, 28 Jan 2022 — unverified live this session), and no
  evidence that "Yangi Oʻzbekiston" has a maintained visual/colour identity distinct from being a
  policy slogan.
- Any explicit statutory clause restricting non-state use of the Uzbekistan state emblem (the
  restriction is a strong regional convention, not a confirmed clause in this session's sources).
- Live OBSERVED CSS for `egov.kz` (host unreachable) and the real (non-challenge-page) CSS for
  `gosuslugi.ru`.
