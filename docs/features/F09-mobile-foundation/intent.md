# F09 — Mobile App Foundation: Intent

| | |
|---|---|
| Status | **Awaiting user sign-off** |
| Requirements | SRS §1 (Field App, Android and iOS), §2 (React Native via Expo), §6.1.5 (read-only profile), §6.6.1 (home, header) · source doc M1 login, M2 home location, M3 home, M4 header, M17 profile · Decisions D-008 (online only), D-010 (Android and iOS), D-014 (Approve visit), D-029 (date picker up to 7 days back), D-035 (Expo dev build), D-078 (OE fitments arrive with the mobile flow) |
| Depends on | F01 (complete); F05 data for the task list (complete) |

## Why
Technicians do their work in the field, so they need the Champ app on their phone. F09 builds the app's base: signing in, the home screen, the header, the profile and the technician's home location (the starting point for route planning in F10). The fitment execution screens come in F10, CSV bulk fill in F11, and the history timeline and Approve visit in F12.

## What will be built

**1. The Champ field app (`apps/mobile`)**
- React Native with Expo and TypeScript, for Android and iOS. It shares types and validation with the web app and API (`packages/shared`).
- Uses the same brand colour, light/dark mode and illustration style as the web app (CR-03).
- Online only (D-008). When the API can't be reached, it shows a clear "No connection" screen with *Retry*.

**2. Sign in**
- The same accounts and passwords as the web console (M1).
- The app is for **technicians (OT) and OEs** (open point 1). SA, OM and RO users see "Use the Champ web console" and are not signed in.
- You stay signed in between app launches (the session is kept in the phone's secure storage). *Sign out* is in the profile.
- Wrong passwords, deactivated accounts and rate limits show the same messages as the web.

**3. Home location (first-run onboarding, M2)**
- At first sign-in a technician sets their **home location**, the fallback starting point for the day's route (open point 2). They can:
  - use the phone's current location (GPS),
  - search an address, or
  - move a pin on an OpenStreetMap map.
- The address is filled from the pin, and they confirm before saving.
- They can change it later from the profile. OMs and OEs see it, read-only, on the web technician page.

**4. Home screen (M3)**
- **Show tasks:** the count of your fitments for the selected date. It opens a simple read-only list: TK id, customer, site address, vehicle and status (open point 4). Route order, the map and starting a fitment come in F10.
- **Approve visit (OE only, D-014):** the number of submitted fitments from your technicians waiting for you. The approval screen comes in F12, so until then the tile says so.
- Pull to refresh.

**5. Header (M4)**
- **Date picker:** today, or up to 7 days back (D-029). The home counts and the task list follow the chosen date.
- **Notifications bell:** shown now, and live with in-app notifications in F13.

**6. Profile (M17, read-only)**
- Name, email, job title, phone, role, reporting manager's name and phone (tap to call), and home location (with *Change*).
- Also the app version and *Sign out*.

**7. Server side**
- Mobile sessions: the app gets and renews its session without browser cookies. Web sign-in is unchanged.
- A home-location field on technician and OE profiles, which they edit from the app.
- A "my fitments for a date" endpoint for the home screen and the list.

## Who can do what

| | SA | OM | OE | OT | RO |
|---|---|---|---|---|---|
| Sign in to the field app | — | — | ✅ | ✅ | — |
| Set own home location | — | — | ✅ (optional) | ✅ (required) | — |
| See a technician's home location (web) | ✅ | ✅ | own technicians | — | ✅ |
| Show tasks (own fitments for a date) | — | — | ✅ | ✅ | — |
| Approve visit count | — | — | ✅ | — | — |

## How you'll try it (open point 3)
- **On your phone:** install the **development build** of the app (Android APK, or the iPhone via Xcode). Your phone and Mac must be on the same Wi-Fi, and the app talks to the API on your Mac.
- **On the Mac:** the iOS Simulator or the Android emulator; both are already installed on this Mac.
- Expo Go isn't used, because F10 needs the native camera, scanner and text-recognition modules that Expo Go can't load (D-035). The first native build takes a few minutes. Later code changes reload instantly.

## Out of scope for F09
- Route planning, the map timeline, starting, filling and closing fitments, photos and scanning (F10).
- CSV bulk fill (F11). History timeline, distance and the Approve visit screen (F12).
- Live notifications (F13). Push notifications and offline use (MVP backlog, D-008).
- Google sign-in on mobile (open point 5).
- Store publishing (MVP backlog).

## Acceptance criteria (UAT)
1. The app installs and opens on an Android emulator or phone and on the iOS Simulator or an iPhone, in light and dark mode.
2. A technician signs in with their web password. Closing and reopening the app keeps them signed in. *Sign out* returns to the sign-in screen.
3. An SA, OM or RO is refused with "Use the Champ web console". A wrong password, a deactivated account and too many attempts show clear messages.
4. On first sign-in a technician must set their home location, by GPS, address search or map pin. The address is shown and saved. It can be changed from the profile, and the web technician page shows it.
5. The home screen shows *Show tasks* with the count for the selected date, and the list shows those fitments. An OE also sees the *Approve visit* count.
6. The header date picker allows today and the 7 days before it, and nothing earlier or later. The counts and list follow the date.
7. The profile shows the right name, email, job title, phone, manager and home location. Tapping the manager's phone opens the dialler.
8. With the API stopped, the app shows "No connection" and recovers on *Retry*.
9. Automated tests pass (API, shared, mobile unit tests), and the existing web tests still pass.

## Open points for this feature
1. **Who uses the app:** only OTs and OEs. SA, OM and RO are pointed to the web console. OK?
2. **Home location:** required for OTs before they can use the app, and optional for OEs (they do fitments only sometimes, D-078). It's set by GPS, address search or map pin, and only the person themselves changes it. OMs and OEs view it on the web. OK? Or should OMs/OEs also be able to edit it from the web?
3. **How you test:** a development build (not Expo Go), in the iOS Simulator, the Android emulator, or on your own phone over the same Wi-Fi. Which do you want to use for UAT: iPhone, Android, or both?
4. **Show tasks in F09:** a simple read-only list for the chosen date now, so the date picker does something useful. The route order, map and execution come in F10. OK?
5. **Google sign-in on mobile:** deferred. It needs separate iOS and Android OAuth client IDs in your Google Cloud project. Email and password work from day one. Add it later, or do you want it in F09?
