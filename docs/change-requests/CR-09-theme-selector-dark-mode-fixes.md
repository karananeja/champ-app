# CR-09 — Theme selector; checked checkboxes and the bell badge in dark mode

| | |
|---|---|
| Raised | 2026-10-12 by the user, during F14 |
| Status | ✅ Complete: merged with F14 on 2026-10-12 (user replied "F14 accepted"; taken as accepted with F14) |
| Branch | `feature/F14-global-search` (accepted together with F14) |
| Affects | Web (user menu, checkboxes, bell, toasts) and the field app (Profile, checkboxes, bell, red buttons/segments) |

## User request
> "add theme selector and in dark mode, the check box doesnot appear selected, and the indicator on notification icon does not seem visible"

## Change
1. **Theme selector** (D-253): **System / Light / Dark**.
   - **Web:** in the user menu (top-right avatar) under *Theme*. Saved in the browser (`localStorage` `champ-theme`); the inline script in `index.html` applies it before the first paint, so there's no flash. Toasts follow the choice too.
   - **App:** a *Theme* card on the Profile tab. Saved on the phone (SecureStore) and applied at startup; it also sets the app's native appearance (pickers, alerts, keyboard) with `Appearance.setColorScheme`.
   - *System* (the default) follows the OS setting as before (CR-03).
2. **Checked checkboxes in dark mode** (bug):
   - **Web:** the shadcn checkbox's `dark:bg-input/30` overrode the checked fill, so a ticked box looked empty. The checked/indeterminate fill now wins in dark mode too.
   - **App:** the accessories list (Approve visit) drew ☑/☐ as text, hard to tell apart in dark mode. It now draws a real checkbox: an outlined box, filled with the brand colour and a tick when checked.
3. **Bell badge in dark mode** (bug): the dark theme's red is light, and the white count on it washed out. The badge now uses a strong red with a ring in the background colour, in both themes (D-254). The app's *Not OK* segment and destructive buttons had the same white-on-light-red problem and use the same strong red.

## Acceptance criteria
1. Web: the user menu has Theme → System / Light / Dark; the choice applies at once and survives a reload. App: Profile → Theme does the same and survives restarting the app.
2. In dark mode, a checked checkbox (web lists and dialogs; app accessories) is clearly filled with a tick.
3. In dark mode, the bell's unread count is clearly visible on the web and in the app.
4. Automated tests pass.

## Verification
- Web: `src/lib/theme.test.ts` (class + storage, system follows the OS), `src/components/ui/checkbox.test.tsx` (checked fill in dark); web notification tests still pass.
- App: `src/theme/theme-preference.test.tsx` (picker switches the palette and saves; System clears; saved choice loads at startup), `src/components/checkbox.test.tsx`; mobile 152/152 (3 full runs; one earlier one-off timing failure in the notifications test passed on rerun), typecheck and lint clean.
- iOS Simulator in dark mode (through the user's Metro; the simulator was set back to light afterwards): the badge's count is clearly readable.
