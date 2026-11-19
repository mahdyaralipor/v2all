import { enhancePage } from "./interactions";

// Production serves the prerendered React markup without shipping its runtime.
if (import.meta.env.DEV) {
  void Promise.all([
    import("react-dom/client"),
    import("react"),
    import("./App"),
  ]).then(([{ createRoot }, { createElement }, { default: App }]) => {
    createRoot(document.getElementById("root")!).render(createElement(App));
  });
} else {
  enhancePage(document);
}
