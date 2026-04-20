"use client";
import { jsx as _jsx } from "react/jsx-runtime";
import { CircleCheck, Info, LoaderCircle, OctagonX, TriangleAlert, } from "lucide-react";
import { useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";
const Toaster = ({ ...props }) => {
    const { theme = "system" } = useTheme();
    return (_jsx(Sonner, { theme: theme, className: "toaster group", icons: {
            success: _jsx(CircleCheck, { className: "h-4 w-4" }),
            info: _jsx(Info, { className: "h-4 w-4" }),
            warning: _jsx(TriangleAlert, { className: "h-4 w-4" }),
            error: _jsx(OctagonX, { className: "h-4 w-4" }),
            loading: _jsx(LoaderCircle, { className: "h-4 w-4 animate-spin" }),
        }, toastOptions: {
            classNames: {
                toast: "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-gray-200 group-[.toaster]:shadow-lg",
                description: "group-[.toast]:text-muted-foreground",
                actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
                cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
            },
        }, ...props }));
};
export { Toaster };
