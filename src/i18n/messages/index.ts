import type { Locale } from '../types';
import { en } from './en';
import { hu } from './hu';
import { ru } from './ru';
import { uk } from './uk';

export const messages: Record<Locale, typeof ru> = {
  ru,
  en,
  hu,
  uk,
};

export { ru, en, hu, uk };
