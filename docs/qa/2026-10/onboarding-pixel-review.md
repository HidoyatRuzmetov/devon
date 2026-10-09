# Independent onboarding pixel review

The local-services reviewer opened the original PNGs with original detail, inspecting all four frames in each sheet: the desktop header/main area for member and super-admin, and the complete 320-pixel, enlarged-text member and super-admin pages. The desktop crop excludes the sidebar. This is independent pixel review of the captured states, not additional interaction or API proof.

All 24 files below were actually opened. The first twelve were reviewed before the performance diagnostic; the remaining Firefox dark and WebKit sheets were opened after it. The containing path is `artifacts/qa/2026-10/results/platform/shared-recovery-all-themes/pixel-review/`.

| Engine | Theme | Opened original files |
| --- | --- | --- |
| Chromium | Light | `onboarding-chromium-light-en.png`, `onboarding-chromium-light-ru.png`, `onboarding-chromium-light-uz-Latn.png`, `onboarding-chromium-light-uz-Cyrl.png` |
| Chromium | Dark | `onboarding-chromium-dark-en.png`, `onboarding-chromium-dark-ru.png`, `onboarding-chromium-dark-uz-Latn.png`, `onboarding-chromium-dark-uz-Cyrl.png` |
| Firefox | Light | `onboarding-firefox-light-en.png`, `onboarding-firefox-light-ru.png`, `onboarding-firefox-light-uz-Latn.png`, `onboarding-firefox-light-uz-Cyrl.png` |
| Firefox | Dark | `onboarding-firefox-dark-en.png`, `onboarding-firefox-dark-ru.png`, `onboarding-firefox-dark-uz-Latn.png`, `onboarding-firefox-dark-uz-Cyrl.png` |
| WebKit | Light | `onboarding-webkit-light-en.png`, `onboarding-webkit-light-ru.png`, `onboarding-webkit-light-uz-Latn.png`, `onboarding-webkit-light-uz-Cyrl.png` |
| WebKit | Dark | `onboarding-webkit-dark-en.png`, `onboarding-webkit-dark-ru.png`, `onboarding-webkit-dark-uz-Latn.png`, `onboarding-webkit-dark-uz-Cyrl.png` |

The captured role-specific message and primary action agree: members without membership are guided to Departments; the super-admin is guided to Administration. Header controls and localized demo labels fit. The long Uzbek Cyrillic demo label wraps to two complete lines. The cards' titles, descriptions and action labels remain contained in both themes, including the long Russian administrative action and enlarged text. No lost card text, clipped action, overlapping header control or additional actionable containment defect was observed in these frames. Decorative illustration strokes are intentionally muted; their detail is not required to identify the next action.

At 320 pixels with enlarged text, the large greeting takes several lines and pushes the onboarding action below the initial viewport. Long words use emergency wrapping. This is a readability/density observation, not a demonstrated inaccessible action. The fixed bottom navigation appears at the viewport-height position within the full-page screenshots and overlays part of the greeting/date there; pixels alone do not establish permanent lost text because the page scrolls. Scroll reachability and native focus remain the executing parent's browser assertions. Firefox and WebKit show faint greeting text behind the translucent fixed navigation, while Chromium's captured navigation looks more opaque; the visible navigation labels remain legible.

The review does not cover uncaptured data, other widths, real device magnification, live loading transitions, the excluded desktop sidebar, or all platform routes. The parent's 24-case browser result is separate executed evidence.
