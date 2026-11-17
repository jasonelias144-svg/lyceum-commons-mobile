# Status: Lyceum Commons Mobile

**What this is:** a thin phone app for Lyceum Commons' Open rooms; details in README.md
**State:** paused since 2026-10-02 (milestone M7). It needs the Lyceum Commons server, which is offline.
**Updated:** 2026-11-17 by Claude

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

- For the founder: is publishing to the App Store or Google Play part of the
  plan? Both need paid developer accounts. (asked 2026-10-27)

## Noticed

- Eight branches remain from merged milestones (`m1-open-shell` through
  `m7-wait-keep`). This session cannot delete branches.

## Log

- 2026-11-17 Claude: an AI agent is "they", never "it" (the handbook's
  decision 0006, at the founder's word). CLAUDE.md says "they" of Claude, and
  AGENTS.md has the rule under "Always".
- 2026-11-15 Claude: licence: CC0 1.0 (`LICENSE`), a public-domain
  dedication, by the founder's decision of 2026-11-15: "Consider all free
  and public and use the license we have been using and correct that license
  when I naively chose the wrong one or none. Always consider it all public
  if in a public repo." And: "Please ensure the right license is chosen that
  is essentially a license that says there is no restrictions and all that.
  No attribution required." The open question on the licence (asked
  2026-10-27) is closed. Expo's MIT licence, which came with the project
  template, is kept as `LICENSE-EXPO-TEMPLATE` for whatever came from that
  template; README.md says so.

- 2026-10-27 Claude: adopted the policy handbook; added CI (typecheck) and a
  lockfile; rewrote the README to match milestones M1 to M7. `npm run
  typecheck`: no errors.
