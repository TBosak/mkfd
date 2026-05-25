import { Routes, Route } from "react-router-dom";
import { TooltipProvider } from "./components/ui/tooltip";
import { ToastProvider } from "./components/ui/toast-provider";
import { AppShell } from "./components/layout/AppShell";
import { FeedBuilderForm } from "./components/forms/FeedBuilderForm";
import { MyFeedsPage } from "./pages/MyFeedsPage";
import { EditFeedPage } from "./pages/EditFeedPage";
import { HealthDashboardPage } from "./pages/HealthDashboardPage";

function App() {
  return (
    <ToastProvider>
      <TooltipProvider>
        <AppShell>
          <Routes>
            <Route path="/" element={<FeedBuilderForm />} />
            <Route path="/feeds" element={<MyFeedsPage />} />
            <Route path="/feeds/:id/edit" element={<EditFeedPage />} />
            <Route path="/health" element={<HealthDashboardPage />} />
          </Routes>
        </AppShell>
      </TooltipProvider>
    </ToastProvider>
  );
}

export default App;
