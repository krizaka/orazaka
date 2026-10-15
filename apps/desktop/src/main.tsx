import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@krizaka/ui/theme";
import "./globals.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultMode="system">
      <App />
    </ThemeProvider>
  </StrictMode>,
);
