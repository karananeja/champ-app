# CR-08 — Icons on the app's bottom tabs

| | |
|---|---|
| Raised | 2026-10-12 by the user, during F14 |
| Status | Ready for UAT |
| Branch | `feature/F14-global-search` (accepted together with F14) |
| Affects | Field app: the bottom tab bar |

## User request
> "add icons to the tabs in mobile view"

## Change
- Each bottom tab of the field app shows an outline icon above its label: **Home** (house), **Route** (route line between two points), **History** (clock with a back arrow) and **Profile** (person).
- The icons are drawn with `react-native-svg` in the same style as the header bell (24 × 24, round strokes). They take the tab bar's colours: brand colour when active (with a slightly bolder stroke), muted when inactive, in light and dark mode. The label size went from 15 to 12 to fit under the icon (D-247).
- No new dependency and no native rebuild: Metro reloads it in the installed Champ Dev builds.

## Acceptance criteria
1. On Android and iOS, the four tabs show their icons above the labels; the active tab's icon and label are in the brand colour.
2. Automated tests pass: mobile 149 (+1 for the tab icons).

## Verification
- `src/components/tab-icon.test.tsx`: every tab has its icon and icons are no longer hidden. Mobile 149/149, typecheck and lint clean.
- iOS Simulator screenshot (your Metro served the change): the four icons render, Home active in the brand colour.
