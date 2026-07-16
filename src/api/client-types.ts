export type TrackingEvent = {
  id: string;
  title: string;
  at: string | null;
  done: boolean;
  current?: boolean;
};

export type ShippingOrder = {
  id: string;
  orderNumber: string;
  publicToken: string;
  status: string;
  amount: number;
  currency: string;
  npTtn: string | null;
  npValid?: boolean;
  fromCountry?: string;
  toCountry?: string;
  parcelSize?: string;
  weightKg?: number;
  fragile?: boolean;
  insurance?: boolean;
  pickupDate?: string;
  pickupTime?: string;
  senderName?: string;
  senderLine?: string;
  senderPhone?: string;
  receiverName?: string;
  receiverLine?: string;
  receiverPhone?: string;
  customerEmail?: string;
  createdAt: string;
  paidAt: string | null;
  cancelledAt?: string | null;
  tracking?: TrackingEvent[];
  pickupMode?: string;
  deliveryMode?: string;
};

export type AddressEntry = {
  id: string;
  label: string;
  name: string;
  phone: string;
  country: string;
  city: string;
  street: string;
  postal: string;
  isDefault: boolean;
  createdAt: string;
};
