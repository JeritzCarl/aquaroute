import { Injectable } from '@angular/core';
import {
  Firestore,
  collection,
  addDoc,
  doc,
  collectionData,
  docData,
  query,
  where,
  setDoc,
  serverTimestamp,
  getDoc,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Station } from '../models/station.model';
import { Product } from '../models/product.model';
import { Auth } from '@angular/fire/auth';

@Injectable({
  providedIn: 'root',
})
export class StationService {
  constructor(private firestore: Firestore, private auth: Auth) {}

  // ✅ Get all stations
  getStations(): Observable<Station[]> {
    const stationsRef = collection(this.firestore, 'stations');
    return collectionData(stationsRef, { idField: 'id' }).pipe(
      map((stations: any[]) => stations.map((s) => this.normalizeStation(s)))
    );
  }

  // ✅ Add a new station
  addStation(station: Station) {
    const stationsRef = collection(this.firestore, 'stations');
    return addDoc(stationsRef, station);
  }

  // ✅ Get a single station by ID
  getStationById(stationId: string): Observable<Station> {
    const stationDocRef = doc(this.firestore, `stations/${stationId}`);
    return docData(stationDocRef, { idField: 'id' }).pipe(
      map((s: any) => this.normalizeStation(s))
    );
  }

  // ------------------------------------------------
  // 🔹 Courier Management
  // ------------------------------------------------

  // ✅ Create / Register a courier with full profile
  async createCourier(stationId: string, courierId: string, data: any) {
    const user = this.auth.currentUser;

    // 🔹 Default avatar if none available
    const defaultAvatar =
      'https://firebasestorage.googleapis.com/v0/b/YOUR_BUCKET/o/default-avatar.png?alt=media';

    // 🔹 Fetch station name if not explicitly passed
    let stationName = data.stationName || null;
    if (!stationName && stationId) {
      const stationSnap = await getDoc(doc(this.firestore, `stations/${stationId}`));
      if (stationSnap.exists()) {
        const sData: any = stationSnap.data();
        stationName = sData.stationName || sData.name || 'Station';
      }
    }

    await setDoc(
      doc(this.firestore, `stations/${stationId}/couriers/${courierId}`),
      {
        uid: user?.uid || data.uid,
        name: user?.displayName || data.name || 'Courier',
        email: user?.email || data.email || null,
        phone: data.phone || null,
        stationName,
        createdAt: serverTimestamp(),

        // ✅ Always ensure a photoUrl exists
        photoUrl: user?.photoURL || data.photoUrl || defaultAvatar,
      },
      { merge: true }
    );
  }

  // ✅ Get couriers for a station
  getCouriers(stationId: string): Observable<any[]> {
    const couriersRef = collection(this.firestore, `stations/${stationId}/couriers`);
    return collectionData(couriersRef, { idField: 'id' }) as Observable<any[]>;
  }

  // ✅ Get a single courier by ID
  getCourierById(stationId: string, courierId: string): Observable<any> {
    const courierDocRef = doc(this.firestore, `stations/${stationId}/couriers/${courierId}`);
    return docData(courierDocRef, { idField: 'id' });
  }

  // ------------------------------------------------
  // 🔹 Normalize Product
  // ------------------------------------------------
  private normalizeProduct(p: any): Product {
    return {
      ...p,
      id: p.id,
      basePrice: p.basePrice ?? p.price ?? 0,
      inStock: p.inStock ?? (p.stock ?? 0) > 0,
      stock: p.stock ?? 0,
      addons: p.addons ?? [],
      optionGroups: p.optionGroups ?? [],

      // 🔹 New survey-driven fields
      waterType: p.waterType ?? undefined,
      containerSize: p.containerSize ?? undefined,
    };
  }

  // ✅ Get all products for a station (subcollection)
  getProducts(stationId: string): Observable<Product[]> {
    const productsRef = collection(this.firestore, `stations/${stationId}/products`);
    return collectionData(productsRef, { idField: 'id' }).pipe(
      map((products: any[]) => products.map((p) => this.normalizeProduct(p)))
    );
  }

  // ✅ Get products if stored in root "products" collection
  getProductsByStation(stationId: string): Observable<Product[]> {
    const productsRef = collection(this.firestore, 'products');
    const q = query(productsRef, where('stationId', '==', stationId));
    return collectionData(q, { idField: 'id' }).pipe(
      map((products: any[]) => products.map((p) => this.normalizeProduct(p)))
    );
  }

  // ✅ Get a single product by ID (subcollection)
  getProductById(stationId: string, productId: string): Observable<Product> {
    const productDocRef = doc(this.firestore, `stations/${stationId}/products/${productId}`);
    return docData(productDocRef, { idField: 'id' }).pipe(
      map((p: any) => this.normalizeProduct(p))
    );
  }

  // ------------------------------------------------
  // 🔹 Normalize Station (with defaults + lat/lng)
  // ------------------------------------------------
private normalizeStation(s: any): Station {
  // ✅ Validate coords strictly inside Tuguegarao
  const inTuguegarao = (lat: number, lng: number) =>
    lat >= 17.58 && lat <= 17.68 && lng >= 121.69 && lng <= 121.75;

  let lat: number | undefined;
  let lng: number | undefined;

  if (typeof s.lat === 'number' && typeof s.lng === 'number' && inTuguegarao(s.lat, s.lng)) {
    lat = s.lat;
    lng = s.lng;
  } else if (Array.isArray(s.deliveryArea) && s.deliveryArea.length) {
    const sum = s.deliveryArea.reduce((a: any, p: any) => ({
      lat: a.lat + p.lat, lng: a.lng + p.lng
    }), { lat: 0, lng: 0 });
    const c = { lat: sum.lat / s.deliveryArea.length, lng: sum.lng / s.deliveryArea.length };
    if (inTuguegarao(c.lat, c.lng)) {
      lat = c.lat; lng = c.lng;
    }
  }

  // ✅ Final fallback → Tuguegarao center
  if (!lat || !lng) {
    console.warn(`⚠️ Station ${s.stationName || s.id} missing valid coords, forcing Tuguegarao center`);
    lat = 17.6131; lng = 121.7270;
  }

  return {
    ...s,
    id: s.id,
    lat, lng,
    distanceKm: s.distanceKm ?? this.mockDistance(),
    minPrice: s.minPrice ?? this.mockMinPrice(),
    promo: s.promo ?? this.mockPromo(),
    deliveryEstimate: s.deliveryEstimate ?? '30–45 mins',
    rating: s.rating ?? 4.5,
    reviewCount: s.reviewCount ?? Math.floor(Math.random() * 50) + 1,
    services: s.services ?? ['delivery', 'pickup', 'scheduled'],
    payments: s.payments ?? ['cod', 'gcash'],
    containers: s.containers ?? ['5L', '10L', '20L'],
    waterTypes: s.waterTypes ?? ['Purified', 'Alkaline'],
  };
}
  // ------------------------------------------------
  // 🔹 Mock helpers (for when Firestore has no coords/data)
  // ------------------------------------------------
  private mockLat(): number {
    return 17.613 + Math.random() * 0.01; // Tuguegarao-ish lat
  }

  private mockLng(): number {
    return 121.727 + Math.random() * 0.01; // Tuguegarao-ish lng
  }

  private mockDistance(): number {
    return parseFloat((Math.random() * 4.5 + 0.5).toFixed(1)); // 0.5 – 5 km
  }

  private mockMinPrice(): number {
    return Math.floor(Math.random() * 30) + 20; // PHP 20 – 50
  }

  private mockPromo(): string | null {
    const promos = [
      null,
      '₱10 off per 20L gallon',
      'Free delivery for 3+ containers',
      'Buy 5 get 1 free',
    ];
    return promos[Math.floor(Math.random() * promos.length)];
  }
}
