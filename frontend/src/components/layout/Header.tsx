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
          <nav className="flex items-center bg-slate-100/70 dark:bg-slate-800/50 rounded-lg p-0.5 gap-0.5">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `text-xs font-medium px-4 py-1.5 rounded-md transition-all duration-200 ${
                  isActive
                    ? "bg-white dark:bg-slate-700 text-orange-600 dark:text-orange-400 shadow-sm"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                }`
              }
            >
              Create Feed
            </NavLink>
            <NavLink
              to="/feeds"
              className={({ isActive }) =>
                `text-xs font-medium px-4 py-1.5 rounded-md transition-all duration-200 ${
                  isActive
                    ? "bg-white dark:bg-slate-700 text-orange-600 dark:text-orange-400 shadow-sm"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
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
