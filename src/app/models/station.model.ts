// src/app/models/station.model.ts

export interface Station {
  id: string;                 // Firestore doc ID
  stationName: string;        // Station name
  address?: string;           // Physical address
  ownerName?: string;         // Station owner
  phone?: string;             // Contact number
  logoUrl?: string;           // Logo / image

  // 🔹 Coordinates (required for delivery fee & route optimization)
  lat: number | null;         // Latitude (nullable until loaded)
  lng: number | null;         // Longitude (nullable until loaded)

  // 🔹 Ratings & reviews
  rating?: number;            // Average rating
  reviewCount?: number;       // Number of reviews

  // 🔹 Delivery & pricing
  distanceKm?: number;        // Computed via Haversine (km)
  minPrice?: number;          // Lowest product price
  promo?: string | null;      // e.g., "₱10 off per 20L gallon"
  deliveryEstimate?: string;  // e.g., "30–45 mins"

  // ⭐ Survey-driven defaults
  services?: string[];        // e.g., ['delivery', 'pickup', 'scheduled']
  payments?: string[];        // e.g., ['cod', 'gcash']
  waterTypes?: string[];      // e.g., ['Purified', 'Alkaline']
  containers?: string[];      // e.g., ['5L', '10L', '20L']

  // 🔹 New: Delivery polygon (geo-fencing support)
  deliveryArea?: { lat: number; lng: number }[];

  [key: string]: any;
}
