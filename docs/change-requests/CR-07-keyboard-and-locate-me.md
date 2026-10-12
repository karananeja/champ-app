# CR-07 — Inputs above the keyboard, and *Locate me* on the route map

| | |
|---|---|
| Raised | 2026-10-12 by the user, during F10 UAT |
| Status | Awaiting acceptance |
| Branch | `feature/F10-route-and-start` (accepted together with F10, since the button is on the F10 route screen) |
| Affects | Field app: sign-in and home-location screens, route map |

## User request
> "in mobile app, in login screen when entering the email/password, the input field gets hidden and not showing above the keyboard and in route display i want locate me button which takes my device location"

## Change
1. **Inputs stay above the keyboard (bug).** The sign-in and home-location screens avoided the keyboard on iOS only. With Android's edge-to-edge mode (React Native 0.86) the window no longer resizes for the keyboard, so the fields slid underneath it. Both screens now pad above the keyboard on Android too. This is the same fix as the F10 dialogs (D-177, D-178).
2. ***Locate me* button on the route map (new).** A round ◎ button at the bottom-right of the map:
   - It takes a fresh, high-accuracy GPS fix (asking for permission if needed), shows a "you are here" dot and flies the map there (zoom 15).
   - It doesn't change or recalculate the route (D-179). *Recalculate route* still does that.
   - Location denied → "Allow location access for Champ to show where you are." No fix within 15 s → "Couldn't get your location. Try again in a moment."
   - Pull to refresh shows the whole route again.

## Acceptance criteria
1. On Android and iOS, tapping Email or Password on the sign-in screen keeps the field and *Sign in* visible above the keyboard. The address field on the home-location screen does the same.
2. On the Route tab, *Locate me* shows your position on the map and moves the map to it. With location denied, it shows the message.
3. Automated tests pass: mobile 62 (+3 for *Locate me*).
