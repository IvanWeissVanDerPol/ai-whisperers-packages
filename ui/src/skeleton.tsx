import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./cn";

const skeletonVariants = cva("animate-pulse bg-muted rounded-md", {
  variants: {
    variant: {
      default: "",
      text: "h-4 w-full",
      avatar: "h-10 w-10 rounded-full",
      image: "aspect-video w-full",
      card: "h-32 w-full",
      circle: "rounded-full",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export interface SkeletonProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof skeletonVariants> {
  rows?: number;
}

export function Skeleton({ className, variant, rows = 1, ...props }: SkeletonProps) {
  if (rows > 1) {
    return (
      <div className="space-y-2" {...props}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className={cn(skeletonVariants({ variant }), className)} />
        ))}
      </div>
    );
  }
  return <div className={cn(skeletonVariants({ variant }), className)} {...props} />;
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn("h-4", i === lines - 1 ? "w-3/4" : "w-full")} />
      ))}
    </div>
  );
}

export function SkeletonCard({ hasImage = true }: { hasImage?: boolean }) {
  return (
    <div className="space-y-3">
      {hasImage && <Skeleton variant="image" />}
      <Skeleton className="h-5 w-2/3" />
      <SkeletonText lines={2} />
    </div>
  );
}
