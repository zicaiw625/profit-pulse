import { TRANSLATIONS } from "../constants/translations";

export function translate(key, lang = "en") {
  const locale = lang?.toString().toLowerCase() ?? "en";
  const dictionary = TRANSLATIONS[locale] ?? TRANSLATIONS.en;
  return dictionary[key] ?? TRANSLATIONS.en[key] ?? key;
}
