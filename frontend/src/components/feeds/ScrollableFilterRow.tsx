import React, { useRef, useState, useEffect, useCallback } from "react";

interface ScrollableFilterRowProps {
  label?: string;
  children: React.ReactNode;
}

export const ScrollableFilterRow: React.FC<ScrollableFilterRowProps> = ({ label, children }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateArrows = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateArrows();
    el.addEventListener("scroll", updateArrows, { passive: true });
    const ro = new ResizeObserver(updateArrows);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateArrows);
      ro.disconnect();
    };
  }, [updateArrows]);

  const scrollBy = (dir: "left" | "right") => {
    scrollRef.current?.scrollBy({ left: dir === "left" ? -120 : 120, behavior: "smooth" });
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, position: "relative" }}>
      {label && (
        <span style={{ fontSize: 11, fontWeight: 600, color: "hsl(var(--muted-foreground))", whiteSpace: "nowrap", marginRight: 4 }}>
          {label}
        </span>
      )}
      {canScrollLeft && (
        <button
          onClick={() => scrollBy("left")}
          style={{
            flexShrink: 0, background: "hsl(var(--background))", border: "1px solid hsl(var(--border))",
            borderRadius: 6, width: 24, height: 24, cursor: "pointer", display: "flex", alignItems: "center",
            justifyContent: "center", color: "hsl(var(--muted-foreground))", fontSize: 12,
          }}
          aria-label="Scroll left"
        >
          ‹
        </button>
      )}
      <div
        ref={scrollRef}
        style={{
          display: "flex", gap: 6, alignItems: "center",
          overflowX: "auto", scrollbarWidth: "none", flex: 1,
        }}
        className="hide-scrollbar"
      >
        {children}
      </div>
      {canScrollRight && (
        <button
          onClick={() => scrollBy("right")}
          style={{
            flexShrink: 0, background: "hsl(var(--background))", border: "1px solid hsl(var(--border))",
            borderRadius: 6, width: 24, height: 24, cursor: "pointer", display: "flex", alignItems: "center",
            justifyContent: "center", color: "hsl(var(--muted-foreground))", fontSize: 12,
          }}
          aria-label="Scroll right"
        >
          ›
        </button>
      )}
    </div>
  );
};
