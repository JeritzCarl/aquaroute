// ───────────────────────────────────────────────
// 🧱 ORDER MODEL (Unified Schema for all roles)
// User / Manager / Courier / Admin
// ───────────────────────────────────────────────

// ▫️ Individual product or gallon inside cart/order
export interface OrderItem {
  productId: string;
  name?: string;
  price?: number;
  quantity: number;
  imageUrl?: string;
  unitPriceComputed?: number;

  slot?: string;
  scheduledAt?: string;
  waterType?: string;
  type?: string;
  notes?: string;

  // 🔹 Delivery modes (for scheduling & optimization)
  deliveryMode?: 'scheduled' | 'instant' | 'pickup';
  deliveryWindow?: 'morning' | 'afternoon';
  mode?: 'delivery' | 'pickup';
  deliveryType?: 'Pickup' | 'Delivery'; // optional mirror for clarity
}

// ▫️ Courier info reference
export interface CourierRef {
  id: string;
  name: string;
  vehicle?: string;
  eta?: string | null;
  assignedAt?: Date | any;
  lat?: number;
  lng?: number;
  lastUpdated?: any;
}

// ▫️ Status timeline entry (used in Track Order / Manager Timeline)
export interface StatusHistory {
  status: string;
  changedAt: any;
  by?: string;
  note?: string | null;
}

// ▫️ Delivery info block (customer destination details)
export interface DeliveryInfo {
  fullName: string;
  address: string;
  phone?: string;
  notes?: string;
  lat?: number;
  lng?: number;
  latLng?: { lat: number; lng: number };
  needsPin?: boolean;

  // 🔹 Extra fields reflected in Manager, Track Order, Checkout
  schedule?: string;             // e.g. "Morning Schedule"
  window?: string;               // e.g. "8:00 AM – 11:00 AM"
  deliveryWindow?: string;       // 🔹 Alias used in Manager Orders
  mode?: 'delivery' | 'pickup';  // Mirror for nested mode compatibility
}

// ▫️ Station metadata (for embedded Firestore record)
export interface StationRef {
  stationId?: string; // added for traceability
  stationName: string;
  stationAddress: string;
  logoUrl?: string;
  stationPhone?: string;
  stationLatLng?: { lat: number; lng: number };
  deliveryWindow?: string;
  containerSwap?: boolean;
  deliveryFee?: number;
  subtotal?: number;
  total?: number;
  mode?: 'delivery' | 'pickup';
}

// ▫️ Charges / Cost breakdown
export interface Charges {
  subtotal: number;
  deliveryFee: number;
  total: number;
  currency: string;
  containerSwap?: boolean;
}

// ▫️ Payment info
export interface PaymentInfo {
  method: 'COD' | 'GCASH' | string;
  status: 'Pending' | 'Pending Verification' | 'Paid' | 'Rejected' | string;
  referenceNumber?: string;
  proofUrl?: string;
  verifiedAt?: any;
  verifiedBy?: string;
}

// ▫️ Main Order document structure (Firestore)
export interface Order {
  id?: string;
  userId: string;

  // 🔹 Customer display
  customerName?: string;
  name?: string;
  address?: string;
  deliveryAddress?: string;

  // 🔹 Items & Stations
  items: OrderItem[];
  stations: StationRef[];

  stationId?: string;
  stationName?: string;
  stationAddress?: string;
  stationPhone?: string;

  cancelReason?: string;
  declineReason?: string;

  mode?: 'pickup' | 'delivery';

  status:
    | 'New'
    | 'Pending'
    | 'Order Confirmed'
    | 'Preparing'
    | 'Out for Delivery'
    | 'Delivered'
    | 'Ready for Pickup'
    | 'Picked Up'
    | 'Cancelled'
    | 'Declined'
    | string;

  statusHistory: StatusHistory[];

  courier?: CourierRef;
  assignedCourierId?: string;
  courierAssigned?: boolean;

  createdAt?: any;
  lastUpdatedAt?: any;
  completedAt?: any;
  declinedAt?: any;

  charges: Charges;
  payment: PaymentInfo;

  delivery: DeliveryInfo;

  approximateLocation?: boolean;
  archived?: boolean;
  archivedBy?: string;
  deliveredBy?: string;
  durationMinutes?: number;
  totalAmount?: number;

  rating?: {
    stationRating?: number;
    courierRating?: number;
    review?: string;
    ratedAt?: any;
    rated?: boolean;
  };

  rated?: boolean;

  updatedBy?: string;
  managedBy?: string;
  platform?: 'mobile' | 'web' | 'android';
}