import en from "./locales/en.ts";
export type TranslationMap = { readonly [key: string]: string | TranslationMap };

// English is the only plugin-owned catalog; the shared Control UI translation
// pipeline does not yet discover plugin source catalogs (see workboard/i18n).
export const messages: Readonly<Record<string, TranslationMap>> = { en };
