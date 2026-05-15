import React from "react";
import { NavLink } from "react-router-dom";

export const Header: React.FC = () => {
  return (
    <header className="border-b bg-white/80 backdrop-blur-sm dark:bg-slate-900/80 sticky top-0 z-40 fade-in">
      <div className="container mx-auto px-4 py-6">
        <div className="flex flex-col items-center gap-4">
          <div>
            <img
              src="/public/logo.png"
              alt="Feed Builder Logo"
              className="h-24 w-24 md:h-32 md:w-32"
            />
          </div>
          <div className="text-center">
            <p className="text-muted-foreground text-lg md:text-xl">
              Transform Any Source into RSS
            </p>
          </div>
          <nav className="flex gap-2">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `text-sm font-medium px-4 py-1.5 rounded-full transition-colors ${
                  isActive
                    ? "bg-gradient-to-r from-orange-500 to-red-600 text-white"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`
              }
            >
              Create Feed
            </NavLink>
            <NavLink
              to="/feeds"
              className={({ isActive }) =>
                `text-sm font-medium px-4 py-1.5 rounded-full transition-colors ${
                  isActive
                    ? "bg-gradient-to-r from-orange-500 to-red-600 text-white"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`
              }
            >
              Active Feeds
            </NavLink>
          </nav>
        </div>
      </div>
    </header>
  );
};
