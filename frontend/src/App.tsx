import { Routes, Route } from "react-router-dom";
import { TooltipProvider } from "./components/ui/tooltip";
import { Layout } from "./components/layout/Layout";
import { FeedBuilderForm } from "./components/forms/FeedBuilderForm";
import { ActiveFeedsPage } from "./pages/ActiveFeedsPage";
import { EditFeedPage } from "./pages/EditFeedPage";
import { HealthDashboardPage } from "./pages/HealthDashboardPage";

function App() {
  return (
    <TooltipProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<FeedBuilderForm />} />
          <Route path="/feeds" element={<ActiveFeedsPage />} />
          <Route path="/feeds/:id/edit" element={<EditFeedPage />} />
          <Route path="/health" element={<HealthDashboardPage />} />
        </Routes>
      </Layout>
    </TooltipProvider>
  );
}

export default App;
