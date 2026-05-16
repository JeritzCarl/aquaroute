import { Injectable } from '@angular/core';
import {
  Firestore,
  doc,
  setDoc,
  getDoc,
  serverTimestamp
} from '@angular/fire/firestore';
import { GeoService, LatLng, DeliveryPoint, Station } from './geo.service';
import { MLWeightService } from './ml-weight.service';

export interface OptimizedLeg {
  from: LatLng;
  to: LatLng;
  orderId?: string;
  etaSec?: number;
  distanceMeters?: number;
}

export interface RoutePlan {
  sequence: string[];
  legs: OptimizedLeg[];
  totalDistanceMeters?: number;
  totalTimeSec?: number;
}

@Injectable({ providedIn: 'root' })
export class RouteOptimizerService {
  private readonly EARTH_RADIUS = 6371000; // meters

  constructor(
    private firestore: Firestore,
    private mlWeightService: MLWeightService
  ) {}

  // ✅ Haversine distance (in meters)
  private dist(a: LatLng, b: LatLng): number {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const sa =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) *
        Math.cos(toRad(b.lat)) *
        Math.sin(dLng / 2) ** 2;

    return 2 * this.EARTH_RADIUS * Math.atan2(Math.sqrt(sa), Math.sqrt(1 - sa));
  }

private async rankStopsWithML(
  station: Station,
  stops: DeliveryPoint[]
): Promise<DeliveryPoint[]> {
  const hour = new Date().getHours();
  const hourBucket: 'morning' | 'afternoon' | 'evening' =
    hour < 12 ? 'morning' :
    hour < 18 ? 'afternoon' : 'evening';

  const ranked = await Promise.all(
    stops.map(async (stop: any) => {
      const distanceKm = this.dist(station.coords!, stop.coords) / 1000;

      const itemCount = Number(stop?.itemCount) || 1;
      const barangay = stop?.barangay || 'Unknown';

      const prediction = await this.mlWeightService.predictDeliveryMinutes({
        barangay,
        distanceKm,
        itemCount,
        hourBucket
      });

      return {
        ...stop,
        predictedMinutes: prediction.predictedMinutes,
        mlConfidence: prediction.confidence,
        mlHourBucket: hourBucket,
        mlScore: prediction.predictedMinutes + distanceKm * 0.5
      };
    })
  );

  return ranked.sort((a: any, b: any) => a.mlScore - b.mlScore);
}

  // 🧭 Main entry — choose best available optimization method
  async optimize(station: Station, stops: DeliveryPoint[]): Promise<RoutePlan> {
    if (!stops?.length || !station?.coords) {
      return { sequence: [], legs: [] };
    }

    // 🔥 ML ranks the stops first
    let rankedStops: DeliveryPoint[] = stops;

    try {
      rankedStops = await this.rankStopsWithML(station, stops);
    } catch (err) {
      console.warn('⚠️ ML ranking failed, using original stops:', err);
    }

    try {
      const osrmResult = await this.tryOsrmTrip(station, rankedStops);
      if (osrmResult) return osrmResult;
    } catch (err) {
      console.warn('⚠️ OSRM optimization failed, using fallback:', err);
    }

    // 🩶 fallback to nearest-neighbor
    return this.fallbackNearestNeighbor(station, rankedStops);
  }

  // 🔹 Attempt OSRM Trip API optimization (online)
  private async tryOsrmTrip(
    station: Station,
    stops: DeliveryPoint[]
  ): Promise<RoutePlan | null> {
    const allPoints: LatLng[] = [station.coords!, ...stops.map((s: DeliveryPoint) => s.coords)];
    const coordsStr: string = allPoints.map((p: LatLng) => `${p.lng},${p.lat}`).join(';');

    const url = `https://router.project-osrm.org/trip/v1/driving/${coordsStr}?roundtrip=false&source=first&destination=last&geometries=geojson&overview=full`;

    const res: Response = await fetch(url);
    if (!res.ok) throw new Error(`OSRM request failed: ${res.status}`);

    const data: any = await res.json();
    if (!data.trips?.length) return null;

    const trip = data.trips[0];

    const waypointOrder: number[] = data.waypoints.map(
      (w: any) => w.trips_index ?? w.waypoint_index ?? 0
    );

    const orderedStops: DeliveryPoint[] = waypointOrder
      .filter((i: number) => i > 0 && i <= stops.length)
      .map((i: number) => stops[i - 1]);

    const seq: string[] = orderedStops.map((s: DeliveryPoint) => s.orderId ?? '');

    const coords: LatLng[] = trip.geometry.coordinates.map(
      ([lng, lat]: [number, number]) => ({ lat, lng })
    );

    const legs: OptimizedLeg[] = [];
    for (let i = 0; i < coords.length - 1; i++) {
      const from: LatLng = coords[i];
      const to: LatLng = coords[i + 1];

      legs.push({
        from,
        to,
        orderId: orderedStops[i]?.orderId,
        distanceMeters: this.dist(from, to)
      });
    }

    return {
      sequence: seq,
      legs,
      totalDistanceMeters: Math.round(trip.distance),
      totalTimeSec: Math.round(trip.duration)
    };
  }

  // 🔸 Fallback nearest-neighbor (offline)
  private fallbackNearestNeighbor(station: Station, stops: DeliveryPoint[]): RoutePlan {
    const start: LatLng = station.coords!;
    const remaining: DeliveryPoint[] = [...stops];
    const seq: string[] = [];
    const legs: OptimizedLeg[] = [];
    let cur: LatLng = start;

    while (remaining.length) {
      let bestIndex = 0;
      let bestDist = Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const d = this.dist(cur, remaining[i].coords);
        if (d < bestDist) {
          bestDist = d;
          bestIndex = i;
        }
      }

      const next: DeliveryPoint = remaining.splice(bestIndex, 1)[0];

      legs.push({
        from: cur,
        to: next.coords,
        orderId: next.orderId,
        distanceMeters: Math.round(bestDist)
      });

      seq.push(next.orderId ?? '');
      cur = next.coords;
    }

    // Return to station
    legs.push({
      from: cur,
      to: start,
      distanceMeters: Math.round(this.dist(cur, start))
    });

    const total: number = legs.reduce(
      (sum: number, leg: OptimizedLeg) => sum + (leg.distanceMeters || 0),
      0
    );

    return {
      sequence: seq,
      legs,
      totalDistanceMeters: total,
      totalTimeSec: Math.round(total / 8.33) // ≈30 km/h
    };
  }

  // ─────────────────────────────────────────────
  // 🔹 Firestore Integration for Courier Route
  // ─────────────────────────────────────────────

  /** Save optimized route to Firestore (per-courier active route) */
  async saveRouteToFirestore(
    courierId: string,
    stationId: string,
    plan: RoutePlan
  ): Promise<void> {
    try {
      const ref = doc(this.firestore, `couriers/${courierId}/activeRoute/plan`);

      await setDoc(
        ref,
        {
          stationId,
          sequence: plan.sequence,
          legs: plan.legs,
          totalDistanceMeters: plan.totalDistanceMeters ?? 0,
          totalTimeSec: plan.totalTimeSec ?? 0,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );

      console.log('✅ Optimized route saved to Firestore:', ref.path);
    } catch (err) {
      console.warn('⚠️ Failed to save optimized route to Firestore:', err);
    }
  }

  /** Load optimized route from Firestore */
  async loadRouteFromFirestore(courierId: string): Promise<RoutePlan | null> {
    try {
      const ref = doc(this.firestore, `couriers/${courierId}/activeRoute/plan`);
      const snap = await getDoc(ref);

      if (!snap.exists()) return null;

      const data: any = snap.data();

      return {
        sequence: data.sequence || [],
        legs: data.legs || [],
        totalDistanceMeters: data.totalDistanceMeters || 0,
        totalTimeSec: data.totalTimeSec || 0
      };
    } catch (err) {
      console.warn('⚠️ Failed to load route from Firestore:', err);
      return null;
    }
  }

  /** Convert plan legs to LatLng[] for map drawing */
  toLatLngPairs(plan: RoutePlan): [number, number][] {
    if (!plan?.legs?.length) return [];

    const pts: [number, number][] = [];
    plan.legs.forEach((leg: OptimizedLeg) => {
      pts.push([leg.from.lat, leg.from.lng]);
      pts.push([leg.to.lat, leg.to.lng]);
    });

    return pts;
  }
}