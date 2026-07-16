import '../load-env.mjs';
import { createInternationalShipment } from '../novapost/shipment.mjs';

/**
 * DEV ONLY — creates a REAL shipment in Nova Post. Do not run in production loops.
 * Usage: node server/scripts/test-np-shipment.mjs
 */

const body = {
  sender: {
    country: 'HU',
    line: 'Венгрия, Budapest, Váci út 1',
    name: 'Влад',
    email: 'test@matedelivery.com',
    phone: '+36701234567',
  },
  receiver: {
    firstName: 'Vladislav',
    lastName: 'Sherbakov',
    phone: '+49301234567',
    email: 'test@matedelivery.com',
    destinationLine: 'Германия, Berlin, Friedrichstraße 43',
    country: 'DE',
  },
  parcel: {
    boxSize: 'L',
    lengthCm: 39,
    widthCm: 38,
    heightCm: 64,
    weightKg: 20,
    declaredValue: 100,
    description: 'Parcel L — test',
    fragile: true,
    insurance: false,
  },
};

const result = await createInternationalShipment(body, `MD-TEST-${Date.now()}`);
console.log(JSON.stringify(result, null, 2));
