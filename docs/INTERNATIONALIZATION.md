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
- API onboarding and the internal model gateway settings.

## Next translation waves

1. Campaign forms, client profiles, Brand Kit, and campaign detail drawers.
2. Content Studio, Script, Assets, Voice, Director, and Export stages.
3. Operations, review portals, cost dashboards, empty/error states, and confirmation dialogs.
4. Public/legal/help copy plus automated UI coverage for every route.

New visible copy should not be hardcoded in a translated surface. Add the Vietnamese source and English counterpart together, then cover interpolation or fallback behavior when applicable.
