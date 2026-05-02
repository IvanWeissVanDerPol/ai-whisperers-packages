// src/cn.ts
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// src/button.tsx
import * as React from "react";
import { cva } from "class-variance-authority";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
var buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 font-medium transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 select-none",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground shadow-sm hover:opacity-90 hover:shadow-md hover:-translate-y-0.5",
        secondary: "border-2 border-primary text-primary bg-transparent hover:bg-primary hover:text-primary-foreground",
        outline: "border border-border text-foreground bg-transparent hover:bg-muted",
        ghost: "text-foreground hover:bg-muted",
        link: "text-primary underline-offset-4 hover:underline",
        accent: "bg-accent text-accent-foreground shadow-sm hover:opacity-90 hover:shadow-md hover:-translate-y-0.5"
      },
      size: {
        sm: "h-9 px-4 text-sm rounded-md",
        md: "h-11 px-6 text-base rounded-md",
        lg: "h-13 px-8 text-lg rounded-lg",
        icon: "h-10 w-10 p-2 rounded-md"
      }
    },
    defaultVariants: {
      variant: "primary",
      size: "md"
    }
  }
);
function Spinner({ className }) {
  return /* @__PURE__ */ jsxs(
    "svg",
    {
      className: cn("animate-spin", className),
      xmlns: "http://www.w3.org/2000/svg",
      fill: "none",
      viewBox: "0 0 24 24",
      "aria-hidden": "true",
      children: [
        /* @__PURE__ */ jsx("circle", { className: "opacity-25", cx: "12", cy: "12", r: "10", stroke: "currentColor", strokeWidth: "4" }),
        /* @__PURE__ */ jsx("path", { className: "opacity-75", fill: "currentColor", d: "M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" })
      ]
    }
  );
}
var Button = React.forwardRef(
  ({ className, variant, size, href, children, isLoading, loadingText, disabled, ...props }, ref) => {
    const spinnerSize = size === "sm" ? "w-3.5 h-3.5" : size === "lg" ? "w-5 h-5" : "w-4 h-4";
    const content = isLoading ? /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx(Spinner, { className: spinnerSize }),
      /* @__PURE__ */ jsx("span", { children: loadingText ?? children })
    ] }) : children;
    if (href && !isLoading) {
      return /* @__PURE__ */ jsx("a", { href, className: cn(buttonVariants({ variant, size, className })), children });
    }
    return /* @__PURE__ */ jsx(
      "button",
      {
        ref,
        className: cn(buttonVariants({ variant, size, className })),
        disabled: disabled || isLoading,
        "aria-busy": isLoading || void 0,
        ...props,
        children: content
      }
    );
  }
);
Button.displayName = "Button";

// src/badge.tsx
import { cva as cva2 } from "class-variance-authority";
import { jsx as jsx2 } from "react/jsx-runtime";
var badgeVariants = cva2(
  "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium border",
  {
    variants: {
      variant: {
        default: "bg-primary/10 text-primary border-primary/20",
        secondary: "bg-secondary/10 text-secondary border-secondary/20",
        accent: "bg-accent/10 text-accent border-accent/20",
        outline: "bg-transparent text-muted-foreground border-border",
        success: "bg-success/10 text-success border-success/20",
        warning: "bg-warning/10 text-warning border-warning/20",
        destructive: "bg-destructive/10 text-destructive border-destructive/20"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);
function Badge({ className, variant, ...props }) {
  return /* @__PURE__ */ jsx2("span", { className: cn(badgeVariants({ variant }), className), ...props });
}

// src/card.tsx
import * as React2 from "react";
import { jsx as jsx3 } from "react/jsx-runtime";
var Card = React2.forwardRef(
  ({ className, ...props }, ref) => /* @__PURE__ */ jsx3(
    "div",
    {
      ref,
      className: cn("rounded-xl bg-card text-card-foreground shadow-card border border-border", className),
      ...props
    }
  )
);
Card.displayName = "Card";
var CardHeader = React2.forwardRef(
  ({ className, ...props }, ref) => /* @__PURE__ */ jsx3("div", { ref, className: cn("flex flex-col gap-1.5 p-6", className), ...props })
);
CardHeader.displayName = "CardHeader";
var CardTitle = React2.forwardRef(
  ({ className, ...props }, ref) => /* @__PURE__ */ jsx3("h3", { ref, className: cn("font-semibold leading-none tracking-tight", className), ...props })
);
CardTitle.displayName = "CardTitle";
var CardDescription = React2.forwardRef(
  ({ className, ...props }, ref) => /* @__PURE__ */ jsx3("p", { ref, className: cn("text-sm text-muted-foreground", className), ...props })
);
CardDescription.displayName = "CardDescription";
var CardContent = React2.forwardRef(
  ({ className, ...props }, ref) => /* @__PURE__ */ jsx3("div", { ref, className: cn("p-6 pt-0", className), ...props })
);
CardContent.displayName = "CardContent";
var CardFooter = React2.forwardRef(
  ({ className, ...props }, ref) => /* @__PURE__ */ jsx3("div", { ref, className: cn("flex items-center p-6 pt-0", className), ...props })
);
CardFooter.displayName = "CardFooter";

// src/skeleton.tsx
import { cva as cva3 } from "class-variance-authority";
import { jsx as jsx4, jsxs as jsxs2 } from "react/jsx-runtime";
var skeletonVariants = cva3("animate-pulse bg-muted rounded-md", {
  variants: {
    variant: {
      default: "",
      text: "h-4 w-full",
      avatar: "h-10 w-10 rounded-full",
      image: "aspect-video w-full",
      card: "h-32 w-full",
      circle: "rounded-full"
    }
  },
  defaultVariants: {
    variant: "default"
  }
});
function Skeleton({ className, variant, rows = 1, ...props }) {
  if (rows > 1) {
    return /* @__PURE__ */ jsx4("div", { className: "space-y-2", ...props, children: Array.from({ length: rows }).map((_, i) => /* @__PURE__ */ jsx4("div", { className: cn(skeletonVariants({ variant }), className) }, i)) });
  }
  return /* @__PURE__ */ jsx4("div", { className: cn(skeletonVariants({ variant }), className), ...props });
}
function SkeletonText({ lines = 3, className }) {
  return /* @__PURE__ */ jsx4("div", { className: cn("space-y-2", className), children: Array.from({ length: lines }).map((_, i) => /* @__PURE__ */ jsx4(Skeleton, { className: cn("h-4", i === lines - 1 ? "w-3/4" : "w-full") }, i)) });
}
function SkeletonCard({ hasImage = true }) {
  return /* @__PURE__ */ jsxs2("div", { className: "space-y-3", children: [
    hasImage && /* @__PURE__ */ jsx4(Skeleton, { variant: "image" }),
    /* @__PURE__ */ jsx4(Skeleton, { className: "h-5 w-2/3" }),
    /* @__PURE__ */ jsx4(SkeletonText, { lines: 2 })
  ] });
}

// src/heading.tsx
import { jsx as jsx5 } from "react/jsx-runtime";
function Heading({ as: Tag = "h2", children, className }) {
  const sizes = {
    h1: "text-4xl sm:text-5xl lg:text-6xl font-bold",
    h2: "text-3xl sm:text-4xl lg:text-5xl font-bold",
    h3: "text-2xl sm:text-3xl font-semibold",
    h4: "text-xl sm:text-2xl font-semibold"
  };
  return /* @__PURE__ */ jsx5(Tag, { className: cn("tracking-tight", sizes[Tag], className), children });
}

// src/container.tsx
import { jsx as jsx6 } from "react/jsx-runtime";
function Container({ children, className }) {
  return /* @__PURE__ */ jsx6("div", { className: cn("mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8", className), children });
}

// src/animate-on-scroll.tsx
import { useEffect, useRef } from "react";
import { jsx as jsx7 } from "react/jsx-runtime";
function AnimateOnScroll({
  children,
  className,
  stagger,
  threshold = 0.1
}) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add("is-visible");
          observer.unobserve(el);
        }
      },
      { threshold, rootMargin: "0px 0px -40px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);
  const staggerClass = stagger !== void 0 && stagger < 10 ? `stagger-${stagger + 1}` : "";
  return /* @__PURE__ */ jsx7("div", { ref, className: cn("animate-on-scroll", staggerClass, className), children });
}

// src/section.tsx
import { jsx as jsx8 } from "react/jsx-runtime";
var spacingClasses = {
  sm: "py-12 sm:py-16",
  md: "py-16 sm:py-20",
  lg: "py-20 sm:py-28",
  xl: "py-28 sm:py-36"
};
var backgroundClasses = {
  surface: "bg-card",
  muted: "bg-muted",
  background: "bg-background",
  primary: "bg-primary text-primary-foreground",
  none: ""
};
function Section({
  children,
  id,
  spacing = "md",
  background = "background",
  fullWidth = false,
  className
}) {
  return /* @__PURE__ */ jsx8(
    "section",
    {
      id,
      className: cn(spacingClasses[spacing], backgroundClasses[background], className),
      children: fullWidth ? children : /* @__PURE__ */ jsx8(Container, { children })
    }
  );
}
export {
  AnimateOnScroll,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Container,
  Heading,
  Section,
  Skeleton,
  SkeletonCard,
  SkeletonText,
  cn
};
