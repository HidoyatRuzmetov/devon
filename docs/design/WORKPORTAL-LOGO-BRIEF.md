# WorkPortal logo asset brief

Status: production brief for concept generation and subsequent vector finishing. No new logo is installed by this document.

## The product and the job of the mark

**WorkPortal** is an internal workspace for a public institution: people and units, individual task cards, group projects and milestones, knowledge pages, events, and a contextual assistant. It helps colleagues see responsibilities clearly and work together with confidence. The brand should feel calm, capable, welcoming and durable. It must belong to the product, while sitting naturally in a ministry environment.

The public-facing name is exactly **WorkPortal**: uppercase W and P, no space. “Devon” is the repository codename and must not appear in the asset. The institution credit is separate interface text, never part of the logo artwork. This is a product identity, not an official government emblem or a certification mark.

Primary placements: the top of a dark navy sidebar, a small collapsed-sidebar icon, sign-in screens, browser favicon, installed-app icon, and documents. Recognizability at small sizes matters more than decorative detail.

## Chosen direction: an open portal with a shared foundation

Create one compact geometric symbol. A thick inverted-U frame suggests an open doorway. Inside its lower portion, a quiet, shallow W-shaped foundation suggests individual work meeting in one shared place. Frame and foundation must read as a single deliberate silhouette, with a broad open interior. The doorway is the first impression; the subtle W is the second, not a lettering puzzle.

Use only a small number of solid shapes and consistent visual weight. Aim for a near-square optical footprint, an upright stance, restrained rounded outer corners, and generous negative space. The lower form must not become a checkmark, arrow, mountain, crown, three-person pictogram, or bar chart. Do not add a literal door, handle, perspective lines or a floating dot. If the subtle W cannot survive the smallest-size test, simplify the interior rather than add more elements.

This direction expresses access, shared structure and forward work without illustrating every product feature. The portal opening creates figure/ground clarity; repeated weight and aligned edges create unity; the uncomplicated silhouette supports quick recognition. These are design intentions to verify in the output, not a guarantee that a generator will achieve them.

## Shape and optical requirements

- Draw as flat filled geometry, not a thin outline icon. Keep the main strokes optically equal in weight; approximately one-eighth of the symbol width is a starting point, not an inflexible grid.
- Keep the portal opening and all internal gaps open at 16 px. No critical gap may collapse into an antialiased hairline. The small-size variant may widen gaps and simplify joins while preserving the silhouette.
- Use one corner-radius family. Avoid sharp ornamental points, tiny notches and multiple nested frames.
- Center by visual mass, not only the bounding box. The horizontal and vertical versions must look balanced beside type.
- Preserve a clear silhouette in solid black, reversed white, low-resolution display and ordinary office printing. Color must not be necessary to identify it.
- Do not enclose the master symbol in an app tile. A container is added only for installed-app assets.

## Color and typography

Use the existing product palette from [`DESIGN.md`](../../DESIGN.md), rather than introducing a new brand palette.

| Asset                        | Color                   | Background                                                        |
| ---------------------------- | ----------------------- | ----------------------------------------------------------------- |
| Standard symbol and wordmark | Product navy `#1B4A76`  | Transparent; ordinarily warm paper `#F7F5F0` or surface `#FCFCFC` |
| Reversed symbol and wordmark | Surface white `#FCFCFC` | Transparent; ordinarily sidebar navy `#071B31`                    |
| Single-color print version   | Solid black             | White or transparent                                              |

No gradient, translucent brand strokes, shadows, glow, texture, gold finish, bevel or 3D rendering. Green, amber and red already communicate status in the app and should not become logo accents. Do not use the ministry's reserved `#013D8C` token for this product symbol. Do not reproduce or suggest government seals, flags, heraldry, or existing institutional marks.

The wordmark is **WorkPortal**, set separately by a designer/developer using the already self-hosted **Inter SemiBold (600)**. This pairs a clear UI-oriented product name with the app's serif page headings. Set the two parts as one word in one weight and one color; do not emphasize “AI” or add a tagline. Use normal title casing, carefully inspect the `kP` join, and tune spacing optically without squeezing letters. Keep a live-text master and an outlined distribution version, with the font license retained.

Do not rely on image generation to produce final spelling or typography. The generator creates the symbol only. Typeset the wordmark after the symbol is approved.

## Lockups, spacing and minimum sizes

Let **S** be the visible symbol height. For the initial horizontal lockup, use a gap of about `0.30 × S` and a wordmark capital height of about `0.55 × S`; adjust optically after viewing at actual sidebar size. Center the type's visible letterforms against the symbol, not the text element's line box. Reserve at least `0.25 × S` clear space around the full lockup. Never stretch, rotate, crop or change symbol-to-type proportions independently in a saved lockup.

- Full wordmark lockup: preferred for the expanded sidebar and sign-in. Start at a 28–32 px symbol height; verify at 24 px before approving a minimum.
- Symbol alone: collapsed sidebar, favicon and app icon. Inspect actual raster outputs at 16, 20, 24, 32 and 48 px. Use the optically simplified small-size master where needed.
- Mobile and constrained surfaces: use the symbol, or the intact horizontal lockup if it fits with clear space. Do not truncate the name.
- Installed app: put the symbol on the product-navy background with generous safe-area padding. Keep the meaningful artwork within the platform maskable-icon central safe area. Produce this from the finished vector, not a separate generated drawing.

These initial measurements are review targets. Final approved minimum sizes and spacing must be recorded after the real-size checks, not inferred from a large mockup.

## Copy-paste image-generation prompt

Generate one image per call, with **transparent_background: true**. This is a new symbol: do not supply unrelated reference logos. A rendered preview is a concept, not the final vector asset.

> Create a single original professional product-logo symbol for WorkPortal, an internal operations workspace used by colleagues in a public institution. Generate the SYMBOL ONLY, with no text, letters as typography, tagline, mockup, dimensions, labels, presentation board or additional variants. The chosen concept is a calm open portal with a shared foundation: one compact near-square upright mark, a thick inverted-U doorway frame with restrained rounded outside corners, a broad open interior, and a subtle shallow W-shaped geometric foundation in its lower portion. Unify the frame and foundation into one deliberate silhouette. The doorway should read immediately; the subtle W is a secondary discovery. Use very few filled shapes of optically consistent weight, generous negative space, clean edges and balanced visual mass. Keep all gaps broad enough to survive a 16-pixel favicon. The feeling is reliable, organized, human and quietly distinctive. Use only solid product navy #1B4A76 on a truly transparent background. Flat two-dimensional vector-like artwork, centered, front view, generous empty margin. No gradients, shadows, lighting, texture, bevels, perspective, 3D effects, border tile or colored background. No government seal, flag, crest, shield, checkmark, up arrow, crown, mountains, people silhouettes, network nodes, AI sparkles, speech bubbles or literal door hardware. Avoid resemblance to existing technology or ministry logos. Deliver one coherent clean symbol with no stray marks. Prefer clarity and a memorable silhouette over decoration.

If the first result is too complex, refine the same concept: remove small details, widen negative space and simplify joins. Do not ask for many unrelated directions in the same image. To inspect reversed contrast, recolor the approved geometry in the vector finishing stage; do not regenerate a different symbol.

## Deliverables after approval

1. Editable vector master with simple filled paths, correct viewBox, no embedded raster image, no script, filters or external references. Preserve an editable construction copy separately.
2. Optimized SVGs: symbol, horizontal wordmark lockup, each in navy, reversed white and black. Check the optimized files against the master for geometric changes.
3. Transparent PNG exports from the vector at 1024, 512, 192, 48, 32 and 16 px; retain actual transparency and inspect edge pixels on both light and dark backgrounds.
4. Browser favicon assets and platform app icons generated from the same approved masters, including the separately padded maskable asset where the application needs it.
5. A one-page usage sheet showing exact colors, clear space, verified minimum sizes, permitted backgrounds and forbidden distortion. Include real-size sidebar and mobile placements.

Suggested file stem: `workportal-symbol-navy.svg`, `workportal-symbol-reversed.svg`, `workportal-wordmark-navy.svg`, `workportal-wordmark-reversed.svg`, plus clearly named `small` and `maskable` variants only when they are necessary. Do not call a PNG embedded in an SVG a vector master. Generated artwork requires vector reconstruction and optical review before production.

## Acceptance checks

- [ ] Exact product spelling in the separately typeset lockup; no invented lettering or tagline.
- [ ] Symbol recognizable in black and reversed white without relying on color.
- [ ] Portal opening and interior remain clear at 16 px and at 100% browser zoom; no merged gaps or uneven raster weight.
- [ ] 24–32 px sidebar lockup is balanced, unclipped and legible beside the existing brand subtitle; collapsed sidebar uses the symbol without a squeezed wordmark.
- [ ] Readable on warm paper and dark navy; inspect grayscale and reduced-contrast display conditions as practical robustness checks.
- [ ] No accidental resemblance to a shield, certification seal, warning, status icon or another brand. Run a separate similarity/trademark review before adopting the mark; originality cannot be guaranteed by a prompt.
- [ ] One consistent geometry across all lockups and exports; no AI-generated variant drift.
- [ ] SVG contains genuine paths only and transparent PNGs contain alpha, not a painted checkerboard.
- [ ] Clear space survives app padding and platform icon masks. No actual-size clipping or detail loss.
- [ ] Accessible UI usage supplies the name “WorkPortal” where the logo is a navigation control; decorative duplicates have empty alternative text. Do not use the logo alone to communicate status.

## Principle references

These sources inform clear space, consistent lockups, optical alignment and positive/reversed use. They are not sources of shapes to copy, and their organizations' own identity rules do not apply to WorkPortal.

- [IBM Design Language: logo construction, clear space and application](https://www.ibm.com/design/language/ibm-logos/8-bar/)
- [GOV.UK Brand: logo system and wordmark roles](https://brand.design-system.service.gov.uk/logo-system/)
- [UK Space Agency: logo integrity and monochrome application](https://www.gov.uk/government/publications/uk-space-agency-communications-resources/branding-guidelines)
- Local authority for palette and application: [`DESIGN.md`](../../DESIGN.md).
