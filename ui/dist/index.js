"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  AnimateOnScroll: () => AnimateOnScroll,
  Badge: () => Badge,
  Button: () => Button,
  Card: () => Card,
  CardContent: () => CardContent,
  CardDescription: () => CardDescription,
  CardFooter: () => CardFooter,
  CardHeader: () => CardHeader,
  CardTitle: () => CardTitle,
  Container: () => Container,
  Heading: () => Heading,
  Section: () => Section,
  Skeleton: () => Skeleton,
  SkeletonCard: () => SkeletonCard,
  SkeletonText: () => SkeletonText,
  cn: () => cn
});
module.exports = __toCommonJS(index_exports);

// src/cn.ts
var import_clsx = require("clsx");
var import_tailwind_merge = require("tailwind-merge");
function cn(...inputs) {
  return (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));
}

// src/button.tsx
var React = __toESM(require("react"));
var import_class_variance_authority = require("class-variance-authority");
var import_jsx_runtime = require("react/jsx-runtime");
var buttonVariants = (0, import_class_variance_authority.cva)(
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
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "svg",
    {
      className: cn("animate-spin", className),
      xmlns: "http://www.w3.org/2000/svg",
      fill: "none",
      viewBox: "0 0 24 24",
      "aria-hidden": "true",
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { className: "opacity-25", cx: "12", cy: "12", r: "10", stroke: "currentColor", strokeWidth: "4" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { className: "opacity-75", fill: "currentColor", d: "M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" })
      ]
    }
  );
}
var Button = React.forwardRef(
  ({ className, variant, size, href, children, isLoading, loadingText, disabled, ...props }, ref) => {
    const spinnerSize = size === "sm" ? "w-3.5 h-3.5" : size === "lg" ? "w-5 h-5" : "w-4 h-4";
    const content = isLoading ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Spinner, { className: spinnerSize }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: loadingText ?? children })
    ] }) : children;
    if (href && !isLoading) {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", { href, className: cn(buttonVariants({ variant, size, className })), children });
    }
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
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
var import_class_variance_authority2 = require("class-variance-authority");
var import_jsx_runtime2 = require("react/jsx-runtime");
var badgeVariants = (0, import_class_variance_authority2.cva)(
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
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: cn(badgeVariants({ variant }), className), ...props });
}

// src/card.tsx
var React2 = __toESM(require("react"));
var import_jsx_runtime3 = require("react/jsx-runtime");
var Card = React2.forwardRef(
  ({ className, ...props }, ref) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
  ({ className, ...props }, ref) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { ref, className: cn("flex flex-col gap-1.5 p-6", className), ...props })
);
CardHeader.displayName = "CardHeader";
var CardTitle = React2.forwardRef(
  ({ className, ...props }, ref) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h3", { ref, className: cn("font-semibold leading-none tracking-tight", className), ...props })
);
CardTitle.displayName = "CardTitle";
var CardDescription = React2.forwardRef(
  ({ className, ...props }, ref) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { ref, className: cn("text-sm text-muted-foreground", className), ...props })
);
CardDescription.displayName = "CardDescription";
var CardContent = React2.forwardRef(
  ({ className, ...props }, ref) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { ref, className: cn("p-6 pt-0", className), ...props })
);
CardContent.displayName = "CardContent";
var CardFooter = React2.forwardRef(
  ({ className, ...props }, ref) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { ref, className: cn("flex items-center p-6 pt-0", className), ...props })
);
CardFooter.displayName = "CardFooter";

// src/skeleton.tsx
var import_class_variance_authority3 = require("class-variance-authority");
var import_jsx_runtime4 = require("react/jsx-runtime");
var skeletonVariants = (0, import_class_variance_authority3.cva)("animate-pulse bg-muted rounded-md", {
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
    return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "space-y-2", ...props, children: Array.from({ length: rows }).map((_, i) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: cn(skeletonVariants({ variant }), className) }, i)) });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: cn(skeletonVariants({ variant }), className), ...props });
}
function SkeletonText({ lines = 3, className }) {
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: cn("space-y-2", className), children: Array.from({ length: lines }).map((_, i) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Skeleton, { className: cn("h-4", i === lines - 1 ? "w-3/4" : "w-full") }, i)) });
}
function SkeletonCard({ hasImage = true }) {
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "space-y-3", children: [
    hasImage && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Skeleton, { variant: "image" }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Skeleton, { className: "h-5 w-2/3" }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(SkeletonText, { lines: 2 })
  ] });
}

// src/heading.tsx
var import_jsx_runtime5 = require("react/jsx-runtime");
function Heading({ as: Tag = "h2", children, className }) {
  const sizes = {
    h1: "text-4xl sm:text-5xl lg:text-6xl font-bold",
    h2: "text-3xl sm:text-4xl lg:text-5xl font-bold",
    h3: "text-2xl sm:text-3xl font-semibold",
    h4: "text-xl sm:text-2xl font-semibold"
  };
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Tag, { className: cn("tracking-tight", sizes[Tag], className), children });
}

// src/container.tsx
var import_jsx_runtime6 = require("react/jsx-runtime");
function Container({ children, className }) {
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: cn("mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8", className), children });
}

// src/animate-on-scroll.tsx
var import_react = require("react");
var import_jsx_runtime7 = require("react/jsx-runtime");
function AnimateOnScroll({
  children,
  className,
  stagger,
  threshold = 0.1
}) {
  const ref = (0, import_react.useRef)(null);
  (0, import_react.useEffect)(() => {
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
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { ref, className: cn("animate-on-scroll", staggerClass, className), children });
}

// src/section.tsx
var import_jsx_runtime8 = require("react/jsx-runtime");
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
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
    "section",
    {
      id,
      className: cn(spacingClasses[spacing], backgroundClasses[background], className),
      children: fullWidth ? children : /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Container, { children })
    }
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
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
});
