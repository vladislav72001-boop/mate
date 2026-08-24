// Pick NP slot that matches the user window (exact match preferred).
function hhmmToMinutes(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  return h * 60 + m;
}
function pickNpTimeSlot(slots, userFrom, userTo) {
  if (!Array.isArray(slots) || !slots.length) return null;
  for (const slot of slots) {
    if (slot?.from === userFrom && slot?.to === userTo) return slot;
  }
  let best = null;
  let bestOverlap = -1;
  for (const slot of slots) {
    const sFrom = hhmmToMinutes(slot?.from);
    const sTo = hhmmToMinutes(slot?.to);
    const uFrom = hhmmToMinutes(userFrom);
    const uTo = hhmmToMinutes(userTo);
    const overlap = Math.max(0, Math.min(uTo, sTo) - Math.max(uFrom, sFrom));
    if (overlap > bestOverlap) { bestOverlap = overlap; best = slot; }
  }
  return best;
}

const slots = [
  { from: '10:00', to: '11:30' },
  { from: '11:30', to: '13:00' },
  { from: '13:00', to: '14:30' },
  { from: '14:30', to: '16:00' },
  { from: '16:00', to: '17:30' },
];

const exact = pickNpTimeSlot(slots, '14:30', '16:00');
console.assert(exact?.from === '14:30' && exact?.to === '16:00', 'exact slot');

const near = pickNpTimeSlot(slots, '14:00', '14:45');
console.assert(near?.from === '13:00' && near?.to === '14:30', 'overlap slot');

console.log('pickup-slot ok');
