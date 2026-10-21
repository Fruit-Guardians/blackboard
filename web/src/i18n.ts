/**
 * Interface language. Only the viewer's own words are translated: what Agents and people wrote,
 * and the digest the Agent reads, stay exactly as stored.
 *
 * The language is fixed for the page's lifetime, so plain module-level `t()` calls are safe;
 * switching stores the choice and reloads.
 */
import { zhCN, type MessageKey, type Messages } from './locales/zh-CN';
import { zhHK } from './locales/zh-HK';
import { en } from './locales/en';
import { ja } from './locales/ja';

export type Locale = 'zh-CN' | 'zh-HK' | 'en' | 'ja';
export const LOCALES: { id: Locale; name: string }[] = [
  { id: 'zh-CN', name: '简体中文' }, { id: 'zh-HK', name: '繁體中文' }, { id: 'en', name: 'English' }, { id: 'ja', name: '日本語' },
];
const CATALOGUES: Record<Locale, Messages> = { 'zh-CN': zhCN, 'zh-HK': zhHK, en, ja };
const STORAGE_KEY = 'blackboard-pref-locale';

/** The first supported language in the browser's list; any Traditional Chinese (by script or region) gets zh-HK. */
export function matchLocale(tags: readonly string[]): Locale {
  for (const raw of tags) {
    const tag = raw.toLowerCase();
    if (tag === 'zh' || tag.startsWith('zh-')) return /hant|-tw|-hk|-mo/.test(tag) ? 'zh-HK' : 'zh-CN';
    if (tag === 'ja' || tag.startsWith('ja-')) return 'ja';
    if (tag === 'en' || tag.startsWith('en-')) return 'en';
  }
  return 'en';
}

function stored(): Locale | null {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return typeof value === 'string' && value in CATALOGUES ? value as Locale : null;
  } catch { return null; }
}

const browserTags = () => typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language || ''];
/** Outside a page (tests; Node has `navigator` but no `document`) the source catalogue applies. */
export const locale: Locale = stored() ?? (typeof document === 'undefined' ? 'zh-CN' : matchLocale(browserTags()));
export const followsBrowser = () => stored() === null;
const messages = CATALOGUES[locale];

/** `null` goes back to following the browser. */
export function setLocale(next: Locale | null) {
  try {
    if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* the choice just won't stick */ }
  location.reload();
}

/** `{name}` placeholders; a `one|many` message picks its form by `n`. */
export function t(key: MessageKey, vars?: Record<string, string | number>) {
  let text = messages[key] ?? zhCN[key];
  if (vars && 'n' in vars && text.includes('|')) {
    const [one, many] = text.split('|');
    text = Number(vars.n) === 1 ? one : many;
  }
  return vars ? text.replace(/\{(\w+)\}/g, (all, name) => name in vars ? String(vars[name]) : all) : text;
}

/** For labels keyed by stored values (`type.finding`); unknown values have no translation. */
export function tOptional(key: string) {
  return key in messages ? messages[key as MessageKey] : undefined;
}

const DIGEST_KEYS: Record<string, MessageKey> = Object.fromEntries(
  (Object.keys(zhCN) as MessageKey[])
    .filter((key) => /^(digest\.(section|stat)|type|relation|confidence)\./.test(key) && !key.endsWith('.unset'))
    .map((key) => [zhCN[key], key]),
);

/**
 * The digest is generated in Chinese for the Agent. Its fixed vocabulary (section headings, counts,
 * node types, relations, confidence) can be shown in the interface language; everything else is
 * the Agent's text and stays as written.
 */
export function digestTerm(text: string) {
  const key = DIGEST_KEYS[text.trim()];
  return key ? t(key) : text;
}
