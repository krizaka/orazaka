import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { KrizakaQueryProvider } from "@krizaka/query";
import { ThemeProvider } from "@krizaka/ui/theme";
import "./globals.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultMode="system">
      <KrizakaQueryProvider>
        <App />
      </KrizakaQueryProvider>
    </ThemeProvider>
  </StrictMode>,
);
