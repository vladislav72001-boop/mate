import {
  isArrivedAtPickupPointStatus,
  mapNovaPostStatusToOrderStatus,
} from '../server/novapost/shipment.mjs';

const cases = [
  ['ArrivedAtPostomat', true, 'submitted'],
  ['Arrived at Postomat', true, 'submitted'],
  ['DeliveredToPUDO', true, 'submitted'],
  ['ReadyForPickup', true, 'submitted'],
  ['PickedUpByRecipient', false, 'delivered'],
  ['Delivered', false, 'delivered'],
  ['InTransit', false, 'submitted'],
  ['Accepted', false, 'submitted'],
  ['Issued', false, 'submitted'],
  ['ReadyToShip', false, 'waiting_from_you'],
];

let failed = 0;
for (const [status, expectArrived, expectOrder] of cases) {
  const arrived = isArrivedAtPickupPointStatus(status);
  const mapped = mapNovaPostStatusToOrderStatus(status);
  const ok = arrived === expectArrived && mapped === expectOrder;
  if (!ok) {
    failed += 1;
    console.log('FAIL', { status, arrived, expectArrived, mapped, expectOrder });
  } else {
    console.log('ok', status);
  }
}
process.exit(failed ? 1 : 0);
