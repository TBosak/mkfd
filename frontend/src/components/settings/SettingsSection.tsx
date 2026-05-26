import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type SettingsSectionProps = {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
};

/**
 * A card-based section grouping related settings rows.
 * Renders a consistent header and divides children with subtle horizontal rules.
 */
export function SettingsSection({
  title,
  description,
  children,
  className,
}: SettingsSectionProps) {
  return (
    <Card
      className={cn("border", className)}
      style={{ borderColor: "var(--wb-outline)", background: "var(--wb-card)" }}
    >
      <CardHeader className="pb-1 pt-4 px-5">
        <h3 className="text-sm font-semibold tracking-tight text-foreground">{title}</h3>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </CardHeader>
      <CardContent className="px-5 pb-4 pt-0">
        <div className="divide-y divide-border/60">{children}</div>
      </CardContent>
    </Card>
  );
}
