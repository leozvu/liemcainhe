# English sub-version foundation

Egoric Film Studio uses one codebase for Vietnamese and English. The interface locale is independent from a project's content language: switching the UI to English must not rewrite a Vietnamese brief, script, caption, voice profile, or prompt.

## Runtime contract

- Supported interface locales: `vi` and `en`.
- Default and safe fallback: `vi`.
- Browser preference key: `egoric_ui_locale_v1`.
- The active locale updates `<html lang>` and `data-locale` for accessibility and future locale-specific styling.
- Dates, numbers, and currency use the locale supplied by `LocaleContext` rather than a fixed display locale.

All shared interface copy lives in `services/i18n.ts`. Components consume it through `useLocale()`; user-created content and API responses remain untouched.

## Phase 1 coverage

- Global language switcher in the dashboard header and production sidebar.
- Workspace loading and global production navigation.
- Dashboard project overview and primary actions.
- Campaign Hub overview, filters, status board, campaign objectives, priorities, platforms, and deliverable states.
- Campaign creation/editing, deliverable setup, campaign details, and client directory.
- Client profile creation and Brand Kit editing across identity, voice, platform rules, and approved memory.
- API onboarding and the internal model gateway settings.
- Pre-production Room, localized brief-readiness checks, deliverable handoff, and cost guardrails.
- Campaign Zero runbook, evidence gates, telemetry, team clock, provider reconciliation, and paid-test preflight.
- Script Studio setup, output-language selector, editor, AI states, storyboard breakdown, character casting, and visual-prompt controls.
- Content Studio trend board, brief axes, creative-direction controls, article editor, illustration planning, publishing workflow, library, insights, and short-film handoff.

## Next translation waves

1. Assets, Voice, Director, and Export stages.
2. Operations, review portals, cost dashboards, empty/error states, and confirmation dialogs.
3. Public/legal/help copy plus automated UI coverage for every route.

New visible copy should not be hardcoded in a translated surface. Add the Vietnamese source and English counterpart together, then cover interpolation or fallback behavior when applicable.
