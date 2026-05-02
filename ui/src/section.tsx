import { cn } from "./cn";
import { Container } from "./container";

type Spacing = "sm" | "md" | "lg" | "xl";
type Bg = "surface" | "muted" | "background" | "primary" | "none";

export interface SectionProps {
  children: React.ReactNode;
  id?: string;
  spacing?: Spacing;
  background?: Bg;
  fullWidth?: boolean;
  className?: string;
}

const spacingClasses: Record<Spacing, string> = {
  sm: "py-12 sm:py-16",
  md: "py-16 sm:py-20",
  lg: "py-20 sm:py-28",
  xl: "py-28 sm:py-36",
};

const backgroundClasses: Record<Bg, string> = {
  surface: "bg-card",
  muted: "bg-muted",
  background: "bg-background",
  primary: "bg-primary text-primary-foreground",
  none: "",
};

export function Section({
  children,
  id,
  spacing = "md",
  background = "background",
  fullWidth = false,
  className,
}: SectionProps) {
  return (
    <section
      id={id}
      className={cn(spacingClasses[spacing], backgroundClasses[background], className)}
    >
      {fullWidth ? children : <Container>{children}</Container>}
    </section>
  );
}
