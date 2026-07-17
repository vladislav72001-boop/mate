import type { TranslateVars } from '../i18n/types';

type TFn = (key: string, vars?: TranslateVars) => string;

/** Map known Russian/server error messages to i18n keys. */
const EXACT: Record<string, string> = {
  'Требуется авторизация': 'errors.authRequired',
  'Сессия истекла. Войдите снова': 'errors.sessionExpired',
  'Сессия истекла. Войдите снова.': 'errors.sessionExpired',
  'Аккаунт с таким email уже существует': 'errors.emailExists',
  'Неверный логин или пароль': 'errors.badCredentials',
  'Заказ не найден': 'errors.orderNotFound',
  'Не удалось оформить заказ': 'errors.checkoutFailed',
  'Не удалось сохранить адрес': 'errors.addressSaveFail',
  'Не удалось сохранить профиль': 'errors.profileSaveFail',
  'Ошибка запроса': 'errors.requestFailed',
  'Произошла ошибка': 'errors.generic',
  'Нет сессии': 'errors.noSession',
  'Сервер не отвечает. Запустите npm run dev': 'errors.serverDownDev',
  'Сервер не отвечает. Убедитесь, что запущен npm run dev': 'errors.serverDownDev',
  'Не удалось связаться с сервером. Запустите npm run dev': 'errors.serverDownDev',
  'Сервер не отвечает. Попробуйте ещё раз через минуту': 'errors.serverDownRetry',
  'Временная ошибка сервера': 'errors.serverTemp',
};

export function localizeApiError(message: string | undefined | null, t: TFn, fallbackKey = 'errors.generic') {
  const raw = String(message || '').trim();
  if (!raw) return t(fallbackKey);
  if (raw.startsWith('errors.') || raw.startsWith('auth.') || raw.startsWith('calc.')) {
    const translated = t(raw);
    return translated === raw ? t(fallbackKey) : translated;
  }
  const key = EXACT[raw];
  if (key) return t(key);
  // Multi-line validation errors from server — translate line by line when possible
  if (raw.includes('\n')) {
    return raw.split('\n').map((line) => localizeApiError(line, t, fallbackKey)).join('\n');
  }
  return raw;
}
