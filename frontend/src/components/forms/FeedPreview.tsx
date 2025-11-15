import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface FeedPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  previewXml?: string;
}

export const FeedPreview = ({
  open,
  onOpenChange,
  previewXml,
}: FeedPreviewProps) => {
  const [blobUrl, setBlobUrl] = useState<string>();

  useEffect(() => {
    if (previewXml) {
      // Wrap XML in HTML to display as text with syntax highlighting
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
  <pre>${previewXml.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
</body>
</html>
      `;

      const blob = new Blob([htmlContent], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      setBlobUrl(url);

      // Cleanup
      return () => {
        URL.revokeObjectURL(url);
      };
    }
  }, [previewXml]);

  const handleHide = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] max-h-[90vh] p-0">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle>Feed Preview</DialogTitle>
        </DialogHeader>
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
