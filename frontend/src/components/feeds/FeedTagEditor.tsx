import React, { useState, useRef } from "react";

interface FeedTagEditorProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  readOnly?: boolean;
}

export const FeedTagEditor: React.FC<FeedTagEditorProps> = ({ tags, onChange, readOnly = false }) => {
  const [adding, setAdding] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const commitTag = () => {
    const val = inputValue.trim();
    if (val && !tags.includes(val)) {
      onChange([...tags, val]);
    }
    setInputValue("");
    setAdding(false);
  };

  const removeTag = (tag: string) => {
    onChange(tags.filter((t) => t !== tag));
  };

  const startAdding = () => {
    setAdding(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  return (
    <div
      className="feeds-tag-editor"
      style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}
    >
      {tags.map((tag) => (
        <span
          key={tag}
          className="feeds-tag"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "2px 8px",
            borderRadius: 20,
            background: "hsl(var(--muted))",
            color: "hsl(var(--muted-foreground))",
            fontSize: 11,
            fontWeight: 500,
          }}
        >
          {tag}
          {!readOnly && (
            <button
              className="feeds-tag-x"
              onClick={() => removeTag(tag)}
              style={{
                background: "transparent",
                border: 0,
                color: "hsl(var(--muted-foreground))",
                cursor: "pointer",
                padding: 0,
                fontSize: 13,
                lineHeight: 1,
                display: "flex",
                alignItems: "center",
              }}
              aria-label={`Remove tag ${tag}`}
            >
              ×
            </button>
          )}
        </span>
      ))}
      {!readOnly && (
        adding ? (
          <input
            ref={inputRef}
            className="feeds-tag-input"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitTag(); }
              if (e.key === "Escape") { setAdding(false); setInputValue(""); }
            }}
            onBlur={commitTag}
            placeholder="Add tag..."
            style={{
              border: "1px solid hsl(var(--border))",
              borderRadius: 20,
              padding: "2px 8px",
              fontSize: 11,
              outline: "none",
              width: 80,
              background: "hsl(var(--background))",
              color: "hsl(var(--foreground))",
            }}
          />
        ) : (
          <button
            className="feeds-tag-add"
            onClick={startAdding}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 2,
              padding: "2px 8px",
              borderRadius: 20,
              border: "1px dashed hsl(var(--border))",
              background: "transparent",
              color: "hsl(var(--muted-foreground))",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            + tag
          </button>
        )
      )}
    </div>
  );
};
