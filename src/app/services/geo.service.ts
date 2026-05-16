import { Injectable } from '@angular/core';

// ────────────────────────────────
// 🌍 Shared Coordinate & Geo Types
// ────────────────────────────────
export interface LatLng {
  lat: number;
  lng: number;
}

export interface DeliveryPoint {
  id?: string;
  orderId?: string;
  address?: string;
  label?: string;
  coords: LatLng; // ✅ Used in route optimizer
}

export interface Station {
  id: string;
  stationName: string;
  address: string;
  rating?: number;
  reviewCount?: number;
  coords: LatLng; // ✅ Unified coordinate reference
}

// ────────────────────────────────
// 🧭 GeoService — Universal Distance + Bearing + Routing
// ────────────────────────────────
@Injectable({
  providedIn: 'root',
})
export class GeoService {
  // 🌍 Compute distance (supports both object & numeric)
  computeDistance(
    a: LatLng | number,
    b?: LatLng | number,
    c?: number,
    d?: number
  ): number {
    let lat1: number, lon1: number, lat2: number, lon2: number;

    if (typeof a === 'object' && typeof b === 'object') {
      lat1 = a.lat;
      lon1 = a.lng;
      lat2 = b.lat;
      lon2 = b.lng;
    } else if (
      typeof a === 'number' &&
      typeof b === 'number' &&
      typeof c === 'number' &&
      typeof d === 'number'
    ) {
      lat1 = a;
      lon1 = b;
      lat2 = c;
      lon2 = d;
    } else {
      console.warn('⚠️ Invalid computeDistance arguments');
      return 0;
    }

    if (!this.isValidCoord(lat1, lon1) || !this.isValidCoord(lat2, lon2)) {
      return 0;
    }

    const R = 6371; // Earth radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const aH =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) ** 2;
    const cH = 2 * Math.atan2(Math.sqrt(aH), Math.sqrt(1 - aH));
    return parseFloat((R * cH).toFixed(2));
  }

  // 🧭 Compute bearing (direction from point A → B)
  computeBearing(
    a: LatLng | number,
    b?: LatLng | number,
    c?: number,
    d?: number
  ): number {
    let lat1: number, lon1: number, lat2: number, lon2: number;

    if (typeof a === 'object' && typeof b === 'object') {
      lat1 = a.lat;
      lon1 = a.lng;
      lat2 = b.lat;
      lon2 = b.lng;
    } else if (
      typeof a === 'number' &&
      typeof b === 'number' &&
      typeof c === 'number' &&
      typeof d === 'number'
    ) {
      lat1 = a;
      lon1 = b;
      lat2 = c;
      lon2 = d;
    } else {
      console.warn('⚠️ Invalid computeBearing arguments');
      return 0;
    }

    const φ1 = this.toRad(lat1);
    const φ2 = this.toRad(lat2);
    const λ1 = this.toRad(lon1);
    const λ2 = this.toRad(lon2);

    const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
    const x =
      Math.cos(φ1) * Math.sin(φ2) -
      Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);

    const bearing = (Math.atan2(y, x) * 180) / Math.PI;
    return (bearing + 360) % 360;
  }

  // ─────────────── OSRM Driving Route (Courier → Delivery) ───────────────
  async getRoute(from: LatLng, to: LatLng): Promise<{ coordinates: [number, number][] }> {
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;

    try {
      const res = await fetch(url);
      const data = await res.json();

      if (data?.routes?.length) {
        const coords = data.routes[0].geometry.coordinates.map(
          ([lng, lat]: [number, number]) => [lat, lng]
        );
        return { coordinates: coords };
      }
      throw new Error('No route found');
    } catch (err) {
      console.warn('⚠️ OSRM routing failed:', err);
      return { coordinates: [[from.lat, from.lng], [to.lat, to.lng]] }; // fallback line
    }
  }

  // 🔹 Helpers
  private toRad(value: number): number {
    return (value * Math.PI) / 180;
  }

  private isValidCoord(lat: number, lon: number): boolean {
    return (
      typeof lat === 'number' &&
      typeof lon === 'number' &&
      lat >= -90 &&
      lat <= 90 &&
      lon >= -180 &&
      lon <= 180
    );
  }
}
