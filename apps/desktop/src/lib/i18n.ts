import { createI18n, format } from "@krizaka/i18n";
import { createI18nReact } from "@krizaka/i18n/react";
import en from "../messages/en.json";
import fr from "../messages/fr.json";

export type Locale = "en" | "fr";
export type Messages = typeof en;

// `fr.json` is type-checked against `en.json`: a missing key fails to compile.
export const i18n = createI18n<Messages, Locale>({ en, fr }, { defaultLocale: "en" });
export const { I18nProvider, useI18n } = createI18nReact(i18n);
export { format };
