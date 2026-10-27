# Working in Lyceum Commons Mobile

This repository follows the policy handbook at
https://github.com/jasonelias144-svg/policy-handbook. Read its orientation
(README.md) before your first session here. The rules below add to the
handbook; they never loosen it.

## Every session

1. Read `STATUS.md` and the open pull requests (handbook P1).
2. Work on a branch; never push to `main` (P3).
3. End by pushing, updating `STATUS.md` on your branch, and opening or updating
   the pull request (P1).

## Who decides

The founder decides what this project is for and who works on it. The technical
lead (Claude) decides everything about the code, and records an approval on
every pull request before it merges (P4). Intent questions go to the founder (P5).

## This repository

- **What it is:** a thin phone app (Expo, React Native, TypeScript) for the
  Open layer of Lyceum Commons. The live Open API is the only source of truth;
  the app keeps no conversation store of its own.
- **Run:** `npm install`, then `npx expo start` (Expo Go on a phone, or `w` for
  the web). The server address comes from `EXPO_PUBLIC_API_BASE`; see `.env.example`.
- **Test:** `npm run typecheck` (TypeScript, no emit). There are no unit tests
  yet. CI runs the typecheck on every pull request.
- **Merge method:** squash
- **Release:** none. The app has not been published to an app store, and has
  no EAS build profiles. Store publishing is a founder decision: accounts and
  fees are involved (P6).
- **Data:** the guest key is kept in `expo-secure-store` on phones and in
  `localStorage` on the web, and is sent only as the `X-Lyceum-Guest` header.
  Never log it or put it in a request body.

## Rules specific to this repository

- **Expo changes quickly; don't trust your training data.** Before touching an
  Expo, EAS or React Native API, read the `expo` major version in `package.json`,
  then the matching docs at `https://docs.expo.dev/versions/v<major>.0.0/`. The
  index at https://docs.expo.dev/llms.txt lists common mistakes.
- Add packages with `npx expo install <package>`, which picks versions that
  match the SDK. Commit the updated `package-lock.json`.
- `ios/` and `android/` are generated (Continuous Native Generation). Don't
  create or edit them by hand; configure native behaviour in `app.json`.
- Expo Go only includes its bundled native modules. A library with other native
  code needs a development build.
- Navigation is a plain screen switch in `App.tsx` (`JoinScreen`, `RoomScreen`);
  the app does not use Expo Router. Moving to Expo Router would be a technical
  lead decision, made in its own pull request.
- Follow the server's contract: show the server's own error text (409, 429 and
  others) and honour `Retry-After`. Never invent limits on the client.

## Always

- Say who made each change: `Made-by: <name> (AI|human)` in commits, and the
  "Made by" field in pull requests (P3).
- No secrets or personal data anywhere in the repository (P8).
- Report outcomes honestly: what you checked, and what you did not.
