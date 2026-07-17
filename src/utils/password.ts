export type PasswordStrength = {
  score: number;
  level: 'empty' | 'weak' | 'medium' | 'strong';
  width: string;
};

export function getPasswordStrength(password: string): PasswordStrength {
  if (!password) return { score: 0, level: 'empty', width: '0%' };

  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[A-ZА-Я]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-zА-Яа-я0-9]/.test(password)) score += 1;

  if (score <= 2) return { score, level: 'weak', width: '33%' };
  if (score <= 3) return { score, level: 'medium', width: '66%' };
  return { score, level: 'strong', width: '100%' };
}
