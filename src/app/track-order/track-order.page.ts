// src/app/track-order/track-order.page.ts

import { Component, OnInit, OnDestroy, AfterViewInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import {
  Firestore,
  doc,
  onSnapshot,
  updateDoc,
  arrayUnion,
  serverTimestamp,
  collection,
  addDoc,
  getDoc,
} from '@angular/fire/firestore';

import { CommonModule, DatePipe } from '@angular/common';
import { IonicModule, ToastController, AlertController } from '@ionic/angular';

import * as L from 'leaflet';
import { HttpClient, HttpClientModule } from '@angular/common/http';

import { Auth, onAuthStateChanged } from '@angular/fire/auth';

import { Order } from '../models/order.model';

@Component({
  selector: 'app-track-order',
  templateUrl: './track-order.page.html',
  styleUrls: ['./track-order.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, HttpClientModule, DatePipe],
})
export class TrackOrderPage implements OnInit, OnDestroy, AfterViewInit {
  // IDs
  orderId: string | null = null;
  stationId: string | null = null;

  // Data
  order: Order | null = null;

  // Map
  private map!: L.Map;
  private stationMarker?: L.Marker;
  private customerMarker?: L.Marker;
  private courierMarker?: L.Marker;
  private routeLine?: L.Polyline;
  private stationRouteLine?: L.Polyline;
  private mapReady = false;

  stationLatLng?: L.LatLngExpression;
  customerLatLng?: L.LatLngExpression;
  courierLatLng?: L.LatLngExpression;

  stationIcon = L.icon({
    iconUrl: 'assets/pins/station-icon.png',
    iconSize: [40, 40],
    iconAnchor: [20, 40],
    popupAnchor: [0, -40],
  });

  customerIcon = L.icon({
    iconUrl: 'assets/pins/customer-icon.png',
    iconSize: [40, 40],
    iconAnchor: [20, 40],
    popupAnchor: [0, -40],
  });

  courierIcon = L.icon({
    iconUrl: 'assets/pins/courier-icon.png',
    iconSize: [40, 40],
    iconAnchor: [20, 40],
    popupAnchor: [0, -40],
  });

  // UI
  eta: { distance: string; duration: string } | null = null;
  loading = true;
  error: string | null = null;

private unsubOrder?: () => void;
private unsubCourier?: () => void;  // ✅ added line
private started = false;


  // Display-only delivery fields
  deliveryLabel = '';
  deliveryDetails = '';

  // Timeline
  statusHistory: Array<{ status: string; changedAt: any; by?: string }> = [];

  // Helpers
  private lastCourierUpdateTime = 0;
  private lastNotifiedStatus: string | null = null;

  // (Kept) simple bounds helper for fitting only
  private inTuguegarao(lat: number, lng: number): boolean {
    return lat >= 17.58 && lat <= 17.68 && lng >= 121.69 && lng <= 121.75;
  }

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private firestore: Firestore,
    private http: HttpClient,
    private toastCtrl: ToastController,
    private alertCtrl: AlertController,
    private auth: Auth
  ) {}

  // ───────────────────────────────────────────────────────────────
  // Lifecycle
  // ───────────────────────────────────────────────────────────────
ngOnInit() {
  onAuthStateChanged(this.auth, (user) => {
    if (!user) {
      this.loading = false;
      this.error = 'User not logged in.';
      return;
    }

    // read BOTH path and query params; path wins
    const p = this.route.snapshot.paramMap;
    let orderId = p.get('orderId') || p.get('id') || this.route.snapshot.queryParamMap.get('id');
    let stationId = p.get('stationId') || this.route.snapshot.queryParamMap.get('stationId');

    // fallbacks to localStorage
    if (!orderId) orderId = localStorage.getItem('lastOrderId') || null;
    if (!stationId) stationId = localStorage.getItem('lastStationId') || null;

    // persist for next reloads
    if (orderId) localStorage.setItem('lastOrderId', orderId);
    if (stationId) localStorage.setItem('lastStationId', stationId);

    if (!orderId) {
      this.loading = false;
      this.error = 'Invalid order ID.';
      return;
    }

    // proceed (stationId is optional)
    this.orderId = orderId;
    this.stationId = stationId;
    this.initWithOrderId(orderId);
  });
}

ionViewDidEnter() {
  let attempts = 0;

  const ensureMapVisible = () => {
    const mapDiv = document.getElementById('track-map');

    if (mapDiv) {
      // Only init if not yet created
      if (!this.map) {
        const center: L.LatLngExpression =
          this.customerLatLng || this.stationLatLng || [17.6131, 121.727];
        this.initMap(center);
        console.log('✅ Map initialized on ionViewDidEnter');
      } else {
        this.map.invalidateSize();
        this.redrawAll();
        console.log('✅ Map refreshed and resized');
      }
      return;
    }

    // Retry until Ionic fully renders the DOM (max 15 tries)
    if (attempts < 15) {
      attempts++;
      setTimeout(ensureMapVisible, 150);
    } else {
      console.warn('⚠️ Map container still not found after retries.');
    }
  };

  ensureMapVisible();
}

// ───────────────────────────────────────────────────────────────
// Ensure map always loads after refresh or direct page reload
// ───────────────────────────────────────────────────────────────
ngAfterViewInit(): void {
  // Retry mechanism to wait for Ionic DOM rendering
  let tries = 0;
  const initWhenReady = () => {
    const mapEl = document.getElementById('track-map');
    // If map container exists and not yet initialized
    if (mapEl && !this.map) {
      const center: L.LatLngExpression =
        this.customerLatLng || this.stationLatLng || [17.6131, 121.727];
      try {
        this.initMap(center);
        console.log('🗺️ Map initialized after view init');
      } catch (err) {
        console.warn('Map init failed on attempt', tries, err);
      }
      return;
    }

    // If map already exists, ensure proper rendering
    if (this.map) {
      this.map.invalidateSize();
      this.redrawAll();
      return;
    }

    // Retry up to 10 times (about 1.5s max)
    if (tries < 10) {
      tries++;
      setTimeout(initWhenReady, 150);
    } else {
      console.warn('⚠️ Map container not found after retries');
    }
  };

  // Start retry loop
  initWhenReady();
}

ngOnDestroy(): void {
  if (this.unsubOrder) this.unsubOrder();
  if (this.unsubCourier) this.unsubCourier();
  console.log('🧹 TrackOrder unsubscribed');
}

 // ───────────────────────────────────────────────────────────────
// Init + Firestore (Simplified + Restored to Working)
// ───────────────────────────────────────────────────────────────
private async initWithOrderId(orderId: string) {
  this.started = true;
  this.orderId = orderId;

  if (this.unsubOrder) this.unsubOrder();
  if (this.unsubCourier) this.unsubCourier();

  const user = this.auth.currentUser;
  if (!user) {
    this.error = 'User not logged in.';
    this.loading = false;
    return;
  }

  // 🔹 Prefer station-scoped order; fallback to global
  const stationRef = this.stationId
    ? doc(this.firestore, `stations/${this.stationId}/orders/${orderId}`)
    : null;
  const globalRef = doc(this.firestore, `orders/${orderId}`);

  let listenRef = globalRef;
  if (stationRef) {
    const stationSnap = await getDoc(stationRef);
    if (stationSnap.exists()) listenRef = stationRef;
  }

  // 🔹 Begin listening
  this.unsubOrder = onSnapshot(listenRef, (snap) => {
    this.loading = false;

    if (!snap.exists()) {
      this.error = 'Order not found.';
      return;
    }

    // 🔹 Update order data
    this.order = { id: snap.id, ...(snap.data() as Order) };

    // ✅ Backfill stationId if missing
    if (!this.stationId) {
      const sid = (this.order as any)?.stations?.[0]?.stationId;
      if (sid) {
        this.stationId = sid;
        localStorage.setItem('lastStationId', sid);
        console.log('📦 stationId backfilled →', sid);
      }
    }

    const del: any = this.order.delivery || {};
    this.deliveryLabel = del.label || '';
    this.deliveryDetails = del.details || del.address || '';

    // 🔹 Timeline
    const created =
      (this.order.createdAt as any)?.toDate?.() ??
      new Date(this.order.createdAt ?? Date.now());

    this.statusHistory = [
      {
        status: `📍 Delivery address set ${this.deliveryLabel}`,
        changedAt: created,
        by: 'Customer',
      },
      ...(Array.isArray(this.order.statusHistory)
        ? this.order.statusHistory
        : []),
    ];

    // 🔹 Toast on live status updates
    if (this.order.status && this.order.status !== this.lastNotifiedStatus) {
      this.showToast(`📢 Order update: ${this.order.status}`, 'medium');
      this.lastNotifiedStatus = this.order.status;
    }

    // 🔹 Coordinates
    const firstStation = this.order?.stations?.[0] as any;
    const deliv = this.order?.delivery;

    if (deliv?.latLng?.lat && deliv?.latLng?.lng)
      this.customerLatLng = deliv.latLng;
    else if (typeof deliv?.lat === 'number' && typeof deliv?.lng === 'number')
      this.customerLatLng = { lat: deliv.lat, lng: deliv.lng };

    if (firstStation?.stationLatLng?.lat && firstStation?.stationLatLng?.lng)
      this.stationLatLng = firstStation.stationLatLng;

    // ✅ Fallback if global order has no coords — fetch from station order doc
    if (!this.customerLatLng && this.stationId) {
      const stationOrderRef = doc(
        this.firestore,
        `stations/${this.stationId}/orders/${orderId}`
      );
      getDoc(stationOrderRef).then((sSnap) => {
        if (sSnap.exists()) {
          const sData: any = sSnap.data();
          if (sData.delivery?.lat && sData.delivery?.lng) {
            this.customerLatLng = {
              lat: sData.delivery.lat,
              lng: sData.delivery.lng,
            };
            if (
              sData?.stations?.[0]?.stationLatLng?.lat &&
              sData?.stations?.[0]?.stationLatLng?.lng
            ) {
              this.stationLatLng = sData.stations[0].stationLatLng;
            }
            this.redrawAll();
          }
        }
      });
    }

    // ✅ Init map safely
    const center: L.LatLngExpression =
      this.customerLatLng || this.stationLatLng || [17.6131, 121.727];
    if (!this.map) this.initMap(center);
    this.redrawAll();

    // ✅ If courier assigned, track them
    if (this.order?.courier?.id) {
      const courierRef = doc(
        this.firestore,
        `couriers/${this.order.courier.id}`
      );
      if (this.unsubCourier) this.unsubCourier();
      this.unsubCourier = onSnapshot(courierRef, (courierSnap) => {
        if (!courierSnap.exists()) return;
        const d: any = courierSnap.data();
        if (typeof d.lat === 'number' && typeof d.lng === 'number') {
          this.courierLatLng = { lat: d.lat, lng: d.lng };
          this.updateCourierMarker();
          this.updateETA();
        }
      });
    }
  });
}


  // ───────────────────────────────────────────────────────────────
  // Map helpers
  // ───────────────────────────────────────────────────────────────
private initMap(center: L.LatLngExpression) {
  if (this.map) return;

  if (!document.getElementById('track-map')) {
  console.warn('Map container missing at init time — delaying init.');
  setTimeout(() => this.initMap(center), 200);
  return;
}

  // Create and attach map
  this.map = L.map('track-map', {
    center,
    zoom: 14,
    zoomControl: true,
    attributionControl: false,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
  }).addTo(this.map);

  this.mapReady = true;

  // Ensure correct layout after Ionic animation
  setTimeout(() => {
    this.map.invalidateSize();
    this.redrawAll();
  }, 500);
}


  private centroid(points: Array<{ lat: number; lng: number }>): { lat: number; lng: number } {
    const n = points.length || 1;
    const sum = points.reduce(
      (a, p) => ({ lat: a.lat + p.lat, lng: a.lng + p.lng }),
      { lat: 0, lng: 0 }
    );
    return { lat: sum.lat / n, lng: sum.lng / n };
  }

  private async resolveStationLatLng(firstStation: any): Promise<L.LatLngExpression | undefined> {
    if (!firstStation) return undefined;

    if (firstStation?.stationLatLng?.lat && firstStation?.stationLatLng?.lng) {
      return { lat: firstStation.stationLatLng.lat, lng: firstStation.stationLatLng.lng };
    }

    if (Array.isArray(firstStation?.deliveryArea) && firstStation.deliveryArea.length) {
      const c = this.centroid(firstStation.deliveryArea);
      return c;
    }

    return undefined;
  }


private redrawAll() {
  if (!this.map || !this.mapReady) return;

  // Clear existing layers before redraw
  if (this.routeLine) this.map.removeLayer(this.routeLine);
  if (this.stationRouteLine) this.map.removeLayer(this.stationRouteLine);

  // ── Station ─────────────────────────────
  if (this.stationLatLng) {
    if (!this.stationMarker) {
      this.stationMarker = L.marker(this.stationLatLng, { icon: this.stationIcon })
        .addTo(this.map)
        .bindPopup('Station');
    } else {
      this.stationMarker.setLatLng(this.stationLatLng);
    }
  }

  // ── Customer ─────────────────────────────
  if (this.customerLatLng) {
    if (!this.customerMarker) {
      this.customerMarker = L.marker(this.customerLatLng, { icon: this.customerIcon })
        .addTo(this.map)
        .bindPopup('Delivery Location');
    } else {
      this.customerMarker.setLatLng(this.customerLatLng);
    }
  }

  // ── Courier ─────────────────────────────
  if (this.courierLatLng) {
    this.updateCourierMarker();
    this.updateETA();
  }

  // ── Routes ──────────────────────────────
  if (this.stationLatLng && this.customerLatLng) {
    this.updateStationRoute();
  }

  // ── Fit bounds to visible points ─────────
  const pts = [this.stationLatLng, this.customerLatLng, this.courierLatLng].filter(Boolean);
  if (pts.length >= 2) {
    const bounds = L.latLngBounds(pts as any);
    if (bounds.isValid()) this.map.fitBounds(bounds, { padding: [40, 40] });
  }
}



  private updateCourierMarker() {
    if (!this.courierLatLng || !this.map || !this.mapReady) return;

    if (!this.courierMarker) {
      this.courierMarker = L.marker(this.courierLatLng, { icon: this.courierIcon }).addTo(this.map);
    } else {
      this.courierMarker.setLatLng(this.courierLatLng);
    }
  }

// ───────────────────────────────────────────────────────────────
// Routing / ETA (Stable + Different Colors per Route)
// ───────────────────────────────────────────────────────────────
private updateETA() {
  if (!this.map || !this.mapReady) return;
  if (!this.courierLatLng || !this.customerLatLng) return;

  const courier = this.courierLatLng as any;
  const customer = this.customerLatLng as any;

  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${courier.lng},${courier.lat};${customer.lng},${customer.lat}` +
    `?overview=full&geometries=geojson&alternatives=false`;

  this.http.get<any>(url).subscribe({
    next: (res) => {
      const route = res?.routes?.[0];
      if (!route) return;

      // ✅ Update ETA
      const distanceKm = (route.distance / 1000).toFixed(2);
      const durationMin = Math.round(route.duration / 60);
      this.eta = { distance: `${distanceKm} km`, duration: `${durationMin} min` };

      // ✅ Draw courier → customer route (orange)
      if (this.routeLine) this.map.removeLayer(this.routeLine);
      this.routeLine = L.polyline(
        route.geometry.coordinates.map((c: any) => [c[1], c[0]]),
        { color: 'orange', weight: 5, opacity: 0.9 }
      ).addTo(this.map);

      this.fitAllRoutes();
    },
    error: () => console.warn('⚠️ ETA route request failed'),
  });
}

private updateStationRoute() {
  if (!this.map || !this.mapReady) return;
  if (!this.stationLatLng || !this.customerLatLng) return;

  const station = this.stationLatLng as any;
  const customer = this.customerLatLng as any;

  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${station.lng},${station.lat};${customer.lng},${customer.lat}` +
    `?overview=full&geometries=geojson&alternatives=false`;

  this.http.get<any>(url).subscribe({
    next: (res) => {
      const route = res?.routes?.[0];
      if (!route) return;

      // ✅ Draw station → customer route (blue)
      if (this.stationRouteLine) this.map.removeLayer(this.stationRouteLine);
      this.stationRouteLine = L.polyline(
        route.geometry.coordinates.map((c: any) => [c[1], c[0]]),
        { color: '#2F80ED', weight: 5, opacity: 0.9 }
      ).addTo(this.map);

      this.fitAllRoutes();
    },
    error: () => console.warn('⚠️ Station route request failed'),
  });
}

// ───────────────────────────────────────────────────────────────
// Fit Bounds (Public - to be called from HTML)
// ───────────────────────────────────────────────────────────────
fitAllRoutes() {
  const bounds = L.latLngBounds([]);

  if (this.stationRouteLine) bounds.extend(this.stationRouteLine.getBounds());
  if (this.routeLine) bounds.extend(this.routeLine.getBounds());

  if (bounds.isValid()) {
    this.map.fitBounds(bounds, { padding: [30, 30] });
  }
}


  // ───────────────────────────────────────────────────────────────
  // Optional “courier events” writer (uses station path if we have it)
  // ───────────────────────────────────────────────────────────────
  private async maybeAddCourierEvent() {
    if (!this.orderId || !this.courierLatLng || !this.customerLatLng) return;

    const now = Date.now();
    if (now - this.lastCourierUpdateTime < 60000) return;
    this.lastCourierUpdateTime = now;

    const distance = this.getDistanceKm(
      (this.courierLatLng as any).lat,
      (this.courierLatLng as any).lng,
      (this.customerLatLng as any).lat,
      (this.customerLatLng as any).lng
    );

    let event: string | null = null;
    if (!this.statusHistory.some((e) => e.status === 'Courier started trip')) {
      event = 'Courier started trip';
    } else if (distance < 0.3) {
      event = 'Courier near destination';
    } else {
      event = 'Courier is on the move';
    }

    if (event) {
      const path = this.stationId
        ? `stations/${this.stationId}/orders/${this.orderId}`
        : `orders/${this.orderId}`;

      await updateDoc(doc(this.firestore, path), {
        statusHistory: arrayUnion({
          status: event,
          changedAt: serverTimestamp(),
          by: 'Courier GPS',
        }),
      });

      this.showToast(`📍 ${event}`, 'tertiary');

      const userId = this.auth.currentUser?.uid;
      if (userId) {
        const notifRef = collection(this.firestore, `users/${userId}/notifications`);
        await addDoc(notifRef, {
          title: 'Courier Update',
          body: event,
          orderId: this.orderId,
          createdAt: serverTimestamp(),
          read: false,
        });
      }
    }
  }

  private getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) *
        Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * (2 * Math.atan2(Math.sqrt(1 - a), Math.sqrt(a)));
  }

  // ───────────────────────────────────────────────────────────────
  // UI Helpers
  // ───────────────────────────────────────────────────────────────
  getStatusColor(status: string) {
    switch (status) {
      case 'Pending': return 'medium';
      case 'Preparing': return 'warning';
      case 'Out for Delivery': return 'tertiary';
      case 'Delivered': return 'success';
      case 'Cancelled': return 'danger';
      case 'Courier Assigned': return 'secondary';
      case 'Courier started trip': return 'tertiary';
      case 'Courier is on the move': return 'tertiary';
      case 'Courier near destination': return 'warning';
      default: return 'medium';
    }
  }

  getTotalGallons(): number {
    if (!this.order?.items) return 0;
    return this.order.items.reduce(
      (sum: number, it) => sum + (Number(it?.quantity) || 0),
      0
    );
  }

  getExpectedTime(order: any): string {
    const w = order?.stations?.[0]?.deliveryWindow?.toLowerCase?.();
    if (w === 'morning') return '20–30 mins';
    if (w === 'afternoon') return '40–60 mins';
    return '30–45 mins';
  }

  getExpectedColor(order: any): string {
    const w = order?.stations?.[0]?.deliveryWindow?.toLowerCase?.();
    if (w === 'morning') return 'success';
    if (w === 'afternoon') return 'warning';
    return 'medium';
  }

  async showToast(
    message: string,
    color: 'success' | 'warning' | 'danger' | 'medium' | 'tertiary'
  ) {
    const toast = await this.toastCtrl.create({ message, duration: 2000, color });
    await toast.present();
  }

  contactStation() {
    const firstStation = this.order?.stations?.[0] as any;
    const phone = firstStation?.stationPhone;

    if (phone) {
      window.open(`tel:${phone}`, '_system');
    } else {
      console.warn('No station phone available');
    }
  }

  async cancelOrder() {
    if (!this.orderId || this.order?.status !== 'Pending') return;

    const alert = await this.alertCtrl.create({
      header: 'Cancel Order',
      message: 'Are you sure you want to cancel this order?',
      buttons: [
        { text: 'No', role: 'cancel' },
        {
          text: 'Yes, Cancel',
          role: 'destructive',
          handler: async () => {
            const path = this.stationId
              ? `stations/${this.stationId}/orders/${this.orderId}`
              : `orders/${this.orderId}`;

            await updateDoc(doc(this.firestore, path), {
              status: 'Cancelled',
              lastUpdatedAt: serverTimestamp(),
              statusHistory: arrayUnion({
                status: 'Cancelled',
                changedAt: serverTimestamp(),
                by: 'Customer',
              }),
            });
            await this.showToast('❌ Order cancelled', 'warning');
          },
        },
      ],
    });

    await alert.present();
  }

  // ---------- Timeline helpers ----------
isCompleted(index: number): boolean {
  const currentIndex = this.statusHistory.findIndex(
    (s) => s.status === this.order?.status
  );
  return index < currentIndex;
}

isActive(index: number): boolean {
  const currentIndex = this.statusHistory.findIndex(
    (s) => s.status === this.order?.status
  );
  return index === currentIndex;
}
}
