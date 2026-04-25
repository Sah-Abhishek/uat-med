# Valerion Health — Frontend

Pass 1 of the Valerion Health frontend: full design system matching the real UAT aesthetic (yellow primary, coral destructive, pill buttons, hand-drawn illustrations, light/dark toggle), plus a working Login → Dashboard.

## Quick start

```bash
npm install
npm run dev
```

App serves at http://localhost:8600 (or whatever port your `vite.config.ts` is set to) and proxies `/api/v1/*` → `https://apiuatnextcode.icdcore.com/api/v1/*` so CORS is a non-issue in dev.

Sign in with the UAT admin:
- Email: `admin@valerionhealth.com`
- Password: `<BOOTSTRAP_ADMIN_PASSWORD>`

Use the "Continue with email (UAT)" expander — Microsoft SSO is scaffolded but not active (needs Azure AD values in production).

## What's in this pass

### Design system (complete)
- **Tokens**: Plus Jakarta Sans + JetBrains Mono, full light + dark palettes, pill-shaped components, custom tint colors for status tiles
- **Theme toggle** in top bar, persisted in localStorage, light as default
- **Primitives**: `Button` (6 variants), `Input` / `Select` / `Textarea` / `Label` / `SearchInput`, `Card`, `CollapsibleCard`, all chip variants (Chart/Worklist/Priority/Milestone/PillBadge), stat cards (Tinted/Illustration/Coral) with inline SVG hand-drawn people, `ValerionLogo` + `ValerionMark`
- **Layout**: labeled sidebar with logo and nav items, `TopBar` with Client/Location selectors + search/bell/theme/avatar menu, `PageHeader` with the yellow arrow prefix, `SectionLabel` with the dotted-rule pattern

### Pages
| Page | Status |
| --- | --- |
| `/login` | ✅ Real — dark split layout with hospital illustration, Microsoft SSO button, collapsible dev email form |
| `/signup` | ✅ Real — request access flow |
| `/` (Dashboard) | ✅ Real — Milestones (3 tinted tiles) + Status (2 illustration tiles) + Unallocated (2 coral pills) + global filter bar + 3 collapsible analytics sections (placeholders for the charts) |
| `/worklists` | 🟡 Scaffold |
| `/charts` | 🟡 Scaffold |
| `/hcc` | 🟡 Scaffold |
| `/users` | 🟡 Scaffold |
| `/configurations` | 🟡 Scaffold |
| `/reports` | 🟡 Scaffold |

All scaffold pages use the same "Coming Soon" template with the planned endpoints listed. They're nav-accessible and respect role gating.

## Microsoft SSO setup (for production)

The MSAL integration is wired but inactive because `VITE_AZURE_CLIENT_ID` is unset. To activate:

1. Create an Azure AD app registration
2. Add these to `.env.production`:
   ```env
   VITE_AZURE_CLIENT_ID=<app-registration-client-id>
   VITE_AZURE_TENANT_ID=<tenant-id or "common">
   VITE_AZURE_REDIRECT_URI=https://your-frontend-origin/login
   VITE_AZURE_API_SCOPE=<backend-api-scope-URI>
   ```
3. Rebuild. The "Sign in with Microsoft" button will now call `loginRedirect()`.
4. Backend work needed: accept Azure-issued tokens, or exchange them for a Valerion JWT.

## Project structure

```
src/
├── api/                   # typed fetchers per feature (§6 of integration guide)
├── auth/
│   ├── LoginPage.tsx      # dark split login w/ MSAL + dev fallback
│   ├── SignupPage.tsx
│   ├── ProtectedRoute.tsx
│   ├── msal.ts            # MSAL scaffold (env-gated)
│   └── store.ts           # Zustand auth store
├── components/
│   ├── ui/                # design system primitives
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── Chip.tsx
│   │   ├── Field.tsx
│   │   ├── Logo.tsx
│   │   └── StatCards.tsx
│   ├── layout/
│   │   ├── Layout.tsx     # app shell — sidebar + TopBar + Outlet
│   │   ├── TopBar.tsx
│   │   └── PageHeader.tsx
│   ├── ComingSoonPage.tsx
│   └── NotFoundPage.tsx
├── features/
│   ├── dashboard/DashboardPage.tsx
│   ├── worklists/WorklistsPage.tsx       (stub)
│   ├── charts/ChartsPage.tsx             (stub)
│   ├── hcc/HccPage.tsx                   (stub)
│   ├── users/UsersPage.tsx               (stub)
│   ├── configurations/ConfigurationsPage.tsx (stub)
│   └── reports/ReportsPage.tsx           (stub)
├── theme/store.ts         # light/dark toggle store
├── permissions.ts         # role → action matrix (§5.4)
├── hooks/useCan.ts
├── lib/utils.ts           # cn(), formatters
├── router.tsx
├── main.tsx
└── styles/global.css      # Tailwind + CSS variables
```

## Up next (Pass 2)

Every scaffold page gets rebuilt into real UI:

1. **Chart detail / coding editor** — the most important screen
2. **Worklists list** with progress bars + avatars + status tiles
3. **Worklist detail** with allocation UI
4. **Charts list** with priority tabs + all action modals
5. **Users** with tabs + profile + attendance calendar + signup approvals
6. **HCC** with Add form + Upload + Filter
7. **Reports** with Customize fields + Templates + wide data table
8. **Configurations** with all 3 tabs + 5 sub-tabs

## Scripts

```bash
npm run dev       # start Vite dev server
npm run build     # typecheck + production build → dist/
npm run preview   # serve the built dist/
```
