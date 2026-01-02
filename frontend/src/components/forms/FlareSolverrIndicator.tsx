import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { UseFormWatch } from "react-hook-form";
import { FeedFormData } from "@/types/feed";

interface FlareSolverrIndicatorProps {
  watch: UseFormWatch<FeedFormData>;
  feedType?: "webScraping" | "api" | "email";
}

export const FlareSolverrIndicator = ({
  watch,
  feedType,
}: FlareSolverrIndicatorProps) => {
  const isEnabled = watch("flaresolverr.enabled");
  const serverUrl = watch("flaresolverr.serverUrl");
  const isWebScraping = feedType === "webScraping";
  const [connectionStatus, setConnectionStatus] = useState<"connected" | "error" | "checking">("checking");

  // Verify FlareSolverr server is active
  useEffect(() => {
    if (!isEnabled || !serverUrl || !isWebScraping) {
      setConnectionStatus("checking");
      return;
    }

    setConnectionStatus("checking");

    // Debounce the server check
    const timeoutId = setTimeout(async () => {
      try {
        // Check via our backend proxy to avoid CORS issues
        const response = await fetch("/api/flaresolverr/health", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serverUrl }),
          signal: AbortSignal.timeout(5000),
        });

        const data = await response.json();
        setConnectionStatus(data.active === true ? "connected" : "error");
      } catch (error) {
        setConnectionStatus("error");
      }
    }, 500); // 500ms debounce

    return () => clearTimeout(timeoutId);
  }, [isEnabled, serverUrl, isWebScraping]);

  // Only show for web scraping feeds when FlareSolverr is enabled
  if (!isWebScraping || !isEnabled) {
    return null;
  }

  const handleClick = () => {
    // Find the FlareSolverr section
    const flaresolverrSection = document.getElementById("flaresolverr-section");

    if (flaresolverrSection) {
      // First, ensure the Additional Options accordion is open
      const accordionTrigger = document.querySelector(
        '[data-accordion-trigger="additional"]'
      ) as HTMLButtonElement;

      if (accordionTrigger) {
        const accordionContent = accordionTrigger.getAttribute("data-state");

        // If accordion is closed, open it
        if (accordionContent === "closed") {
          accordionTrigger.click();
        }
      }

      // Wait a brief moment for accordion animation, then scroll
      setTimeout(() => {
        flaresolverrSection.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });

        // Add a brief highlight effect
        flaresolverrSection.classList.add("ring-2", "ring-blue-500", "ring-offset-2", "rounded-lg");
        setTimeout(() => {
          flaresolverrSection.classList.remove("ring-2", "ring-blue-500", "ring-offset-2", "rounded-lg");
        }, 2000);
      }, 300);
    }
  };

  const badge = (
    <button
      type="button"
      onClick={handleClick}
      className="fixed bottom-6 right-6 z-[9999] flex items-center gap-2 px-3 py-2 bg-slate-700 dark:bg-slate-800 text-white rounded-full shadow-lg hover:shadow-xl hover:bg-slate-600 dark:hover:bg-slate-700 transition-all hover:scale-105 cursor-pointer"
      title={`FlareSolverr: ${connectionStatus === "connected" ? "Connected" : connectionStatus === "error" ? "Connection Error" : "Checking..."}`}
    >
      <img
        src="/public/flaresolverr.svg"
        alt="FlareSolverr"
        className="h-5 w-5"
      />
      <span className="text-sm font-medium">FlareSolverr</span>
      {/* Status indicator circle */}
      <div className="relative flex items-center justify-center">
        <div
          className={`h-2 w-2 rounded-full ${
            connectionStatus === "connected"
              ? "bg-green-500"
              : connectionStatus === "error"
              ? "bg-red-500"
              : "bg-yellow-500"
          }`}
        />
        {connectionStatus === "connected" && (
          <div className="absolute h-2 w-2 rounded-full bg-green-500 animate-ping opacity-75" />
        )}
      </div>
    </button>
  );

  // Use portal to render at document body level to ensure fixed positioning works
  return typeof document !== "undefined" ? createPortal(badge, document.body) : null;
};
