/**
 * This file is the entry point for the React app, it sets up the root
 * element and renders the App component to the DOM.
 *
 * It is included in `src/index.html`.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const elem = document.getElementById("root");
if (!elem) {
    throw new Error("Root element not found");
}

// Apply dark mode to html element
document.documentElement.classList.add("dark");

const app = (
    <StrictMode>
        <App />
    </StrictMode>
);

if (import.meta.hot) {
    // With hot module reloading, `import.meta.hot.data` is persisted.
    let root = import.meta.hot.data.root;
    if (!root) {
        root = createRoot(elem);
        import.meta.hot.data.root = root;
    }
    root.render(app);
} else {
    // The hot module reloading API is not available in production.
    createRoot(elem).render(app);
}
