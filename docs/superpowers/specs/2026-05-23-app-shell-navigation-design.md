# App Shell / Navigation Redesign — Design Spec

**Date:** 2026-05-23
**Tier:** R2 Output & Operations
**Status:** Approved

---

## Goal

Replace the current centered-card layout and top-centered header with a full-height app shell: a collapsible sidebar for desktop navigation and a fixed bottom nav bar for mobile. All existing routes remain unchanged. Pages own their own headers and padding — the shell provides only the surrounding chrome.

---

## Scope

### In scope

- `AppShell.tsx` — new root layout wrapper (CSS grid: sidebar + content)
- `Sidebar.tsx` — full-height desktop nav: logo, Build Feed CTA, nav links, GitHub link, collapse toggle
- `BottomNav.tsx` — fixed mobile bottom bar: My Feeds, Build Feed FAB, Health
- Delete `Header.tsx`, `Footer.tsx`, `Layout.tsx`
- Wire `AppShell` into `App.tsx` in place of `Layout`
- Sidebar collapse state persisted in `localStorage`

### Out of scope

- User accounts, settings menu, or user avatar in sidebar
- Notification badges on nav items
- Nested navigation or expandable nav groups
- Any changes to page content, routes, or existing components beyond the layout wrapper

---

## Design System

Uses the default shadcn blue-gray palette. Imports `feeds-tokens.css` so `var(--bg)`, `var(--line)`, etc. resolve correctly alongside the existing shadcn CSS variables. No new tokens introduced.

---

## AppShell

`frontend/src/components/layout/AppShell.tsx`

Root wrapper rendered in `App.tsx`. Replaces the `<Layout>` import.

**Desktop layout (≥ 1024px):** CSS grid with two columns — sidebar and content.

```
grid-template-columns: [sidebar-width] 1fr
```

Sidebar width transitions between `52px` (collapsed) and `200px` (expanded) via `transition: width 0.18s ease`. The content column fills the remainder at all times.

**Mobile layout (< 1024px):** sidebar hidden, bottom nav visible. Content is full-width with `padding-bottom: calc(60px + env(safe-area-inset-bottom))` to avoid overlap with the bottom nav.

```tsx
<div className="flex h-screen overflow-hidden bg-background">
  <Sidebar />                    {/* hidden on mobile */}
  <main className="flex-1 overflow-hidden min-w-0">
    {children}
  </main>
  <BottomNav />                  {/* hidden on desktop */}
</div>
```

---

## Sidebar

`frontend/src/components/layout/Sidebar.tsx`

Full-height flex column. Three zones: top, middle (grows), bottom.

### Collapse behavior

- Collapsed: `width: 52px` — icons only, no labels
- Expanded: `width: 200px` — icons + text labels
- Collapse state stored in `localStorage` under key `mkfd:nav:collapsed` (boolean string `"true"` / `"false"`)
- Initialized from `localStorage` on mount; defaults to expanded
- CSS `transition: width 0.18s ease` on the sidebar element

### Top zone

```
[Expanded]                    [Collapsed]
┌──────────────────────┐      ┌────┐
│  [logo] mkfd    [‹]  │      │logo│
└──────────────────────┘      │[›] │
                               └────┘
```

- Logo mark: `public/logo.png`, `h-7 w-7`
- Wordmark: "mkfd" text, hidden when collapsed
- Collapse toggle button: chevron icon (`›` / `‹`), top-right when expanded, below logo when collapsed
- Clicking toggle flips state and writes to `localStorage`

### Build Feed CTA

Directly below the top zone, above the nav links.

```
[Expanded]                    [Collapsed]
┌──────────────────────┐      ┌────┐
│  [+] Build Feed      │      │ +  │  ← tooltip "Build Feed"
└──────────────────────┘      └────┘
```

- `bg-primary text-primary-foreground` styling (shadcn primary = blue)
- Navigates to `/` (the `BuildFeedPage` type picker)
- Collapsed: icon only, shadcn `<Tooltip>` showing "Build Feed" on hover
- Expanded: icon + "Build Feed" label

### Nav links

```
[Expanded]                    [Collapsed]
│  [rss]  My Feeds    │      │ rss │  ← tooltip "My Feeds"
│  [act]  Health      │      │ act │  ← tooltip "Health"
```

- Uses `<NavLink>` from react-router-dom
- Active state: `bg-muted text-foreground font-medium`
- Inactive state: `text-muted-foreground hover:bg-muted/50 hover:text-foreground`
- Icons: `Rss` (My Feeds), `Activity` (Health) from lucide-react
- Collapsed: icon only with shadcn `<Tooltip>`

### Bottom zone

```
[Expanded]                    [Collapsed]
│  [github] GitHub ↗  │      │ gh  │  ← tooltip "GitHub"
```

- Anchor tag, `href="https://github.com/TBosak/mkfd"`, `target="_blank" rel="noopener noreferrer"`
- `Github` icon from lucide-react
- Collapsed: icon only with tooltip
- Expanded: icon + "GitHub" label + external link indicator (`↗`)
- Same hover styling as nav links

---

## BottomNav

`frontend/src/components/layout/BottomNav.tsx`

Fixed to bottom of viewport, full width. Visible only on mobile (`flex lg:hidden`).

```
┌────────────────────────────────────┐
│  [rss]          [+]     [activity] │
│  My Feeds    Build Feed   Health   │
└────────────────────────────────────┘
```

### Layout

- `fixed bottom-0 left-0 right-0 z-50`
- `bg-background/80 backdrop-blur-sm border-t`
- `padding-bottom: env(safe-area-inset-bottom)` for notched phones
- Three columns: left nav item, center FAB, right nav item

### My Feeds + Health (nav items)

- `flex flex-col items-center gap-0.5 py-2 px-4`
- Active: `text-primary`
- Inactive: `text-muted-foreground`
- Label: 10px below icon

### Build Feed FAB (center)

- Circular button, `bg-primary text-primary-foreground`
- Slightly larger than nav items: `h-12 w-12`
- Subtle shadow: `shadow-md`
- Raised slightly above the bar with `–translate-y-2`
- `+` icon (Plus from lucide-react), no label
- Navigates to `/`

---

## Deleted Files

| File | Replacement |
|---|---|
| `frontend/src/components/layout/Header.tsx` | Sidebar handles all nav |
| `frontend/src/components/layout/Footer.tsx` | Not replaced (footer content no longer needed in app shell) |
| `frontend/src/components/layout/Layout.tsx` | Replaced by `AppShell.tsx` |

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `frontend/src/components/layout/AppShell.tsx` | Root layout shell (grid + mobile padding) |
| Create | `frontend/src/components/layout/Sidebar.tsx` | Desktop nav: logo, CTA, links, GitHub, collapse |
| Create | `frontend/src/components/layout/BottomNav.tsx` | Mobile bottom nav with FAB |
| Delete | `frontend/src/components/layout/Header.tsx` | Replaced by Sidebar |
| Delete | `frontend/src/components/layout/Footer.tsx` | Removed |
| Delete | `frontend/src/components/layout/Layout.tsx` | Replaced by AppShell |
| Modify | `frontend/src/App.tsx` | Swap `<Layout>` for `<AppShell>` |

---

## Dependencies

- Must be implemented **before** My Feeds Redesign and Builder UI Redesign — both page components assume a full-height parent container.
- No backend changes required.
- No new npm dependencies — uses existing shadcn `Tooltip`, lucide-react icons, react-router-dom `NavLink`.

---

## Tests

### Manual smoke test

```text
[ ] App loads; sidebar visible on desktop, bottom nav visible on mobile
[ ] Sidebar expanded by default; collapse toggle shrinks to 52px icon rail
[ ] Collapsed state persists on page reload
[ ] Expanded state shows logo + wordmark + labels
[ ] Collapsed state shows icons only; tooltips appear on hover
[ ] Build Feed CTA navigates to /
[ ] My Feeds NavLink active when on /feeds
[ ] Health NavLink active when on /health
[ ] GitHub link opens https://github.com/TBosak/mkfd in new tab
[ ] Mobile: sidebar hidden, bottom nav visible
[ ] Mobile: Build Feed FAB navigates to /
[ ] Mobile: My Feeds and Health tabs show active state correctly
[ ] Mobile safe-area padding applied (no content obscured by home indicator)
[ ] All existing routes (/feeds, /feeds/:id/edit, /health) load without errors
```
