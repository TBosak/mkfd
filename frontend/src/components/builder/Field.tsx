import React from "react";

interface FieldProps {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}

export const Field: React.FC<FieldProps> = ({ label, htmlFor, required, hint, children }) => {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
        <label
          htmlFor={htmlFor}
          style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--foreground))" }}
        >
          {label}
        </label>
        {required !== undefined && (
          <span
            style={{
              fontSize: 10,
              padding: "1px 6px",
              borderRadius: 20,
              background: required ? "#fadcd9" : "hsl(var(--muted))",
              color: required ? "#b91c1c" : "hsl(var(--muted-foreground))",
              fontWeight: 600,
            }}
          >
            {required ? "required" : "optional"}
          </span>
        )}
      </div>
      {children}
      {hint && (
        <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>
          {hint}
        </div>
      )}
    </div>
  );
};
