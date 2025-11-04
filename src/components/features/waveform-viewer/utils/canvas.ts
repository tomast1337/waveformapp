const MINUTES_BASE = 60; // 60 minutes = full width

export function calculateCanvasWidth(duration: number, screenWidth: number): number {
    // 60 minutes = available container width, scale proportionally for longer/shorter audio
    // Account for main container padding (16px on each side = 32px total)
    // and canvas wrapper margins (16px on each side = 32px total)
    const totalHorizontalSpace = 64; // 32px main container padding + 32px canvas wrapper margins
    const availableWidth = Math.max(1, screenWidth - totalHorizontalSpace);
    return Math.ceil((duration / MINUTES_BASE) * availableWidth);
}

export function cssColorToRgb(cssColor: string): string {
    // Remove parentheses if present (for oklch values)
    const cleanColor = cssColor.trim();

    // Try to use the color directly first (modern browsers support oklch in canvas)
    try {
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = 1;
        tempCanvas.height = 1;
        const tempCtx = tempCanvas.getContext("2d", { willReadFrequently: true });
        if (tempCtx) {
            // Try oklch format
            if (cleanColor.includes("oklch")) {
                tempCtx.fillStyle = cleanColor;
            } else {
                tempCtx.fillStyle = cleanColor;
            }
            tempCtx.fillRect(0, 0, 1, 1);
            const data = tempCtx.getImageData(0, 0, 1, 1).data;
            return `rgb(${data[0]}, ${data[1]}, ${data[2]})`;
        }
    } catch (_e) {
        // Fallback if conversion fails
    }

    // Fallback colors based on dark/light mode
    const isDark = document.documentElement.classList.contains("dark") || window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (isDark) {
        if (cleanColor.includes("background") || cleanColor.includes("0.145") || cleanColor.includes("0.205")) {
            return "#1a1a1a";
        }
        if (cleanColor.includes("border") || cleanColor.includes("0.922")) {
            return "#404040";
        }
        if (cleanColor.includes("primary") || cleanColor.includes("0.922")) {
            return "#e5e5e5";
        }
        if (cleanColor.includes("destructive")) {
            return "#ef4444";
        }
        if (cleanColor.includes("chart")) {
            return "#22c55e";
        }
    } else {
        if (cleanColor.includes("background")) {
            return "#ffffff";
        }
        if (cleanColor.includes("border") || cleanColor.includes("0.922")) {
            return "#e5e5e5";
        }
        if (cleanColor.includes("primary")) {
            return "#171717";
        }
        if (cleanColor.includes("destructive")) {
            return "#dc2626";
        }
        if (cleanColor.includes("chart")) {
            return "#16a34a";
        }
    }
    return "#000000";
}
