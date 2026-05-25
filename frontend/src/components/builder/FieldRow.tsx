import React from "react";

interface FieldRowProps {
  columns?: 2 | 3;
  children: React.ReactNode;
}

export const FieldRow: React.FC<FieldRowProps> = ({ columns = 2, children }) => {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap: "0 16px",
      }}
    >
      {children}
    </div>
  );
};
