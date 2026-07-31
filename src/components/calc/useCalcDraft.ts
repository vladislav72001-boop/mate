import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { MIN_DRAFT_BANNER_STEP, saveCalcDraft, type CalcDraft } from './calcDraft';

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
    // Sticky skip: checkout/reset sets this so pagehide + effect cleanup do not re-save.
    if (skipFlushRef?.current) return;
    const data = snapshotRef.current();
    if (data.step < MIN_DRAFT_BANNER_STEP) return;
    saveCalcDraft(inModalRef.current, data, userIdRef.current);
  }, [enabled, skipFlushRef]);

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
