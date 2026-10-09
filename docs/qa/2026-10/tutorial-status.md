# Tutorial preparation and verified media capabilities

Recorded October 8, 2026. This is a preparation checkpoint, **not a completed video handoff**.
No production recording, finished primary tutorial, companion chapter, production narration,
whole-video listening or normal-speed playback is claimed.

## Updated user authorization

The main task received steering allowing English narration, use of the user's existing logged-in
production account, and Telegram/application AI demonstrations in the final tutorial. The user
wants filming only at the very end, after repairs are tested, committed, pushed and deployed.
This replaces the objective's original separate-demo-account and final-integration exclusions.
It does not permit changing colleagues' records, broadcasting to real groups, leaking contact
details/tokens, or production exploratory/destructive tests. Local integration tests retain their
explicit disabled/external-boundary policy.

## Durable editorial project

`tools/tutorial/` is isolated from the application workspace and runtime. It contains:

- `scenes.json`: 18 source-derived scene candidates; primary editorial target **330 seconds**,
  including a 7-second outcome-led hook, with advanced/head/admin/onboarding companions.
- `coverage/features-to-scenes.json`: **48 routes and 1,403 source surfaces** mapped to scene
  candidates from current manifests, four existing locale catalogs, and the main QA inventory.
  These are planning mappings, not executed browser coverage or final timestamps. Runtime
  applicability and exact final feature coverage must be reconciled after full local QA.
- `capture-plan.json` and `capture-journal.example.json`: actual production source/version,
  owned-safe records, private-data prevention, recording metadata and recorded-action evidence.
- `project.json` and `clip.example.json`: editable cut/asset/evidence manifest with missing values
  deliberately unqualified. No made-up recordings or timestamps are seeded.
- `scripts/editor.py`: executable deterministic FFmpeg editing/render pipeline; actual-source cuts,
  cosine-eased frame-based camera curves, evidence-bound callout boxes, a reserved caption band,
  actual font-width measurement and two-pass speech loudness normalization.
- `scripts/narrate.ps1`: local English Microsoft Zira speech synthesis, 48 kHz PCM mono; no network
  service, tokens, private data upload or additional voice-model installation.
- `scripts/inspect-render.py`: complete decoded-frame interval checks, codec/dimension probes,
  loudness/peak analysis, boundary frames and freeze candidates. It explicitly does not establish
  listening, complete playback or all-frame privacy review.
- `scripts/qualify.mjs` / `delivery-gate.mjs`: reject absent/mismatched release proofs, localhost or
  old-version footage, absent action/privacy evidence, changed hashed assets, and unverified final
  audiovisual/coverage reviews.
- `README.md` and `asset-licenses.json`: exact capture/render/inspection commands and asset rights.
  Existing Inter subsets were locally converted from WOFF2 to TTF; original OFL license included.

## Actual capability and validation evidence

| Check | Executed evidence | Status |
| --- | --- | --- |
| Encoding/probing | Installed FFmpeg/ffprobe **7.1**, H.264/AAC filters and frame inspection | Verified |
| Local image/font tools | Python 3.11, FontTools **4.62.1**, Pillow **12.2.0** | Verified |
| Voice metadata | Enabled **Microsoft Zira Desktop en-US** via System.Speech | Verified |
| Actual offline narration | Synthetic technical take generated using installed PowerShell Core **7.6.5**, PCM 48 kHz mono WAV, 927,838 bytes | Verified; naturalness/listening not claimed |
| Qualification regressions | Five Node tests: incomplete project refusal, localhost/fabricated click refusal, path escape refusal, unsafe scene-ID refusal, changed-file detection | Passed |
| Editing regressions | Five Python tests: timestamps, measured wrapping, asset traversal, deterministic camera curves, FFmpeg loudness JSON with trailing output | Passed |
| Real FFmpeg execution | Ignored `tools/tutorial/out/PipelineTest/TECHNICAL-ONLY.mp4`, explicit moving test pattern with “NOT PRODUCTION FOOTAGE”, English synthetic narration, captions and camera/callout filters | Rendered tooling test only |
| Technical sample probe | **1920×1080**, H.264/yuv420p, AAC, **30/1 fps**, **300 decoded frames**, every interval checked, 10 seconds | Passed |
| Sample loudness | **−16.13 LUFS**, **−1.45 dBTP**; no freeze candidates detected | Passed technical analysis only |
| Actual opened images | `boundary-000.png` and `boundary-001.png` opened and visually inspected: readable caption/test label, no accidental boundary crop | Verified technical sample pixels only |
| Production qualification | Current `project.json` has no real captures/release proof; qualifier exits 2 and lists missing evidence | Correctly blocked |
| Final live capture | Root must establish documented recording capability for existing authorized Chrome; no raw CDP, copied profile or desktop capture allowed | Pending; not inferred from local Playwright recording support |
| Final playback/listening | No complete final movie or narration exists yet | Not run |

## Provenance enforcement and safe equivalent pipeline

The initial isolated Remotion **4.0.534** install used only the official npm registry and did not
modify application dependencies. pnpm stopped at legacy transitive provenance downgrades
`undici-types@6.21.0` and `semver@6.3.1`. The flagged exact tarball integrity values match the
existing application's lockfile; both packages have no installation lifecycle scripts. This was
metadata investigation, not proof that arbitrary package execution is safe.

Automatic approval review rejected the attempted install after a second exception was considered.
The exact command was `pnpm install --dir tools/tutorial --registry=https://registry.npmjs.org/`.
The stated reason was that repeated provenance exceptions could permit unverified dependency
code execution following a possible package-takeover warning. Both exceptions were removed;
no retry or indirect provenance bypass was attempted afterward. No Remotion lockfile or working
Remotion installation was produced, and no rendering/Studio claim is made.

The objective explicitly allows an equivalent deterministic media pipeline. The working editor
therefore uses already installed FFmpeg/Python without any npm dependency, provenance waiver or
application runtime change. This resolves the tooling dependency without reducing the required
live-footage, narration, captions, rendering, coverage or audiovisual-review standards.

The first synthetic narration invocation used legacy Windows PowerShell and its script manager
refused execution. The installed/default PowerShell **Core** ran the same local script successfully;
execution policy was not changed or disabled. No speech/voice tooling limitation remains for
the user's approved English language, but listening quality still requires evidence.

## Remaining completion prerequisites

1. Complete full local visual/control/state tests and repairs, then the user-authorized commit,
   push and deployment. Verify that actual production carries that precise release.
2. Establish a documented production-browser recording capability with configured and probed
   genuine dimensions/frame rate. If the authorized Chrome runtime cannot record video, report
   that exact capability rather than assembling screenshots into a substitute.
3. Film complete permission-appropriate workflows using only owned safe examples. Reconcile
   head/admin access and containment from real authorization; do not assume the current account
   grants every role. Add verified action/outcome/privacy journals and exact labels.
4. Write, generate and review English narration, align caption cues to actual takes, edit and
   render the primary and necessary companion chapters, and generate real chapter/coverage maps.
5. Inspect the entire rendered package at normal speed, review audio intelligibility and
   pronunciation, examine boundaries/close-ups/all affected privacy frames, and revise/re-render.
   Objective codec/loudness checks alone cannot satisfy these reviews.

No additional routine permission is requested here. Production filming prerequisites are deferred
until the user's expressly requested end-of-project recording stage.
