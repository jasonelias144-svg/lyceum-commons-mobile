# Status: Lyceum Commons Mobile

**What this is:** a thin phone app for Lyceum Commons' Open rooms; details in README.md
**State:** paused since 2026-10-02 (milestone M7). It needs the Lyceum Commons server, which is offline.
**Updated:** 2026-10-27 by Claude

## Live

- Where: not published (no app store build). Runs in Expo Go during development.
- Server it talks to: `https://lyceum-commons-production.up.railway.app` by
  default, which has been offline since Railway's free period ended.

## Now

- Claude: adopting the policy handbook, adding CI, correcting the README (docs/adopt-handbook).

## Next

1. When Lyceum Commons is live on Cloudflare, change `DEFAULT_API_BASE` in
   `src/api/openClient.ts` and `.env.example` to the new address.
2. Unit tests for the pure helpers in `src/api/openClient.ts` (turn parsing,
   429 waits, error notes), run in CI.

## Open questions

- For the founder: `LICENSE` is the MIT licence from Expo's project template,
  with Expo's company (650 Industries) as copyright holder. It doesn't describe
  this project. Should it be MIT under your name, another licence, or none for
  now? (asked 2026-10-27)
- For the founder: is publishing to the App Store or Google Play part of the
  plan? Both need paid developer accounts. (asked 2026-10-27)

## Noticed

- Eight branches remain from merged milestones (`m1-open-shell` through
  `m7-wait-keep`). This session cannot delete branches.

## Log

- 2026-10-27 Claude: adopted the policy handbook; added CI (typecheck) and a
  lockfile; rewrote the README to match milestones M1 to M7. `npm run
  typecheck`: no errors.
