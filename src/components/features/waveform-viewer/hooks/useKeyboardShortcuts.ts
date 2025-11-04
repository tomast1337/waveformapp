import { useEffect } from "react";

export interface KeyboardShortcuts {
    [key: string]: (event: KeyboardEvent) => void | Promise<void>;
}

export function useKeyboardShortcuts(shortcuts: KeyboardShortcuts) {
    useEffect(() => {
        const handleKeyDown = async (event: KeyboardEvent) => {
            // Don't trigger if user is typing in an input field
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || (event.target as HTMLElement)?.isContentEditable) {
                return;
            }

            const handler = shortcuts[event.code] || shortcuts[event.key];
            if (handler) {
                event.preventDefault();
                await handler(event);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [shortcuts]);
}
