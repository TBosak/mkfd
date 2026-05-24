# App Shell / Navigation Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **UI implementation:** For Tasks 1–4 (all React component work), use **superpowers:frontend-design** to validate visual designs before writing final component code.

**Goal:** Replace the centered-card layout and top header with a full-height app shell: a collapsible sidebar for desktop and a fixed bottom nav bar for mobile.

**Architecture:** Three new layout components (`Sidebar`, `BottomNav`, `AppShell`) replace the existing `Layout`, `Header`, and `Footer`. `AppShell` wraps the route tree in `App.tsx` exactly as `Layout` did, so no page-level components need to change. Sidebar collapse state is persisted in `localStorage` under `mkfd:nav:collapsed`.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, shadcn/ui (Tooltip), lucide-react, react-router-dom (NavLink), Bun

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `frontend/src/components/layout/BottomNav.tsx` | Fixed mobile bottom bar with My Feeds, Build Feed FAB, Health |
| Create | `frontend/src/components/layout/Sidebar.tsx` | Full-height desktop sidebar: logo, CTA, nav links, GitHub, collapse |
| Create | `frontend/src/components/layout/AppShell.tsx` | Root layout shell — flex row of Sidebar + main + BottomNav |
| Modify | `frontend/src/App.tsx` | Replace `<Layout>` import with `<AppShell>` |
| Delete | `frontend/src/components/layout/Header.tsx` | Replaced by Sidebar |
| Delete | `frontend/src/components/layout/Footer.tsx` | Not replaced |
| Delete | `frontend/src/components/layout/Layout.tsx` | Replaced by AppShell |

---

### Task 1: BottomNav — mobile fixed bottom bar

**Files:**
- Create: `frontend/src/components/layout/BottomNav.tsx`

- [ ] **Step 1: Create `BottomNav.tsx`**

```tsx
import React from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Rss, Plus, Activity } from "lucide-react";

export const BottomNav: React.FC = () => {
  const navigate = useNavigate();
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex lg:hidden bg-background/80 backdrop-blur-sm border-t"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <NavLink
        to="/feeds"
        className={({ isActive }) =>
          `flex flex-col items-center gap-0.5 py-2 px-4 flex-1 transition-colors ${
            isActive ? "text-primary" : "text-muted-foreground"
          }`
        }
      >
        <Rss className="h-5 w-5" />
        <span className="text-[10px]">My Feeds</span>
      </NavLink>

      <div className="flex flex-1 items-center justify-center">
        <button
          onClick={() => navigate("/")}
          className="flex items-center justify-center h-12 w-12 rounded-full bg-primary text-primary-foreground shadow-md -translate-y-2"
          aria-label="Build Feed"
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>

      <NavLink
        to="/health"
        className={({ isActive }) =>
          `flex flex-col items-center gap-0.5 py-2 px-4 flex-1 transition-colors ${
            isActive ? "text-primary" : "text-muted-foreground"
          }`
        }
      >
        <Activity className="h-5 w-5" />
        <span className="text-[10px]">Health</span>
      </NavLink>
    </nav>
  );
};
```

- [ ] **Step 2: Type-check**

```bash
cd frontend && bun run tsc --noEmit
```

Expected: no errors related to `BottomNav.tsx`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/layout/BottomNav.tsx
git commit -m "feat: add BottomNav mobile bottom bar"
```

---

### Task 2: Sidebar — full-height desktop sidebar with collapse

**Files:**
- Create: `frontend/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Create `Sidebar.tsx`**

```tsx
import React, { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Rss, Activity, Plus, ChevronLeft, ChevronRight, Github } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const STORAGE_KEY = "mkfd:nav:collapsed";

export const Sidebar: React.FC = () => {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(STORAGE_KEY) === "true"
  );
  const navigate = useNavigate();

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(STORAGE_KEY, String(next));
  };

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
      collapsed ? "justify-center" : ""
    } ${
      isActive
        ? "bg-muted text-foreground font-medium"
        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
    }`;

  const withTooltip = (label: string, el: React.ReactElement) =>
    collapsed ? (
      <Tooltip>
        <TooltipTrigger asChild>{el}</TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    ) : (
      el
    );

  return (
    <aside
      className="hidden lg:flex flex-col h-full border-r bg-background overflow-hidden shrink-0"
      style={{ width: collapsed ? "52px" : "200px", transition: "width 0.18s ease" }}
    >
      {/* Top zone: logo + wordmark + collapse toggle */}
      <div
        className={`flex items-center px-3 py-4 ${
          collapsed ? "flex-col gap-2" : "justify-between"
        }`}
      >
        <div className="flex items-center gap-2 overflow-hidden">
          <img src="/public/logo.png" alt="mkfd" className="h-7 w-7 shrink-0" />
          {!collapsed && (
            <span className="font-semibold text-sm truncate">mkfd</span>
          )}
        </div>
        <button
          onClick={toggle}
          className="flex items-center justify-center h-6 w-6 rounded text-muted-foreground hover:text-foreground hover:bg-muted shrink-0"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Build Feed CTA */}
      <div className="px-2 pb-3">
        {withTooltip(
          "Build Feed",
          <button
            onClick={() => navigate("/")}
            className={`flex items-center gap-2 w-full rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium transition-colors hover:bg-primary/90 ${
              collapsed ? "justify-center" : ""
            }`}
          >
            <Plus className="h-4 w-4 shrink-0" />
            {!collapsed && <span>Build Feed</span>}
          </button>
        )}
      </div>

      {/* Nav links */}
      <nav className="flex-1 flex flex-col gap-1 px-2">
        {withTooltip(
          "My Feeds",
          <NavLink to="/feeds" className={navLinkClass}>
            <Rss className="h-4 w-4 shrink-0" />
            {!collapsed && <span>My Feeds</span>}
          </NavLink>
        )}
        {withTooltip(
          "Health",
          <NavLink to="/health" className={navLinkClass}>
            <Activity className="h-4 w-4 shrink-0" />
            {!collapsed && <span>Health</span>}
          </NavLink>
        )}
      </nav>

      {/* Bottom zone: GitHub link */}
      <div className="px-2 pb-4">
        {withTooltip(
          "GitHub",
          <a
            href="https://github.com/TBosak/mkfd"
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors ${
              collapsed ? "justify-center" : ""
            }`}
          >
            <Github className="h-4 w-4 shrink-0" />
            {!collapsed && <span>GitHub ↗</span>}
          </a>
        )}
      </div>
    </aside>
  );
};
```

- [ ] **Step 2: Type-check**

```bash
cd frontend && bun run tsc --noEmit
```

Expected: no errors related to `Sidebar.tsx`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/layout/Sidebar.tsx
git commit -m "feat: add Sidebar with collapse, CTA, nav links, GitHub"
```

---

### Task 3: AppShell — root layout wrapper

**Files:**
- Create: `frontend/src/components/layout/AppShell.tsx`

- [ ] **Step 1: Create `AppShell.tsx`**

```tsx
import React from "react";
import { Sidebar } from "./Sidebar";
import { BottomNav } from "./BottomNav";

interface AppShellProps {
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <main className="flex-1 overflow-auto min-w-0 pb-[calc(60px+env(safe-area-inset-bottom))] lg:pb-0">
        {children}
      </main>
      <BottomNav />
    </div>
  );
};
```

- [ ] **Step 2: Type-check**

```bash
cd frontend && bun run tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/layout/AppShell.tsx
git commit -m "feat: add AppShell root layout wrapper"
```

---

### Task 4: Wire AppShell into App.tsx and delete old layout files

**Files:**
- Modify: `frontend/src/App.tsx`
- Delete: `frontend/src/components/layout/Header.tsx`
- Delete: `frontend/src/components/layout/Footer.tsx`
- Delete: `frontend/src/components/layout/Layout.tsx`

- [ ] **Step 1: Replace `App.tsx`**

Replace the entire contents of `frontend/src/App.tsx` with:

```tsx
import { Routes, Route } from "react-router-dom";
import { TooltipProvider } from "./components/ui/tooltip";
import { AppShell } from "./components/layout/AppShell";
import { FeedBuilderForm } from "./components/forms/FeedBuilderForm";
import { ActiveFeedsPage } from "./pages/ActiveFeedsPage";
import { EditFeedPage } from "./pages/EditFeedPage";
import { HealthDashboardPage } from "./pages/HealthDashboardPage";

function App() {
  return (
    <TooltipProvider>
      <AppShell>
        <Routes>
          <Route path="/" element={<FeedBuilderForm />} />
          <Route path="/feeds" element={<ActiveFeedsPage />} />
          <Route path="/feeds/:id/edit" element={<EditFeedPage />} />
          <Route path="/health" element={<HealthDashboardPage />} />
        </Routes>
      </AppShell>
    </TooltipProvider>
  );
}

export default App;
```

- [ ] **Step 2: Delete old layout files**

```bash
rm frontend/src/components/layout/Header.tsx
rm frontend/src/components/layout/Footer.tsx
rm frontend/src/components/layout/Layout.tsx
```

- [ ] **Step 3: Type-check the full project**

```bash
cd frontend && bun run tsc --noEmit
```

Expected: clean output, no errors. If you see errors about missing `Header`, `Footer`, or `Layout` imports, search for any remaining references:

```bash
grep -r "from.*layout/Header\|from.*layout/Footer\|from.*layout/Layout" frontend/src
```

Remove any remaining imports of those three files.

- [ ] **Step 4: Start dev server and smoke test**

```bash
cd frontend && bun run dev
```

Open `http://localhost:5173` and verify:

```
[ ] Sidebar visible on desktop (≥1024px), hidden on mobile
[ ] Bottom nav visible on mobile (<1024px), hidden on desktop
[ ] Sidebar expanded by default (200px); collapse toggle shrinks to 52px icon rail
[ ] Collapsed state persists after page reload
[ ] Expanded: logo + "mkfd" wordmark + labels visible
[ ] Collapsed: icons only; hovering shows shadcn Tooltip with label
[ ] Build Feed button navigates to /
[ ] My Feeds NavLink active (bg-muted) when on /feeds
[ ] Health NavLink active when on /health
[ ] GitHub link opens https://github.com/TBosak/mkfd in new tab
[ ] Mobile: Build Feed FAB (-translate-y-2, bg-primary) navigates to /
[ ] Mobile: My Feeds and Health tabs show active state (text-primary)
[ ] All routes (/feeds, /feeds/:id/edit, /health) load without errors
[ ] No content obscured by bottom nav (padding-bottom applied on mobile)
```

- [ ] **Step 5: Update PROGRESS.md**

In `docs/superpowers/PROGRESS.md`, change:

```
| App Shell / Navigation Redesign | ⬜ | ⬜ |
```

to:

```
| App Shell / Navigation Redesign | ✅ | ✅ |
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat: replace Layout/Header/Footer with AppShell, Sidebar, BottomNav"
```
