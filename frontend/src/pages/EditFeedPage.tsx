import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { FeedBuilderForm } from "@/components/forms/FeedBuilderForm";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Button } from "@/components/ui/button";
import { configToFormData } from "@/lib/configToFormData";
import type { FeedFormData } from "@/types/feed";

export const EditFeedPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [initialData, setInitialData] = useState<Partial<FeedFormData> | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/feeds/${id}/config`)
      .then(async (res) => {
        if (res.status === 404) throw new Error("Feed not found");
        if (!res.ok) throw new Error("Failed to load feed configuration");
        return res.json();
      })
      .then((config) => setInitialData(configToFormData(config)))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <LoadingSpinner message="Loading feed configuration..." />;

  if (error)
    return (
      <div className="text-center py-12 space-y-4 animate-in">
        <p className="text-destructive text-lg">{error}</p>
        <Button variant="outline" onClick={() => navigate("/feeds")}>
          Back to Active Feeds
        </Button>
      </div>
    );

  return (
    <FeedBuilderForm
      mode="edit"
      feedId={id}
      initialData={initialData ?? undefined}
    />
  );
};
