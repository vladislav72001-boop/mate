import { useCallback, useEffect, useRef } from 'react';
import { saveCalcDraft, type CalcDraft } from './calcDraft';

export function useCalcDraftPersistence(
  inModal: boolean,
  snapshot: () => Omit<CalcDraft, 'v' | 'savedAt'>,
  deps: readonly unknown[],
  enabled = true,
) {
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const inModalRef = useRef(inModal);
  inModalRef.current = inModal;

  const flush = useCallback(() => {
    if (!enabled) return;
    const data = snapshotRef.current();
    if (data.step <= 1 && !data.destCity.trim() && !data.senderPhone.trim() && !data.receiverPhone.trim()) {
      return;
    }
    saveCalcDraft(inModalRef.current, data);
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
