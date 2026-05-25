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
