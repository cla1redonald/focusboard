import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import "./index.css";

// Stale-tab recovery: every panel/modal is React.lazy, and each deploy renames the
// hashed chunks — a tab loaded before a deploy 404s on dynamic imports, so toolbar
// clicks silently do nothing. Vite emits `vite:preloadError` for exactly this; one
// reload fetches the fresh index.html. The sessionStorage guard (cleared after a
// successful load) prevents a reload loop if the failure isn't staleness.
window.addEventListener("vite:preloadError", (event) => {
  const GUARD = "fb-chunk-reload";
  if (sessionStorage.getItem(GUARD)) return; // already reloaded once — let it surface
  sessionStorage.setItem(GUARD, "1");
  event.preventDefault(); // handled — don't also propagate the import error
  window.location.reload();
});
window.addEventListener("load", () => {
  window.setTimeout(() => sessionStorage.removeItem("fb-chunk-reload"), 10_000);
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
