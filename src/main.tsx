import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppV2 } from "./v2/AppV2";
import "./index.css";
import { mountPerfOverlay } from "./debug/perfOverlay";

mountPerfOverlay();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {new URLSearchParams(location.search).get("ui") === "v1" ? <App /> : <AppV2 />}
  </StrictMode>,
);
