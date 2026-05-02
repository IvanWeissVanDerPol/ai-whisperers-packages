import { cn } from "./cn";

export interface HeadingProps {
  as?: "h1" | "h2" | "h3" | "h4";
  children: React.ReactNode;
  className?: string;
}

export function Heading({ as: Tag = "h2", children, className }: HeadingProps) {
  const sizes = {
    h1: "text-4xl sm:text-5xl lg:text-6xl font-bold",
    h2: "text-3xl sm:text-4xl lg:text-5xl font-bold",
    h3: "text-2xl sm:text-3xl font-semibold",
    h4: "text-xl sm:text-2xl font-semibold",
  };

  return <Tag className={cn("tracking-tight", sizes[Tag], className)}>{children}</Tag>;
}
