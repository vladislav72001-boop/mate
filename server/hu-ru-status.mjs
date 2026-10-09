/**
 * Manual HU→RU fulfillment stages for Telegram operators.
 * Updates Mate order.status + npSnapshot.trackingTimeline (shown in client cabinet).
 */

export const HU_RU_STAGE_ORDER = ['wait', 'pickup', 'sort', 'transit', 'done'];

/** @type {Record<string, { key: string, status: string, button: string, label: string, stepId: string, title: string }>} */
export const HU_RU_STAGES = {
  wait: {
    key: 'wait',
    status: 'waiting_from_you',
    button: '📥 Ждём посылку',
    label: 'Ждём посылку от отправителя',
    stepId: 'waiting',
    title: 'Жду от Вас посылку',
  },
  pickup: {
    key: 'pickup',
    status: 'submitted',
    button: '🚚 Курьер забрал',
    label: 'Курьер забрал посылку',
    stepId: 'pickup',
    title: 'Курьер забрал посылку',
  },
  sort: {
    key: 'sort',
    status: 'submitted',
    button: '🏭 На сортировке',
    label: 'На сортировочном центре',
    stepId: 'sorting',
    title: 'На сортировочном центре',
  },
  transit: {
    key: 'transit',
    status: 'submitted',
    button: '✈️ В пути',
    label: 'В пути',
    stepId: 'transit',
    title: 'В пути',
  },
  done: {
    key: 'done',
    status: 'delivered',
    button: '✅ Доставлен',
    label: 'Доставлен',
    stepId: 'delivery',
    title: 'Доставлено',
  },
  cancel: {
    key: 'cancel',
    status: 'cancelled',
    button: '❌ Отменён',
    label: 'Отменён',
    stepId: 'cancelled',
    title: 'Заказ отменён',
  },
};

const TIMELINE_STEPS = HU_RU_STAGE_ORDER.map((key) => HU_RU_STAGES[key]);

function previousAtById(timeline) {
  const map = Object.create(null);
  if (!Array.isArray(timeline)) return map;
  for (const ev of timeline) {
    if (ev?.id && ev.at) map[ev.id] = ev.at;
  }
  return map;
}

export function buildHuRuTrackingTimeline(stageKey, { previousTimeline, paidAt } = {}) {
  const now = new Date().toISOString();
  const prevAt = previousAtById(previousTimeline);

  if (stageKey === 'cancel') {
    return [{
      id: 'cancelled',
      title: HU_RU_STAGES.cancel.title,
      at: now,
      done: true,
      current: true,
      source: 'manual',
    }];
  }

  const currentIdx = HU_RU_STAGE_ORDER.indexOf(stageKey);
  if (currentIdx < 0) return null;

  return TIMELINE_STEPS.map((step, idx) => {
    const isDoneStage = stageKey === 'done';
    const current = isDoneStage ? step.key === 'done' : idx === currentIdx;
    // "wait" stays pending; later stages mark the active step completed (like NP sync).
    const done = isDoneStage || idx < currentIdx || (current && stageKey !== 'wait');
    let at = null;
    if (done || current) {
      at = prevAt[step.stepId] || (idx === 0 ? (paidAt || now) : null) || now;
      if (current && !prevAt[step.stepId]) at = now;
    }
    return {
      id: step.stepId,
      title: step.title,
      at,
      done,
      current,
      source: 'manual',
    };
  });
}

export function resolveHuRuStageKey(order) {
  const snap = order?.npSnapshot && typeof order.npSnapshot === 'object' ? order.npSnapshot : {};
  if (snap.huRuStage && HU_RU_STAGES[snap.huRuStage]) return snap.huRuStage;
  if (order?.status === 'cancelled') return 'cancel';
  if (order?.status === 'delivered') return 'done';
  if (order?.status === 'submitted') return 'transit';
  if (order?.status === 'waiting_from_you' || order?.status === 'paid') return 'wait';
  return null;
}

/**
 * Build Prisma patch for a manual HU→RU stage change.
 * @returns {{ patch: object, stage: object } | { error: string }}
 */
export function buildHuRuStatusPatch(order, stageKey, { actorChatId } = {}) {
  const stage = HU_RU_STAGES[stageKey];
  if (!stage) return { error: 'Неизвестный статус' };

  const snap = (order.npSnapshot && typeof order.npSnapshot === 'object')
    ? { ...order.npSnapshot }
    : {};

  const timeline = buildHuRuTrackingTimeline(stageKey, {
    previousTimeline: snap.trackingTimeline,
    paidAt: order.paidAt,
  });
  if (!timeline) return { error: 'Неизвестный статус' };

  const now = new Date().toISOString();
  const patch = {
    status: stage.status,
    npSnapshot: {
      ...snap,
      provider: snap.provider || 'hu-ru',
      manualFulfillment: true,
      huRuStage: stageKey,
      trackingTimeline: timeline,
      telegramStatusUpdatedAt: now,
      telegramStatusUpdatedBy: actorChatId != null ? Number(actorChatId) : null,
    },
  };

  if (stageKey === 'cancel') {
    patch.cancelledAt = now;
  } else {
    patch.cancelledAt = null;
    patch.paidAt = order.paidAt || now;
  }

  return { patch, stage };
}
