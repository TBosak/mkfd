import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Header } from "./Header";
import { Footer } from "./Footer";

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 max-w-6xl">
        <Card className="my-8 shadow-lg border-0 bg-white/80 backdrop-blur-sm dark:bg-slate-900/80 slide-up">
          <CardContent className="p-0">
            <Header />
            <main className="px-6 md:px-32 pb-12">
              {children}
            </main>
            <div className="px-6 md:px-32 pb-6">
              <Footer />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
