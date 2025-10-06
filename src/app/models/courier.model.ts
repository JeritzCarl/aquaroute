// src/app/models/courier.model.ts

/** Minimal embedded shape stored on an order document */
export interface CourierRef {
  id: string;
  name: string;
  vehicle?: string;
  eta?: string | null;
  assignedAt?: any; // Firestore Timestamp | Date
}

/** Full courier document stored under stations/{stationId}/couriers/{courierId} */
export interface Courier {
  id?: string;                 // doc id
  uid?: string | null;         // auth uid (same as doc id when mirrored)
  name: string;
  vehicle?: string;
  eta?: string | null;
  active: boolean;
  photoUrl?: string | null;
  phone?: string | null;
  createdAt?: any;             // Firestore Timestamp | Date
}
// src/app/models/courier.model.ts

/** Minimal embedded shape stored on an order document */
export interface CourierRef {
  id: string;
  name: string;
  vehicle?: string;
  eta?: string | null;
  assignedAt?: any; // Firestore Timestamp | Date
}

/** Full courier document stored under stations/{stationId}/couriers/{courierId} */
export interface Courier {
  id?: string;                 // doc id
  uid?: string | null;         // auth uid (same as doc id when mirrored)
  name: string;
  vehicle?: string;
  eta?: string | null;
  active: boolean;
  photoUrl?: string | null;
  phone?: string | null;

  // 🔹 NEW: location fields for live tracking
  lat?: number;
  lng?: number;

  createdAt?: any;             // Firestore Timestamp | Date
  updatedAt?: any;             // Firestore Timestamp | Date
}
