import { defineStore } from 'pinia';
import { watch } from 'vue';
import { useSettingsStore } from './settings';

/**
 * Supported locale codes
 */
export const SUPPORTED_LOCALES = ['en', 'pl'] as const
export type SupportedLocale = typeof SUPPORTED_LOCALES[number]

export interface Locale {
    code: string;
    name: string;
    rtl?: boolean;
    data: Record<string, string>;
    intlCode?: string;
    preparedStrings?: Map<string, string>;
}

export interface LocaleStore {
    locales: Map<string, Locale>;
    defaultLocale: string;
    currentLocale: Locale;
    dir: 'ltr' | 'rtl';
}

export const useLocalization = defineStore('localization', {
    state: (): LocaleStore => {
        return {
            locales: new Map<string, Locale>(),
            dir: 'ltr',
            defaultLocale: 'unk',
            currentLocale: {
                code: 'unk',
                name: 'Unknown',
                data: {}
            },
        }
    },
    actions: {
        init(locales: Locale[], defaultLocale = 'en') {
            this.defaultLocale = defaultLocale;
            this.locales = new Map(locales.map(e => [
                e.code,
                {
                    ...e,
                    intlCode: e.code.replace('_', '-')
                }
            ]));

            if (!this.locales.has(this.defaultLocale)) {
                console.error(`Default locale (${this.defaultLocale}) does not exist.`);
            }

            const settings = useSettingsStore();
            this.setLocale(settings.settings.language);
            watch(() => settings.settings.language, () => {
                this.setLocale(settings.settings.language);
            });
        },

        formatString(str: string, args: any) {
            // Support both named parameters {count} and positional {0}
            if (Array.isArray(args)) {
                // Positional: ['value1', 'value2'] → {0}, {1}
                return str.replace(/{(\d+)}/g, (m, i) =>
                    i < args.length ? String(args[i]) : m
                );
            } else if (typeof args === 'object' && args !== null) {
                // Named: { count: 5, name: 'John' } → {count}, {name}
                return str.replace(/{(\w+)}/g, (m, key) =>
                    key in args ? String(args[key]) : m
                );
            }
            return str;
        },

        prepareLocale(locale: Locale) {
            if (locale.preparedStrings) return;
            const defaultLocale = this.locales.get(this.defaultLocale) ?? { code: this.defaultLocale, data: {} };

            const strings = locale.data;

            if (locale.code != this.defaultLocale) {
                for (let [key, value] of Object.entries(defaultLocale.data)) {
                    key = key.replace(/:OTHER$/, '');
                    if (key.includes(':')) continue;
                    if (strings[key]) continue;

                    strings[key] = value;
                }
            }

            locale.preparedStrings = new Map(Object.entries(strings));
        },
        setLocale(locale: string) {
            const localeObj = this.locales.get(locale);
            if (!localeObj) {
                if (locale == this.defaultLocale) return;
                this.setLocale(this.defaultLocale);
                return;
            }
            this.prepareLocale(localeObj);
            this.currentLocale = localeObj;
        }
    },
    getters: {
        t(this: any, state) {
            return (key: string, ...args: any[]) => {
                const template = state.currentLocale.preparedStrings?.get(key) || key;
                // If first arg is object, treat as named params, otherwise positional
                const params = args.length === 1 && typeof args[0] === 'object' && !Array.isArray(args[0])
                    ? args[0]
                    : args;
                return this.formatString(template, params);
            };
        },
        tRaw(this: any, state) {
            return (key: string) => String(state.currentLocale.preparedStrings?.get(key) || key);
        },
        // takes string in format of LOCALE_KEY;['arg1','arg2']
        // array is in json format
        tArgsFromStr(this: any, state) {
            return (key: string) => {
                const re = /(?<!\\);/gs;
                const fallback = String(state.currentLocale.preparedStrings?.get(key) || key);
                try {
                    if (!re.test(key)) return fallback;
                    const elements = key.split(re);
                    if (elements.length != 2) return fallback;
                    const localeKey = elements[0] ?? '';
                    if (!state.currentLocale.preparedStrings?.has(localeKey)) return fallback;
                    const args = JSON.parse(elements[1] ?? '');
                    if (!args) return fallback;
                    return this.formatString(state.currentLocale.preparedStrings?.get(localeKey), args);
                } catch {
                    return fallback;
                }
            };
        },
        // takes string in format of LOCALE_KEY;['arg1','arg2'];context
        // array is in json format
        tArgsFromStrCtx(this: any, state) {
            return (key: string) => {
                const re = /(?<!\\);/gs;
                const fallback = {
                    str: String(state.currentLocale.preparedStrings?.get(key) || key),
                    context: null
                };

                try {
                    if (!re.test(key)) return fallback;
                    const elements = key.split(re);
                    if (elements.length < 2) return fallback;
                    const localeKey = elements[0] ?? '';
                    if (!state.currentLocale.preparedStrings?.has(localeKey)) return fallback;
                    const args = JSON.parse(elements[1] ?? '');
                    if (!args) return fallback;
                    return {
                        str: this.formatString(state.currentLocale.preparedStrings?.get(localeKey), args),
                        context: elements[2] ?? null
                    };
                } catch {
                    return fallback;
                }
            };
        },
        tPlural(this: any, state) {
            const rules = new Intl.PluralRules(state.currentLocale.intlCode);
            const strings = state.currentLocale.preparedStrings;
            return (key: string, value: number | string, ...args: (string | number)[]) => {
                const numValue = isNaN(+value) ? 0 : +value;
                return this.formatString(strings?.get(`${key}:${rules.select(numValue).toUpperCase()}`) || strings?.get(key) || strings?.get(`${key}:OTHER`) || key, [value, ...args]);
            }
        }
    }
});