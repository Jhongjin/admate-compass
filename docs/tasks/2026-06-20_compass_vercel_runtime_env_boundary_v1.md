# Compass Vercel Runtime Env Boundary v1

Date: 2026-06-20 KST
Repo: admate-compass
Status: completed locally

## Scope

Close the runtime configuration boundary after production deploy by ensuring environment values are not embedded in repository deployment config.

## Completed Fixes

- Removed the `env` block from `vercel.json`; it now keeps only Vercel version and function duration settings.
- Removed tracked legacy runtime files: `.env.render`, `.env.vercel`, and `env.example`.
- Consolidated placeholder-only environment documentation into `.env.example`.
- Added contract coverage so `check:compass-answer-provider-contract` fails if runtime values are embedded in `vercel.json` or legacy env files are still tracked.
- Confirmed production Vercel env keys exist for the current Compass runtime before removing repository-level values.

## Verification

Passed locally:

```text
npm run check:compass-answer-provider-contract
npm run check:compass-public-provider-naming
npm run type-check
```

## Not Run

- No Vercel env values were printed or changed.
- No production deployment was triggered by this queue alone.
- No DB/Auth mutation was performed.

## Follow-Up

- Keep adding runtime keys through Vercel env only.
- Keep `.env.example` placeholder-only.
- Run full build and production deploy after the Browserslist maintenance queue is closed.
