import { ClassValue } from 'clsx';
import * as class_variance_authority_types from 'class-variance-authority/types';
import * as React$1 from 'react';
import { VariantProps } from 'class-variance-authority';
import * as react_jsx_runtime from 'react/jsx-runtime';

declare function cn(...inputs: ClassValue[]): string;

declare const buttonVariants: (props?: ({
    variant?: "primary" | "secondary" | "outline" | "ghost" | "link" | "accent" | null | undefined;
    size?: "sm" | "md" | "lg" | "icon" | null | undefined;
} & class_variance_authority_types.ClassProp) | undefined) => string;
interface ButtonProps extends React$1.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
    isLoading?: boolean;
    loadingText?: string;
    href?: string;
}
declare const Button: React$1.ForwardRefExoticComponent<ButtonProps & React$1.RefAttributes<HTMLButtonElement>>;

declare const badgeVariants: (props?: ({
    variant?: "secondary" | "outline" | "accent" | "default" | "success" | "warning" | "destructive" | null | undefined;
} & class_variance_authority_types.ClassProp) | undefined) => string;
interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
}
declare function Badge({ className, variant, ...props }: BadgeProps): react_jsx_runtime.JSX.Element;

declare const Card: React$1.ForwardRefExoticComponent<React$1.HTMLAttributes<HTMLDivElement> & React$1.RefAttributes<HTMLDivElement>>;
declare const CardHeader: React$1.ForwardRefExoticComponent<React$1.HTMLAttributes<HTMLDivElement> & React$1.RefAttributes<HTMLDivElement>>;
declare const CardTitle: React$1.ForwardRefExoticComponent<React$1.HTMLAttributes<HTMLHeadingElement> & React$1.RefAttributes<HTMLHeadingElement>>;
declare const CardDescription: React$1.ForwardRefExoticComponent<React$1.HTMLAttributes<HTMLParagraphElement> & React$1.RefAttributes<HTMLParagraphElement>>;
declare const CardContent: React$1.ForwardRefExoticComponent<React$1.HTMLAttributes<HTMLDivElement> & React$1.RefAttributes<HTMLDivElement>>;
declare const CardFooter: React$1.ForwardRefExoticComponent<React$1.HTMLAttributes<HTMLDivElement> & React$1.RefAttributes<HTMLDivElement>>;

declare const skeletonVariants: (props?: ({
    variant?: "text" | "circle" | "default" | "avatar" | "image" | "card" | null | undefined;
} & class_variance_authority_types.ClassProp) | undefined) => string;
interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof skeletonVariants> {
    rows?: number;
}
declare function Skeleton({ className, variant, rows, ...props }: SkeletonProps): react_jsx_runtime.JSX.Element;
declare function SkeletonText({ lines, className }: {
    lines?: number;
    className?: string;
}): react_jsx_runtime.JSX.Element;
declare function SkeletonCard({ hasImage }: {
    hasImage?: boolean;
}): react_jsx_runtime.JSX.Element;

interface HeadingProps {
    as?: "h1" | "h2" | "h3" | "h4";
    children: React.ReactNode;
    className?: string;
}
declare function Heading({ as: Tag, children, className }: HeadingProps): react_jsx_runtime.JSX.Element;

interface ContainerProps {
    children: React.ReactNode;
    className?: string;
}
declare function Container({ children, className }: ContainerProps): react_jsx_runtime.JSX.Element;

interface AnimateOnScrollProps {
    children: React.ReactNode;
    className?: string;
    stagger?: number;
    threshold?: number;
}
declare function AnimateOnScroll({ children, className, stagger, threshold, }: AnimateOnScrollProps): react_jsx_runtime.JSX.Element;

type Spacing = "sm" | "md" | "lg" | "xl";
type Bg = "surface" | "muted" | "background" | "primary" | "none";
interface SectionProps {
    children: React.ReactNode;
    id?: string;
    spacing?: Spacing;
    background?: Bg;
    fullWidth?: boolean;
    className?: string;
}
declare function Section({ children, id, spacing, background, fullWidth, className, }: SectionProps): react_jsx_runtime.JSX.Element;

export { AnimateOnScroll, type AnimateOnScrollProps, Badge, type BadgeProps, Button, type ButtonProps, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, Container, type ContainerProps, Heading, type HeadingProps, Section, type SectionProps, Skeleton, SkeletonCard, type SkeletonProps, SkeletonText, cn };
