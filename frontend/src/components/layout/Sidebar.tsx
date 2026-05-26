import React, { useState } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { Activity, Github, Library, PanelLeftClose, PanelLeftOpen, Plus, Rss, Settings } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export const Sidebar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("mkfd:nav:collapsed") === "1");

  function toggleCollapse() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("mkfd:nav:collapsed", next ? "1" : "0");
  }

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 border-l-4 px-4 py-2 text-sm transition-colors ${
      isActive
        ? "border-primary bg-primary/10 font-semibold text-primary"
        : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
    }`;

  function collapsedNavClass(path: string) {
    const isActive = location.pathname === path || location.pathname.startsWith(path + "/");
    return `flex items-center justify-center w-full py-2 transition-colors border-l-4 ${
      isActive
        ? "border-primary bg-primary/10 text-primary"
        : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
    }`;
  }

  const width = collapsed ? 52 : 256;

  return (
    <aside
      className="hidden h-full shrink-0 flex-col overflow-hidden border-r lg:flex"
      style={{ width, background: "var(--wb-surface-low)", borderColor: "var(--wb-outline)", transition: "width 0.2s ease" }}
    >
      {/* Logo */}
      <div className="px-3 py-4 flex items-center gap-3" style={{ minHeight: 64 }}>
        <img
          src="/public/logo.png"
          alt="Mkfd"
          className="h-8 w-8 rounded shrink-0"
          style={{ objectFit: "contain" }}
        />
        {!collapsed && (
          <div>
            <div className="text-xl font-semibold leading-6">Mkfd</div>
            <div className="workbench-label">Feed Engine</div>
          </div>
        )}
      </div>

      {/* Create Feed button */}
      <div className={collapsed ? "px-2 pb-3" : "px-4 pb-4"}>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => navigate("/")}
                className="flex h-9 w-full items-center justify-center rounded border border-primary text-primary bg-transparent transition-colors hover:bg-primary/10"
                aria-label="Create Feed"
              >
                <Plus className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Create Feed</TooltipContent>
          </Tooltip>
        ) : (
          <button
            type="button"
            onClick={() => navigate("/")}
            className="flex h-9 w-full items-center justify-center gap-2 rounded bg-primary px-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            Create Feed
          </button>
        )}
      </div>

      {/* Nav items */}
      <nav className="flex flex-1 flex-col gap-1">
        {collapsed ? (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => navigate("/feeds")}
                  className={collapsedNavClass("/feeds")}
                  aria-label="Feeds"
                >
                  <Rss className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Feeds</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => navigate("/health")}
                  className={collapsedNavClass("/health")}
                  aria-label="Health"
                >
                  <Activity className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Health</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => navigate("/catalog")}
                  className={collapsedNavClass("/catalog")}
                  aria-label="Catalog"
                >
                  <Library className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Catalog</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => navigate("/settings")}
                  className={collapsedNavClass("/settings")}
                  aria-label="Settings"
                >
                  <Settings className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Settings</TooltipContent>
            </Tooltip>
          </>
        ) : (
          <div className="px-4 flex flex-col gap-1">
            <NavLink to="/feeds" className={navLinkClass}>
              <Rss className="h-4 w-4" />
              Feeds
            </NavLink>
            <NavLink to="/health" className={navLinkClass}>
              <Activity className="h-4 w-4" />
              Health
            </NavLink>
            <NavLink to="/catalog" className={navLinkClass}>
              <Library className="h-4 w-4" />
              Catalog
            </NavLink>
            <NavLink to="/settings" className={navLinkClass}>
              <Settings className="h-4 w-4" />
              Settings
            </NavLink>
          </div>
        )}

        {/* Collapse toggle */}
        <div className="mt-auto">
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={toggleCollapse}
                  className="flex w-full items-center justify-center py-3 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Expand sidebar"
                >
                  <PanelLeftOpen className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Expand sidebar</TooltipContent>
            </Tooltip>
          ) : (
            <button
              type="button"
              onClick={toggleCollapse}
              className="flex w-full items-center gap-3 px-8 py-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Collapse sidebar"
            >
              <PanelLeftClose className="h-4 w-4" />
              Collapse
            </button>
          )}
        </div>
      </nav>

      {/* GitHub link */}
      <div className="border-t" style={{ borderColor: "var(--wb-outline)" }}>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href="https://github.com/TBosak/mkfd"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center py-4 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="GitHub Repository"
              >
                <Github className="h-4 w-4" />
              </a>
            </TooltipTrigger>
            <TooltipContent side="right">Repository</TooltipContent>
          </Tooltip>
        ) : (
          <div className="px-6 py-5">
            <a
              href="https://github.com/TBosak/mkfd"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded p-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Github className="h-4 w-4" />
              Repository
            </a>
          </div>
        )}
      </div>
    </aside>
  );
};
