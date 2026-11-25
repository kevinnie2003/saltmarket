/** The languages the market is spoken in. */
export type Lang = 'en' | 'zh';

export const LANGS: Lang[] = ['en', 'zh'];

export function asLang(x: unknown): Lang {
  return x === 'zh' ? 'zh' : 'en';
}

/** A holder of the language in use, so text can be worded at the moment it is needed. */
export interface LangRef {
  lang?: Lang;
}

/** The language a game writes new text in. Old saves without one are English. */
export function langOf(ref: LangRef | null | undefined): Lang {
  return asLang(ref?.lang);
}

/** True when a piece of text holds Chinese characters. */
export const hasCjk = (s: string): boolean => /[㐀-鿿豈-﫿]/.test(s);
