"use client";

import { useEffect, useRef } from "react";
import { cn } from "./cn";

export interface AnimateOnScrollProps {
  children: React.ReactNode;
  className?: string;
  stagger?: number;
  threshold?: number;
}

export function AnimateOnScroll({
  children,
  className,
  stagger,
  threshold = 0.1,
}: AnimateOnScrollProps) {
  const ref = useRef<HTMLDivElement>(null);

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

  const staggerClass =
    stagger !== undefined && stagger < 10 ? `stagger-${stagger + 1}` : "";

  return (
    <div ref={ref} className={cn("animate-on-scroll", staggerClass, className)}>
      {children}
    </div>
  );
}
