import React from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Rss, Plus, Library } from "lucide-react";

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
        to="/catalog"
        className={({ isActive }) =>
          `flex flex-col items-center gap-0.5 py-2 px-4 flex-1 transition-colors ${
            isActive ? "text-primary" : "text-muted-foreground"
          }`
        }
      >
        <Library className="h-5 w-5" />
        <span className="text-[10px]">Catalog</span>
      </NavLink>
    </nav>
  );
};
