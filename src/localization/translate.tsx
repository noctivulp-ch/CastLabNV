import {I18n} from "i18n-js";
import {getLocales} from "expo-localization";
import translationEn from "./strings/en.json"

import {
    ar,
    ca,
    cs,
    de,
    el,
    en,
    es,
    fr,
    he,
    hi,
    id,
    it,
    ja,
    ko,
    nl,
    pl,
    pt,
    registerTranslation,
    ro,
    ru,
    th,
    tr,
    zh
} from "react-native-paper-dates";

const translateDictionary = {
    en: {...translationEn},
}

export const initTranslate = () => {
    const i18n = new I18n(translateDictionary);
    i18n.locale = getLocales()[0].languageCode ?? 'en';
    i18n.enableFallback = true;
    return i18n;
}

export function registerPickerTranslation() {
    const local = getLocales()[0];
    const languageCode = local.languageCode ?? "en";
    switch (languageCode) {
        case "en":
            registerTranslation('en', en);
            break;
        case "ar":
            registerTranslation('ar', ar);
            break;
        case "ca":
            registerTranslation('ca', ca);
            break;
        case "de":
            registerTranslation('de', de);
            break;
        case "es":
            registerTranslation('es', es);
            break;
        case "fr":
            registerTranslation('fr', fr);
            break;
        case "he":
            registerTranslation('he', he);
            break;
        case "hi":
            registerTranslation('hi', hi);
            break;
        case "it":
            registerTranslation('it', it);
            break;
        case "ko":
            registerTranslation('ko', ko);
            break;
        case "nl":
            registerTranslation('nl', nl);
            break;
        case "pl":
            registerTranslation('pl', pl);
            break;
        case "pt":
            registerTranslation('pt', pt);
            break;
        case "tr":
            registerTranslation('tr', tr);
            break;
        case "zh":
            registerTranslation('zh', zh);
            break;
        case "cs":
            registerTranslation('cs', cs);
            break;
        case "el":
            registerTranslation('el', el);
            break;
        case "ru":
            registerTranslation('ru', ru);
            break;
        case "ro":
            registerTranslation('ro', ro);
            break;
        case "id":
            registerTranslation('id', id);
            break;
        case "ja":
            registerTranslation('ja', ja);
            break;
        case "th":
            registerTranslation('th', th);
            break;
        default:
            registerTranslation('en', en)
    }

}