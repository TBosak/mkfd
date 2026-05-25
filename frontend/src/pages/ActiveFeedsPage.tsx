import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Edit, Trash2, ExternalLink, Webhook, Plus, Rss, Copy } from "lucide-react";

interface FeedSummary {
  feedId: string;
  feedName: string;
  feedType: "webScraping" | "api" | "email";
  lastBuildDate: string;
  webhookEnabled: boolean;
  outputUrls?: {
    rss2: string;
    atom: string;
    json: string;
  };
}

const TYPE_BADGE: Record<FeedSummary["feedType"], string> = {
  webScraping: "bg-gradient-to-r from-blue-500 to-cyan-500 text-white",
  api: "bg-gradient-to-r from-green-500 to-emerald-500 text-white",
  email: "bg-gradient-to-r from-purple-500 to-violet-500 text-white",
};

const TYPE_LABEL: Record<FeedSummary["feedType"], string> = {
  webScraping: "Web Scraping",
  api: "REST API",
  email: "Email",
};

export const ActiveFeedsPage = () => {
  const [feeds, setFeeds] = useState<FeedSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const fetchFeeds = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/feeds");
      if (!res.ok) throw new Error("Failed to fetch feeds");
      setFeeds(await res.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFeeds();
  }, [fetchFeeds]);

  const handleDelete = async (feedId: string) => {
    if (!confirm("Are you sure you want to delete this feed?")) return;
    const res = await fetch("/delete-feed", {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ feedId }),
    });
    if (res.type === "opaqueredirect" || res.ok) {
      fetchFeeds();
    } else {
      alert("Failed to delete feed.");
    }
  };

  const handleTriggerWebhook = async (feedId: string) => {
    try {
      const res = await fetch("/trigger-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedId }),
      });
      const result = await res.json();
      if (res.ok) {
        alert(`Webhook triggered successfully!\nItems sent: ${result.itemCount}`);
      } else {
        alert(`Webhook failed: ${result.error}`);
      }
    } catch (e) {
      alert(`Error: ${(e as Error).message}`);
    }
  };

  if (loading) return <LoadingSpinner message="Loading feeds..." />;

  if (error)
    return (
      <div className="text-center py-12 space-y-4 animate-in">
        <p className="text-destructive">{error}</p>
        <Button variant="outline" onClick={fetchFeeds}>
          Retry
        </Button>
      </div>
    );

  if (feeds.length === 0)
    return (
      <div className="text-center py-12 space-y-6 animate-in">
        <Rss className="h-12 w-12 mx-auto text-muted-foreground" />
        <p className="text-muted-foreground text-lg">
          No feeds configured yet.
        </p>
        <Button
          className="bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700"
          onClick={() => navigate("/")}
        >
          <Plus className="mr-2 h-4 w-4" />
          Create Your First Feed
        </Button>
      </div>
    );

  return (
    <div className="space-y-4 animate-in">
      <div className="flex items-center justify-between pb-2">
        <h2 className="text-2xl font-bold bg-gradient-to-r from-orange-500 to-red-600 bg-clip-text text-transparent">
          Active Feeds
        </h2>
        <Button
          onClick={() => navigate("/")}
          className="bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700"
        >
          <Plus className="mr-2 h-4 w-4" />
          New Feed
        </Button>
      </div>

      {feeds.map((feed) => (
        <Card
          key={feed.feedId}
          className="border border-border/50 bg-white/60 dark:bg-slate-900/60 backdrop-blur-sm shadow-sm hover:shadow-md transition-shadow"
        >
          <CardHeader className="pb-2">
            <div className="flex items-center gap-3 flex-wrap">
              <h3 className="font-semibold text-lg">{feed.feedName}</h3>
              <span
                className={`text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_BADGE[feed.feedType]}`}
              >
                {TYPE_LABEL[feed.feedType]}
              </span>
              {feed.webhookEnabled && (
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gradient-to-r from-amber-400 to-orange-400 text-white">
                  Webhook
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3">
              <div className="text-sm text-muted-foreground space-y-1">
                <p>
                  <span className="font-medium text-foreground">Feed ID: </span>
                  <code className="text-xs bg-muted px-1 py-0.5 rounded">
                    {feed.feedId}
                  </code>
                </p>
                <p>
                  <span className="font-medium text-foreground">
                    Last Built:{" "}
                  </span>
                  {feed.lastBuildDate}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {feed.outputUrls ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      asChild
                      className="border-blue-200 text-blue-600 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400"
                    >
                      <a href={feed.outputUrls.rss2} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="mr-1 h-3 w-3" />
                        Open RSS
                      </a>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      asChild
                      className="border-indigo-200 text-indigo-600 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-400"
                    >
                      <a href={feed.outputUrls.atom} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="mr-1 h-3 w-3" />
                        Open Atom
                      </a>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      asChild
                      className="border-green-200 text-green-600 hover:bg-green-50 dark:border-green-800 dark:text-green-400"
                    >
                      <a href={feed.outputUrls.json} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="mr-1 h-3 w-3" />
                        Open JSON
                      </a>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigator.clipboard?.writeText(window.location.origin + feed.outputUrls!.rss2)}
                      className="border-blue-200 text-blue-600 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400"
                    >
                      <Copy className="mr-1 h-3 w-3" />
                      Copy RSS
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigator.clipboard?.writeText(window.location.origin + feed.outputUrls!.atom)}
                      className="border-indigo-200 text-indigo-600 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-400"
                    >
                      <Copy className="mr-1 h-3 w-3" />
                      Copy Atom
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigator.clipboard?.writeText(window.location.origin + feed.outputUrls!.json)}
                      className="border-green-200 text-green-600 hover:bg-green-50 dark:border-green-800 dark:text-green-400"
                    >
                      <Copy className="mr-1 h-3 w-3" />
                      Copy JSON
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    asChild
                    className="border-blue-200 text-blue-600 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400"
                  >
                    <a
                      href={`/public/feeds/${feed.feedId}.xml`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="mr-1 h-3 w-3" />
                      View Feed
                    </a>
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/feeds/${feed.feedId}/edit`)}
                  className="border-orange-200 text-orange-600 hover:bg-orange-50 dark:border-orange-800 dark:text-orange-400"
                >
                  <Edit className="mr-1 h-3 w-3" />
                  Edit
                </Button>
                {feed.webhookEnabled && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleTriggerWebhook(feed.feedId)}
                    className="border-amber-200 text-amber-600 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400"
                  >
                    <Webhook className="mr-1 h-3 w-3" />
                    Trigger Webhook
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDelete(feed.feedId)}
                  className="border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 ml-auto"
                >
                  <Trash2 className="mr-1 h-3 w-3" />
                  Delete
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};
