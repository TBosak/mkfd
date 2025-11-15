import React from "react";

export const Header: React.FC = () => {
  return (
    <header className="border-b bg-white/80 backdrop-blur-sm dark:bg-slate-900/80 sticky top-0 z-40 fade-in">
      <div className="container mx-auto px-4 py-6">
        <div className="flex flex-col items-center gap-4">
          {/* Logo */}
          <div>
            <img
              src="/public/logo.png"
              alt="Feed Builder Logo"
              className="h-24 w-24 md:h-32 md:w-32"
            />
          </div>

          {/* Tagline */}
          <div className="text-center">
            <p className="text-muted-foreground text-lg md:text-xl">
              Transform Any Source into RSS
            </p>
          </div>
        </div>
      </div>
    </header>
  );
};
