import { afterEach, expect, test } from 'vitest';
import { applyAppTitle, formatAppTitle } from './app-metadata';

const originalTitle = document.title;
const originalLanguage = document.documentElement.lang;
const originalUrl = window.location.href;
afterEach(() => { document.title = originalTitle; document.documentElement.lang = originalLanguage; window.history.replaceState(null, '', originalUrl); });

test('uses only the configured product name and fixed organization suffix', () => {
  expect(formatAppTitle('PandaCloud 控制台')).toBe('PandaCloud 控制台 | Panda Labs');
  expect(formatAppTitle('  PandaAuth 账户中心  ')).toBe('PandaAuth 账户中心 | Panda Labs');
});

test('rejects missing names and title fragments instead of publishing a misleading title', () => {
  for (const name of ['', '  ', 'Product | Panda Labs', 'Product\nPage']) {
    expect(() => formatAppTitle(name)).toThrow();
  }
});

test('startup title does not take route, locale or session data', () => {
  const title = formatAppTitle('PandaFleet 管理后台');
  applyAppTitle('PandaFleet 管理后台');
  expect(document.title).toBe(title);
  window.history.replaceState(null, '', '/403?lang=en');
  document.documentElement.lang = 'en';
  applyAppTitle('PandaFleet 管理后台');
  expect(document.title).toBe(title);
});
