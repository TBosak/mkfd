type Props = {
  jsonLdItemCount?: number;
  formCount?: number;
  drillChainCount?: number;
};

export function WebScrapingAnalysisPanel({ jsonLdItemCount = 0, formCount = 0, drillChainCount = 0 }: Props) {
  return (
    <div className="grid gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground sm:grid-cols-3">
      <span>JSON-LD items: <strong className="text-foreground">{jsonLdItemCount}</strong></span>
      <span>Forms: <strong className="text-foreground">{formCount}</strong></span>
      <span>Drill chains: <strong className="text-foreground">{drillChainCount}</strong></span>
    </div>
  );
}
