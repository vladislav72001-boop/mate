const TOKEN_KEY = 'mate_payment_return_token';
const EXPECT_KEY = 'mate_payment_expect_return';

/** Remember publicToken before Stripe redirect — survives lost/stripped return query params. */
export function stashPaymentReturnToken(publicToken: string) {
  const token = String(publicToken || '').trim();
  if (!token || typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(EXPECT_KEY, '1');
  } catch {
    /* private mode / quota */
  }
}

export function peekPaymentReturnToken(): string | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const token = sessionStorage.getItem(TOKEN_KEY);
    return token?.trim() || null;
  } catch {
    return null;
  }
}

export function clearPaymentReturnToken() {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(EXPECT_KEY);
  } catch {
    /* ignore */
  }
}

/** True once after Stripe redirect was started in this tab (or URL says payment=success). */
export function consumePaymentReturnExpected(paymentSuccessFromUrl: boolean): boolean {
  if (paymentSuccessFromUrl) return true;
  if (typeof sessionStorage === 'undefined') return false;
  try {
    const expected = sessionStorage.getItem(EXPECT_KEY) === '1';
    if (expected) sessionStorage.removeItem(EXPECT_KEY);
    return expected;
  } catch {
    return false;
  }
}

export function resolvePaymentReturnToken(urlToken?: string | null): string | null {
  const fromUrl = String(urlToken || '').trim();
  if (fromUrl) {
    try {
      sessionStorage.setItem(TOKEN_KEY, fromUrl);
    } catch {
      /* ignore */
    }
    return fromUrl;
  }
  return peekPaymentReturnToken();
}
