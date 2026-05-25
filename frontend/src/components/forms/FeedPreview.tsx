import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type PreviewFormat = "rss2" | "atom" | "json";

interface FeedPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  previewXml?: string;
  feedConfig?: Record<string, unknown>;
}

export const FeedPreview = ({
  open,
  onOpenChange,
  previewXml,
  feedConfig,
}: FeedPreviewProps) => {
  const [blobUrl, setBlobUrl] = useState<string>();
  const [format, setFormat] = useState<PreviewFormat>("rss2");
  const [currentContent, setCurrentContent] = useState<string | undefined>(previewXml);
  const [isLoading, setIsLoading] = useState(false);

  // When previewXml changes (new preview generated), reset to rss2
  useEffect(() => {
    if (previewXml) {
      setCurrentContent(previewXml);
      setFormat("rss2");
    }
  }, [previewXml]);

  // Fetch alternate format when format changes (and feedConfig is available)
  useEffect(() => {
    if (!open) return;
    if (format === "rss2" && previewXml) {
      setCurrentContent(previewXml);
      return;
    }
    if (!feedConfig) return;

    setIsLoading(true);
    fetch(`/preview?format=${format}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(feedConfig),
    })
      .then((res) => (res.ok ? res.text() : Promise.reject(res.statusText)))
      .then((text) => setCurrentContent(text))
      .catch((err) => {
        console.error("Error fetching alternate format:", err);
        setCurrentContent(previewXml);
      })
      .finally(() => setIsLoading(false));
  }, [format, open]);

  useEffect(() => {
    if (currentContent) {
      const isJson = format === "json";
      let displayContent = currentContent;

      const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      margin: 0;
      padding: 20px;
      font-family: 'Courier New', monospace;
      background: #f5f5f5;
      overflow: auto;
    }
    pre {
      white-space: pre-wrap;
      word-wrap: break-word;
      background: white;
      padding: 20px;
      border-radius: 4px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
  </style>
</head>
<body>
  <pre>${isJson ? displayContent.replace(/</g, "&lt;").replace(/>/g, "&gt;") : displayContent.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
</body>
</html>
      `;

      const blob = new Blob([htmlContent], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      setBlobUrl(url);

      return () => {
        URL.revokeObjectURL(url);
      };
    }
  }, [currentContent, format]);

  const handleHide = () => {
    onOpenChange(false);
  };

  const formatButtons: { label: string; value: PreviewFormat }[] = [
    { label: "RSS 2.0", value: "rss2" },
    { label: "Atom", value: "atom" },
    { label: "JSON Feed", value: "json" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] max-h-[90vh] p-0">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle>Feed Preview</DialogTitle>
        </DialogHeader>
        <div className="px-6 pt-2 flex gap-2">
          {formatButtons.map((btn) => (
            <Button
              key={btn.value}
              variant={format === btn.value ? "default" : "outline"}
              size="sm"
              onClick={() => setFormat(btn.value)}
              disabled={isLoading}
            >
              {btn.label}
            </Button>
          ))}
          {isLoading && (
            <span className="text-sm text-muted-foreground self-center">Loading...</span>
          )}
        </div>
        <div className="flex-1 overflow-hidden p-6 pt-4">
          {blobUrl ? (
            <iframe
              src={blobUrl}
              className="w-full h-[70vh] border rounded"
              title="Feed Preview"
            />
          ) : (
            <div className="flex items-center justify-center h-[70vh] text-muted-foreground">
              Loading preview...
            </div>
          )}
        </div>
        <div className="p-6 pt-0">
          <Button onClick={handleHide} className="w-full">
            Hide
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
