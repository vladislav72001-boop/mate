export type Locale = 'en' | 'hu' | 'ru' | 'uk';

export type MessageTree = {
  [key: string]: string | MessageTree;
};

export type TranslateVars = Record<string, string | number>;
