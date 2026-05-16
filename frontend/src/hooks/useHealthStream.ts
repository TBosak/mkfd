import { useEffect, useRef } from "react";
import type { RunLog } from "@/types/health";

export function useHealthStream(onRun: (row: RunLog) => void) {
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;

  useEffect(() => {
    const source = new EventSource("/api/health/stream");

    source.addEventListener("run", (e) => {
      try {
        const row: RunLog = JSON.parse((e as MessageEvent).data);
        onRunRef.current(row);
      } catch {
        // malformed event — ignore
      }
    });

    source.onerror = () => {
      // Browser will auto-reconnect on error; no action needed
    };

    return () => {
      source.close();
    };
  }, []);
}
