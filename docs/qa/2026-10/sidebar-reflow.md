# Shared sidebar and account-menu reflow

Bounded evidence for `sidebar.tsx` and `sidebar-user-block.tsx`. This slice does not establish whole-platform completion. The actual synthetic seeded app, API and PostgreSQL run through the guarded `global-setup.ts` harness on `devon_flow_e2e_knowledge_nested`, API48921/web48922, with `FLOW_SEED_DEMO=1`. No production, external AI/Telegram/mail, commit, push, deployment or tutorial recording was performed by this agent.

## Observed defects and repairs

| Defect | Actual failing-before evidence | Repair |
| --- | --- | --- |
| Enlarged Inbox label overlaps its count | `sidebar-before`, Chromium, head, Uzbek Cyrillic/light,768×600,text200. Label range right314.73 crosses badge212.44–240. Native PNG inspected. | Keep the count's space and wrap the label within its flex column. Group labels also wrap. |
| Short viewport removes visible navigation | Same before run at768×480,text200: navigation scroller16px, entirely padding, no visible link. Native PNG inspected. | Reserve96px for the inner navigation and allow the whole sidebar to scroll when header/navigation/footer exceed the viewport. Native focus can reveal the account footer. |
| Login orphan at enlarged type | The same native before PNG displays the login's final character on a separate line. Existing emergency wrapping was retained. | Put secondary identity on a full-width row, preserving complete text while giving it more space. |
| Account menu clips its first action above the viewport | `sidebar-trial-corrected`, Chromium,en/light,360×225. Settled menu top−21; Home focuses clipped Profile settings. Native PNG inspected. | Limit this menu to Radix's available height, scroll its contents, use8px collision padding, bounded width and wrapping action labels. |
| WebKit skips ordinary sidebar links on native Tab | `sidebar-reflow-final` all8 WebKit cases stopped at1440×900 when Knowledge→Tab focused Management instead of Pages. `sidebar-focused-curation-after` records the exact sequence and confirms the actual anchor's tabIndex property0 and visible/non-inert/non-hidden ancestors. A separate native HTML comparison skips an ordinary anchor but reaches an explicit tabindex0 anchor in this installed WebKit. | Declare tabIndex0 on shared SidebarItem links. `sidebar-explicit-focus-webkit` now passes all8 complete affected cases with native Tab→Pages. No platform preference or Safari claim is inferred. |
| Russian FAQ heading crosses320px at enlarged type | Actual `sidebar-russian-text-overflow-before` glyph range right321.92 and document322 while every element box stayed bounded. The drawer obscures the before heading, so that PNG is not unblurred heading proof. | FAQ wrapper uses overflow-wrap:anywhere. Current all3 probes fit; all3 native after heading PNGs were inspected in the focused supplemental run. |

All before files remain in ignored `artifacts/qa/2026-10/results/platform/`; exact paths and assertions belong to the evidence overlay. The first `sidebar-trial` failed because the QA harness read `me.locale` instead of the actual `me.user.locale` response. A later trial hit Chromium `ERR_NO_BUFFER_SPACE` during reload; that interrupted result is not counted as a product failure or a passing gate. Menu-action waits and the actual `/login?signedOut=1` route were corrected in the harness separately from product fixes.

## Current verification

The complete affected matrix has24 distinct locale/theme cases across two runs:16 Chromium/Firefox cases in `sidebar-reflow-final` and8 WebKit cases after explicit tab order in `sidebar-explicit-focus-webkit`. The earlier run also includes3 passing Russian narrow probes and8 failing-before WebKit cases; it is accurately19passed/8failed, not a wholly passing27-case run. Chrome/Firefox geometry/menu/persistence evidence predates only the explicit tabIndex attribute. A fresh focused native focus check on current source is tracked separately in the overlay. All24 complete cases cover144 scoped axe checks with zero violations and zero pageerrors. Fresh shared sidebar/shell units pass20/20; current web typecheck passed. Fresh scoped lint/format results are recorded in the overlay.

`sidebar-focused-curation-after` passed9/9 across all3 engines:3 native focus diagnostics,3 short-menu supplemental cases and3 unrelated card-gallery discoverability cases. Each short-menu case covers all4locales/light at360×225, native End brings Sign out into the bounded menu, Escape restores its opener, and Shortcuts opens/closes. It records zero console errors/pageerrors with the parent's repaired shortcut-overlay keys loaded. The same run adds native unobscured Russian FAQ320×480/text200 heading pixels. It does not cover dark supplemental End screenshots or establish every shortcut's behavior.

The matrix has eight locale/theme cases in each of Chromium, Firefox and WebKit. Each case exercises1440×900,text100;768×600,text200;768×480,text200;390×480,text200;320×480,text200;360×225,text100. The last represents desktop400% CSS reflow equivalence, not browser zoom. Assertions cover Inbox text/count separation, at least88px inner navigation, document width, scoped WCAG axe, native group Enter/Tab to Pages, loaded real route/current-entry retention while folded, stored folds, account footer focus, menu bounds/Home/End/Escape and opener focus, actual profile navigation plus independent locale read. One affected fold and the collapsed64px rail are reloaded; the rail tooltip and expansion are exercised. Shortcuts and actual sign-out/read401/reload are exercised at the final short viewport.

Native capture manifests start with `pixelInspected:false`. Capture generation alone does not establish pixel review. `sidebar-pixels.json` separately records the36 inspected original-pixel comparison sheets,288 source images,3 original-pixel four-locale End-menu sheets and3 native FAQ heading PNGs. Sidebar sheets show the complete264px captured column; menu sheets preserve the left264px region containing the bounded menu, not the whole-page background. At short enlarged layouts the initial viewport shows part of the scrollable column; the successful native navigation/account journeys establish reachability. The short menu internally scrolls: initial Profile and focused End/Sign out are different scroll positions. No claim that every action is simultaneously visible at225px height is made.

## Reproduction

Every PowerShell invocation must explicitly set the isolated namespace and ports; a previous shell's environment does not carry into the next command.

```powershell
$env:FLOW_DB_NAME='devon_flow_e2e_knowledge_nested'
$env:FLOW_API_PORT='48921'
$env:FLOW_WEB_PORT='48922'
$env:FLOW_SEED_DEMO='1'
$env:QA_RUN_ID='sidebar-explicit-focus-webkit'
pnpm --filter @devon/web exec playwright test --config test/e2e/platform-qa.config.ts platform-sidebar.qa.spec.ts --grep 'sidebar matrix'
pnpm --filter @devon/ui test:unit src/shell/sidebar.test.tsx src/shell/shell-pieces.test.tsx
```

## Unclaimed scope

Unlisted control states remain pending, including every group/destination, membership and department switching, large live counts, storage-denied persistence, touch scrolling and physical devices, system-theme preference transitions, reduced motion, actual browser zoom, super-admin/member runtime matrices and every sidebar tooltip. Only Knowledge group, Inbox/Pages links and Inbox rail tooltip are bound to the generic source signatures. Root owns shortcut-overlay, header InboxBell/topbar and other shell surfaces. Unit permissions/count behavior is distinct from real runtime role/count proof. This slice performs no release or video action.
