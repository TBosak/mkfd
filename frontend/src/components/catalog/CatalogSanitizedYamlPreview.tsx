type Props = {
  yaml?: string;
  errors?: Array<{ path: string; message: string }>;
  warnings?: Array<{ path: string; message: string }>;
};

export function CatalogSanitizedYamlPreview({ yaml, errors = [], warnings = [] }: Props) {
  return (
    <div className="space-y-3">
      {errors.length > 0 && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {errors.map((error) => <div key={`${error.path}-${error.message}`}>{error.path}: {error.message}</div>)}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700">
          {warnings.map((warning) => <div key={`${warning.path}-${warning.message}`}>{warning.path}: {warning.message}</div>)}
        </div>
      )}
      <pre className="max-h-80 overflow-auto rounded-md border bg-muted/30 p-3 text-xs">{yaml ?? "Sanitized YAML will appear here."}</pre>
    </div>
  );
}
