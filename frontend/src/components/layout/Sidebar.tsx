import React, { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Rss, Activity, Plus, ChevronLeft, ChevronRight, Github } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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
