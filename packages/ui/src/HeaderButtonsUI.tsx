import type {
    ButtonHTMLAttributes,
    ComponentProps,
    ReactNode,
} from "react";
import {
    LIQUID_GLASS_HOVER_CLASS,
    LIQUID_GLASS_PRESSED_CLASS,
    LIQUID_GLASS_SUBTLE_CLASS,
} from "./LiquidGlassUI";

/**
 * A group of header buttons. The fill is translucent, so a caller that floats
 * the group over scrolling content adds its own `backdrop-blur-*`; in-flow
 * groups on the solid page background do not need one.
 */
export function HeaderButtonsUI({
    className = "",
    ...props
}: ComponentProps<"div">) {
    return (
        <div
            className={`flex shrink-0 items-center gap-2 rounded-full px-1 py-1 ${LIQUID_GLASS_SUBTLE_CLASS} ${className}`}
            {...props}
        />
    );
}

export type HeaderButtonUIProps = Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    "className"
> & {
    children?: ReactNode;
    className?: string;
    iconOnly?: boolean;
    /** Text with no icon: shown in full at every width. */
    labelled?: boolean;
};

export function headerButtonClassName({
    iconOnly = false,
    labelled = false,
    disabled = false,
    className = "",
}: {
    iconOnly?: boolean;
    labelled?: boolean;
    disabled?: boolean;
    className?: string;
} = {}) {
    return [
        "flex h-7 items-center justify-center rounded-full text-sm transition-colors disabled:cursor-default disabled:text-gray-300 disabled:hover:bg-transparent disabled:hover:text-gray-300",
        LIQUID_GLASS_HOVER_CLASS,
        LIQUID_GLASS_PRESSED_CLASS,
        iconOnly
            ? "w-7"
            : labelled
              ? "gap-1.5 px-3"
              : "w-7 gap-1.5 px-0 sm:w-auto sm:px-3",
        disabled ? "cursor-default" : "cursor-pointer",
        "text-gray-500 hover:text-gray-900",
        className,
    ]
        .filter(Boolean)
        .join(" ");
}

export function HeaderButtonUI({
    children,
    className,
    iconOnly = false,
    labelled = false,
    disabled,
    type = "button",
    ...props
}: HeaderButtonUIProps) {
    return (
        <button
            type={type}
            disabled={disabled}
            className={headerButtonClassName({
                iconOnly,
                labelled,
                disabled,
                className,
            })}
            {...props}
        >
            {children}
        </button>
    );
}
