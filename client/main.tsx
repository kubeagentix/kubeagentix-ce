import "./global.css";

import { createRoot } from "react-dom/client";
import { App } from "./App";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

// Only create root if it doesn't already exist
const root = createRoot(rootElement);
root.render(<App />);
