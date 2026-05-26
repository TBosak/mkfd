import { Routes, Route } from "react-router-dom";
import { TooltipProvider } from "./components/ui/tooltip";
import { ToastProvider } from "./components/ui/toast-provider";
import { AppShell } from "./components/layout/AppShell";
import { BuildFeedPage } from "./pages/BuildFeedPage";
import { MyFeedsPage } from "./pages/MyFeedsPage";
import { EditFeedPage } from "./pages/EditFeedPage";
import { HealthDashboardPage } from "./pages/HealthDashboardPage";
import { SettingsPage } from "./pages/SettingsPage";
import { CommunityCatalogPage } from "./pages/catalog/CommunityCatalogPage";

function App() {
  return (
    <ToastProvider>
      <TooltipProvider>
        <AppShell>
          <Routes>
            <Route path="/" element={<BuildFeedPage mode="create" />} />
            <Route path="/feeds" element={<MyFeedsPage />} />
            <Route path="/feeds/:id/edit" element={<EditFeedPage />} />
            <Route path="/health" element={<HealthDashboardPage />} />
            <Route path="/catalog" element={<CommunityCatalogPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </AppShell>
      </TooltipProvider>
    </ToastProvider>
  );
}

export default App;
