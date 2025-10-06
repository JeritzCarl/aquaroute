// ──────────────── Order Item ────────────────
export interface OrderItem {
  productId: string;
  name?: string;
  price?: number;
  quantity: number;
  imageUrl?: string;
  unitPriceComputed?: number;

  // ✅ Delivery-specific fields (for order-success & scheduling)
  deliveryMode?: 'scheduled' | 'instant' | 'pickup';
  deliveryWindow?: 'morning' | 'afternoon';
}

// ──────────────── Courier Reference ────────────────
export interface CourierRef {
  id: string;
  name: string;
  vehicle?: string;
  eta?: string | null;

  // ✅ Firestore Timestamp or Date (for both manager + courier consistency)
  assignedAt?: Date | any;
  lat?: number;
  lng?: number;
  lastUpdated?: any;
}

// ──────────────── Status History ────────────────
export interface StatusHistory {
  status: string;
  changedAt: any; // Firestore Timestamp or Date
  by?: string;
  note?: string | null;
}

// ──────────────── Order ────────────────
export interface Order {
  id?: string;

  // 🔹 Customer UID (for linkage and notifications)
  userId: string;

  // 🔹 Customer Info (legacy + delivery)
  customerName?: string;
  name?: string;
  address?: string;
  deliveryAddress?: string;

  // ───────── Items + Station Info ─────────
  items: OrderItem[];
  stations: {
    stationName: string;
    stationAddress: string;
    stationPhone?: string;
    stationLatLng?: { lat: number; lng: number };
    deliveryWindow?: string;
  }[];

  // ───────── Status ─────────
  status:
    | 'New'
    | 'Pending'
    | 'Preparing'
    | 'Out for Delivery'
    | 'Delivered'
    | 'Cancelled'
    | string;

  statusHistory: StatusHistory[];

  // ───────── Courier Info ─────────
  courier?: CourierRef;
  assignedCourierId?: string; // 🔑 keeps station-courier link

  // ───────── Meta ─────────
  lastUpdatedAt?: any;
  createdAt?: any;

  // ───────── Charges ─────────
  charges: {
    subtotal: number;
    deliveryFee: number;
    total: number;
    currency: string;
  };

  // ───────── Delivery ─────────
  delivery: {
    fullName: string;
    address: string;
    notes?: string;
    lat?: number;
    lng?: number;
    latLng?: { lat: number; lng: number };
    needsPin?: boolean;
  };

  // 🔹 Flag if approximate geocoding was used
  approximateLocation?: boolean;

  // ───────── Payment ─────────
  payment: {
    method: 'COD' | 'GCASH' | string;
    status: string;
  };
}
