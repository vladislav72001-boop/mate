import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { saveCalcDraft, type CalcDraft } from './calcDraft';

export function useCalcDraftPersistence(
  inModal: boolean,
  snapshot: () => Omit<CalcDraft, 'v' | 'savedAt'>,
  deps: readonly unknown[],
  enabled = true,
  userId?: string | null,
  skipFlushRef?: RefObject<boolean>,
) {
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const inModalRef = useRef(inModal);
  inModalRef.current = inModal;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  const flush = useCallback(() => {
    if (!enabled) return;
    if (skipFlushRef?.current) {
      skipFlushRef.current = false;
      return;
    }
    const data = snapshotRef.current();
    if (data.step < 2) return;
    saveCalcDraft(inModalRef.current, data, userIdRef.current);
  }, [enabled]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
    };
  }, [flush]);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(flush, 350);
    return () => {
      window.clearTimeout(timer);
      flush();
    };
  }, [enabled, flush, ...deps]);
}
