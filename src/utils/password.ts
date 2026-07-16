export function getPasswordStrength(password: string) {
  if (!password) return { score: 0, label: '', width: '0%' };

  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[A-ZА-Я]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-zА-Яа-я0-9]/.test(password)) score += 1;

  if (score <= 2) return { score, label: 'Слабый пароль', width: '33%' };
  if (score <= 3) return { score, label: 'Средний пароль', width: '66%' };
  return { score, label: 'Надёжный пароль', width: '100%' };
}
