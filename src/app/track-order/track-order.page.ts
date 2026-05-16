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
  setDoc,
  addDoc,
  getDoc,
  deleteDoc
} from '@angular/fire/firestore';
import { CommonModule, DatePipe } from '@angular/common';
import { IonicModule, ToastController, AlertController } from '@ionic/angular';
import * as L from 'leaflet';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import { Order } from '../models/order.model';
import { Geolocation } from '@capacitor/geolocation';
import { LatLng, GeoService } from '../services/geo.service';
import { RouteOptimizerService, RoutePlan } from '../services/route-optimizer.service';

function safeStatusEntry(status: string, by: string) {
  return {
    status,
    changedAt: new Date(),
    by,
  };
}

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
  private stationMarker?: L.Marker | L.CircleMarker;
  private customerMarker?: L.Marker;
  private courierMarker?: L.Marker;
  private routeLine?: L.Polyline;
  private stationRouteLine?: L.Polyline;
  private mapReady = false;
  private _routeDrawnOnce = false;
  private _routeRequestedOnce = false;
  private optimizedLegs: any[] = [];

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

  eta: { distance: string; duration: string } | null = null;
  loading = true;
  error: string | null = null;

  private unsubOrder?: () => void;
  private unsubCourier?: () => void;
  private started = false;
  private samePlace = false;

  deliveryLabel = '';
  deliveryDetails = '';

  orderMode: string = 'Delivery';

  statusHistory: Array<{ status: string; changedAt: any; by?: string }> = [];

  private lastCourierUpdateTime = 0;
  private lastNotifiedStatus: string | null = null;

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
    private auth: Auth,
    private optimizer: RouteOptimizerService
  ) {}


private normalizeLatLng(src: any): L.LatLngExpression | undefined {
  if (!src) return undefined;

  const inPH = (lat: number, lng: number) => lat > 4 && lat < 22 && lng > 116 && lng < 127;
  const build = (a: number, b: number) => {
    if (Math.abs(a) <= 90 && Math.abs(b) <= 180 && inPH(a, b)) return { lat: a, lng: b };
    if (Math.abs(b) <= 90 && Math.abs(a) <= 180 && inPH(b, a)) return { lat: b, lng: a };
    return { lat: a, lng: b };
  };

  if (typeof src.lat === 'number' && typeof src.lng === 'number') return build(src.lat, src.lng);
  if (src.latLng && typeof src.latLng.lat === 'number' && typeof src.latLng.lng === 'number')
    return build(src.latLng.lat, src.latLng.lng);
  if (typeof src.latitude === 'number' && typeof src.longitude === 'number')
    return build(src.latitude, src.longitude);
  if (typeof src.lastLat === 'number' && typeof src.lastLng === 'number')
    return build(src.lastLat, src.lastLng);
  if (typeof src.lat === 'number' && typeof src.lon === 'number')
    return build(src.lat, src.lon);

  return undefined;
}


/** If station & customer are within threshold meters, snap them together. */
private snapIfClose(thresholdMeters = 60) {
  if (!this.stationLatLng || !this.customerLatLng) return;

  const s = this.stationLatLng as any;
  const c = this.customerLatLng as any;
  const dKm = this.getDistanceKm(s.lat, s.lng, c.lat, c.lng);

  if (dKm * 1000 <= thresholdMeters) {
    this.customerLatLng = this.stationLatLng;   // stack markers
    this.samePlace = true;

    // clear any routes/ETA when it's the same place
    if (this.routeLine) { this.map?.removeLayer(this.routeLine); this.routeLine = undefined; }
    if (this.stationRouteLine) { this.map?.removeLayer(this.stationRouteLine); this.stationRouteLine = undefined; }
    this.eta = { distance: '0.00 km', duration: '0 min' };
  } else {
    this.samePlace = false;
  }
}


async tryAutoLocate() {
  try {
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 10000,
    });

    const { latitude, longitude } = pos.coords;
    console.log('📡 Device GPS:', latitude, longitude);

    // Use this GPS to save as the customer's live coordinates
    if (this.orderId && this.stationId) {
      const orderPath = `stations/${this.stationId}/orders/${this.orderId}`;
      await updateDoc(doc(this.firestore, orderPath), {
        'delivery.lat': latitude,
        'delivery.lng': longitude,
      });
      console.log('✅ Saved customer live GPS to Firestore');
    }

    this.customerLatLng = { lat: latitude, lng: longitude };
    if (this.map) {
      if (this.customerMarker) this.customerMarker.setLatLng([latitude, longitude]);
      else {
        this.customerMarker = L.marker([latitude, longitude], { icon: this.customerIcon })
          .addTo(this.map)
          .bindPopup('Your Current Location');
      }
      this.map.setView([latitude, longitude], 15);
    }
  } catch (err) { 
    console.warn('⚠️ GPS auto-locate failed or permission denied:', err);
  }
}


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
          this.customerLatLng || this.stationLatLng || [17.6131, 121.7269];
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
        this.customerLatLng || this.stationLatLng || [17.6131, 121.7269];
      try {
        this.initMap(center);
        console.log('🗺️ Map initialized after view init');
      } catch (err) {
        console.warn('Map init failed on attempt', tries, err);
      }

      // ✅ Once map initializes, check if we need GPS fallback
      setTimeout(async () => {
        if (!this.customerLatLng) {
          console.log('📡 No customerLatLng found — trying auto-locate...');
          await this.tryAutoLocate();
        }
      }, 1200); // delay ensures DOM and Leaflet fully ready

      return;
    }

    // If map already exists, ensure proper rendering
    if (this.map) {
      this.map.invalidateSize();
      setTimeout(() => this.map?.invalidateSize(), 400);
      this.redrawAll();

      // ✅ Optional GPS fallback (only if still missing)
      setTimeout(async () => {
        if (!this.customerLatLng) {
          console.log('📡 Retrying GPS fallback (map already loaded)...');
          await this.tryAutoLocate();
        }
      }, 1500);

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
// Unified Firestore Listener (Fix for delayed markers & stale timeline)
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

  // Resolve correct Firestore doc path (station → archived → global)
  const globalRef = doc(this.firestore, `orders/${orderId}`);
  const stationRef = this.stationId
    ? doc(this.firestore, `stations/${this.stationId}/orders/${orderId}`)
    : null;
  const archivedRef = this.stationId
    ? doc(this.firestore, `stations/${this.stationId}/archivedOrders/${orderId}`)
    : null;

  let listenRef = globalRef;
  if (stationRef) {
    const sSnap = await getDoc(stationRef);
    if (sSnap.exists()) listenRef = stationRef;
    else {
      const aSnap = archivedRef ? await getDoc(archivedRef) : null;
      if (aSnap?.exists()) listenRef = archivedRef!;
    }
  }

  // ── Subscribe for live updates ──
  this.unsubOrder = onSnapshot(
    listenRef,
    async (snap) => {
      if (!snap.exists()) {
        this.loading = false;
        this.error = 'Order not found.';
        return;
      }

      const data = snap.data() as Order;
      data.id = snap.id;
      this.loading = false;

// ✅ Always prioritize global orders/{id} for real-time updates
const globalRef = doc(this.firestore, `orders/${orderId}`);
const stationRef = this.stationId
  ? doc(this.firestore, `stations/${this.stationId}/orders/${orderId}`)
  : null;
const archivedRef = this.stationId
  ? doc(this.firestore, `stations/${this.stationId}/archivedOrders/${orderId}`)
  : null;

// Default: always listen to global doc first (courier updates)
let listenRef = globalRef;

// If global doc is missing, fallback to station or archived
const gSnap = await getDoc(globalRef);
if (!gSnap.exists() && stationRef) {
  const sSnap = await getDoc(stationRef);
  if (sSnap.exists()) listenRef = stationRef;
  else if (archivedRef) {
    const aSnap = await getDoc(archivedRef);
    if (aSnap.exists()) listenRef = archivedRef;
  }
}

      // Slight debounce to wait for all async merges to settle
      clearTimeout((this as any)._applyTimer);
      (this as any)._applyTimer = setTimeout(() => {
        this.applyOrderSnapshot(data);
      }, 400);
    },
    (err) => {
      this.loading = false;
      this.error = err?.message || 'Failed to load order.';
    }
  );
}

private async applyOrderSnapshot(data: Order) {
  this.order = { ...(this.order || {}), ...data };

  // ✅ Normalize charges
  (this.order as any).charges = {
    subtotal:
      (data as any)?.charges?.subtotal ??
      (data as any)?.subtotal ??
      (data as any)?.items?.[0]?.charges?.subtotal ??
      0,
    deliveryFee:
      (data as any)?.charges?.deliveryFee ??
      (data as any)?.deliveryFee ??
      (data as any)?.items?.[0]?.charges?.deliveryFee ??
      0,
    total:
      (data as any)?.charges?.total ??
      (data as any)?.total ??
      (data as any)?.items?.[0]?.charges?.total ??
      0,
    containerSwap:
      (data as any)?.containerSwap === true ||
      (data as any)?.charges?.containerSwap === true ||
      (Array.isArray((data as any)?.stations) &&
        (data as any)?.stations.some((st: any) => st.containerSwap === true)) ||
      false,
  };

  // ✅ Detect true order status
  const rawStatus = (data.status || '').trim().toLowerCase();
  const hasCancel = !!(data as any)?.cancelReason;
  const hasDecline = !!(data as any)?.declineReason;
  const isArchived = (data as any)?.archived === true;
  let trueStatus = '';

  if (hasDecline) trueStatus = 'Declined by the Station';
  else if (hasCancel) trueStatus = 'Cancelled';
  else if (isArchived && !['delivered', 'completed', 'picked up'].includes(rawStatus))
    trueStatus = 'Cancelled';
  else if (['declined', 'rejected', 'declined by the station'].includes(rawStatus))
    trueStatus = 'Declined by the Station';
  else if (['cancelled', 'canceled'].includes(rawStatus))
    trueStatus = 'Cancelled';
  else trueStatus = this.capitalize(rawStatus || 'Pending');

  // ✅ Normalize mode
  const rawMode =
    ((data as any)?.mode) ||
    ((data?.items?.[0] as any)?.mode) ||
    'delivery';
  this.orderMode = rawMode.toString().toLowerCase().replace(/\s+/g, '');

  // ✅ Normalize status history safely
  const hist = Array.isArray((data as any).statusHistory)
    ? (data as any).statusHistory.map((s: any) => ({
        status: s.status,
        changedAt:
          s.changedAt?.toDate?.() ??
          (s.changedAt instanceof Date ? s.changedAt : new Date()),
        by: s.by || 'System',
      }))
    : [safeStatusEntry(this.order?.status || 'Pending', 'Init')];

  // ✅ Remove duplicates
  this.statusHistory = hist.filter(
    (v: { status: string }, i: number, a: { status: string }[]) =>
      i === 0 || v.status !== a[i - 1].status
  );

  // 🔹 Apply “Pickup” label remapping only if NOT cancelled/declined
  if (
    !['cancelled', 'declined by the station'].includes(trueStatus.toLowerCase()) &&
    (this.orderMode === 'pickup' || this.orderMode === 'pick up')
  ) {
    const pickupMap: Record<string, string> = {
      'Out for Delivery': 'Ready for Pickup',
      Delivered: 'Picked Up',
    };
    this.statusHistory = this.statusHistory.map((s) => ({
      ...s,
      status: pickupMap[s.status] || s.status,
    }));
  }

  // ✅ Build flow
  if (trueStatus === 'Cancelled' || trueStatus === 'Declined by the Station') {
    this.statusHistory = [
      { status: 'Pending', changedAt: null },
      { status: trueStatus, changedAt: new Date() },
    ];
  } else {
const flow =
  this.orderMode === 'pickup'
    ? ['Pending', 'Order Confirmed', 'Preparing', 'Ready for Pickup', 'Picked Up']
    : [
        'Pending',
        'Order Confirmed',
        'Preparing',
        'Waiting for Courier',
        'Assigned to Courier',
        'In Transit',
        'Delivered'
      ];

    this.statusHistory = flow.map((status) => ({
      status,
      changedAt:
        this.statusHistory.find((s: any) => s.status === status)?.changedAt || null,
    }));
  }

  // 🔁 Force UI refresh
  this.statusHistory = [...this.statusHistory];
  (this.order as any).status = trueStatus;

  console.log('🧭 True Status:', trueStatus);
  console.log('🧭 Timeline:', this.statusHistory.map((s) => s.status));

  // ✅ Update delivery info
  const del: any = (this.order as any)?.delivery || {};
  this.deliveryLabel = del.label || '';
  this.deliveryDetails = del.details || del.address || '';
  this.customerLatLng = this.normalizeLatLng(del) ?? this.customerLatLng;

  // ✅ Station (for map reference only)
  if (!this.stationLatLng && this.stationId) {
    getDoc(doc(this.firestore, `stations/${this.stationId}`)).then((sDoc) => {
      if (sDoc.exists()) {
        const d: any = sDoc.data();
        if (d.lat && d.lng) this.stationLatLng = { lat: d.lat, lng: d.lng };
      }
    });
  }

// ✅ Live courier tracking (global)
let courierId: string | null = null;
if ((this.order as any)?.courierId) courierId = (this.order as any).courierId;
else if ((this.order as any)?.courier?.id) courierId = (this.order as any).courier.id;

if (courierId) {
  const ref = doc(this.firestore, `couriers/${courierId}`);
  console.log('📡 Listening to global courier path:', `couriers/${courierId}`);

  if (this.unsubCourier) this.unsubCourier();
  this.unsubCourier = onSnapshot(ref, (snap) => {
    if (!snap.exists()) return;
    const data: any = snap.data();
    const lat = data?.lat ?? data?.latitude;
    const lng = data?.lng ?? data?.longitude;
    if (lat && lng) {
      this.courierLatLng = { lat, lng };
      console.log('🚚 Live courier update:', this.courierLatLng);
      this.updateCourierMarker();
    }
  });
}
// 🧭 Load courier's saved optimized route for user visualization
await this.loadCourierRoute();

  // ✅ Initialize / refresh map
  if (this.customerLatLng) {
    const center: L.LatLngExpression =
      this.customerLatLng || [17.6131, 121.7269];
    if (!this.map) this.initMap(center);
    this.redrawAll();
  }
}


// ───────────────────────────────────────────────────────────────
// Build timeline from latest statusHistory
// ───────────────────────────────────────────────────────────────
private updateTimelineFromOrder() {
const flow =
  this.orderMode?.toLowerCase?.() === 'pickup' ||
  this.orderMode?.toLowerCase?.() === 'pick up'
    ? ['Pending', 'Order Confirmed', 'Preparing', 'Ready for Pickup', 'Picked Up']
    : [
        'Pending',
        'Order Confirmed',
        'Preparing',
        'Waiting for Courier',
        'Assigned to Courier',
        'In Transit',
        'Delivered'
      ];

  const doneSet = new Set(this.statusHistory.map((s) => s.status));
  this.statusHistory = this.statusHistory.filter(Boolean);
  this.statusHistory = this.statusHistory.map((s) => ({
    ...s,
    changedAt:
      s.changedAt instanceof Date ? s.changedAt : new Date(s.changedAt ?? Date.now()),
  }));

  // refresh UI binding
  this.statusHistory = [...this.statusHistory];

  // small log to verify
  console.log('🧭 Timeline rebuilt:', this.statusHistory.map((s) => s.status));
}




private initMap(center: L.LatLngExpression) {
  if (this.map) return;

  const container = document.getElementById('track-map');
  if (!container) {
    console.warn('⚠️ Map container missing, retrying init...');
    setTimeout(() => this.initMap(center), 300);
    return;
  }

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

  // 🧭 After load, refresh layout
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


// ───────────────────────────────────────────────────────────────
// Redraw Markers and Correct Routes (Courier → Customer only)
// ───────────────────────────────────────────────────────────────
private redrawAll() {
  if (!this.map || !this.mapReady) return;

  this.snapIfClose();

  // Clear old route
  if (this.routeLine) { this.map.removeLayer(this.routeLine); this.routeLine = undefined; }
  if (this.stationRouteLine) { this.map.removeLayer(this.stationRouteLine); this.stationRouteLine = undefined; }

  // ── Station Marker (static reference only, small dot)
  if (this.stationLatLng) {
    if (!this.stationMarker) {
      this.stationMarker = L.circleMarker(this.stationLatLng as L.LatLngExpression, {
        radius: 6, color: '#2F80ED', fillColor: '#2F80ED', fillOpacity: 0.8
      }).addTo(this.map).bindPopup('Station');
    } else {
      this.stationMarker.setLatLng(this.stationLatLng as L.LatLngExpression);
    }
  }

  // ── Customer Marker
  if (this.customerLatLng) {
    if (!this.customerMarker) {
      this.customerMarker = L.marker(this.customerLatLng as L.LatLngExpression, { icon: this.customerIcon })
        .addTo(this.map)
        .bindPopup('Customer');
    } else {
      this.customerMarker.setLatLng(this.customerLatLng as L.LatLngExpression);
    }
  }

  // ── Courier Marker
  if (this.orderMode !== 'pickup' && this.courierLatLng) {
    if (!this.courierMarker) {
      this.courierMarker = L.marker(this.courierLatLng as L.LatLngExpression, { icon: this.courierIcon })
        .addTo(this.map)
        .bindPopup('Courier');
    } else {
      this.courierMarker.setLatLng(this.courierLatLng as L.LatLngExpression);
    }
    this.updateCourierRoute();   // 🔹 new accurate route
  }

  // ── Fit bounds dynamically
  const markers = [this.customerMarker, this.courierMarker].filter((m): m is L.Marker => !!m);
  if (markers.length >= 2) {
    const group = L.featureGroup(markers);
    const bounds = group.getBounds();
    if (bounds.isValid()) this.map.fitBounds(bounds, { padding: [40, 40] });
  }
}

// ───────────────────────────────────────────────────────────────
// Courier → Customer Route (orange path, replaces station route)
// ───────────────────────────────────────────────────────────────
private updateCourierRoute() {
  if (!this.map || !this.mapReady) return;
  if (!this.courierLatLng || !this.customerLatLng) return;

  const courier = this.courierLatLng as any;
  const customer = this.customerLatLng as any;

  const url = `https://router.project-osrm.org/route/v1/driving/${courier.lng},${courier.lat};${customer.lng},${customer.lat}?overview=full&geometries=geojson`;

  this.http.get<any>(url).subscribe({
    next: (res) => {
      const route = res?.routes?.[0];
      if (!route) return;

      if (this.routeLine) this.map.removeLayer(this.routeLine);
      this.routeLine = L.polyline(
        route.geometry.coordinates.map((c: any) => [c[1], c[0]]),
        { color: 'orange', weight: 5, opacity: 0.9 }
      ).addTo(this.map);

      const distanceKm = (route.distance / 1000).toFixed(2);
      const durationMin = Math.round(route.duration / 60);
      this.eta = { distance: `${distanceKm} km`, duration: `${durationMin} min` };
    },
    error: (err) => console.warn('⚠️ Courier route fetch failed', err)
  });
}


private updateCourierMarker() {
  if (!this.map || !this.mapReady) return;

  if (this.orderMode === 'pick up') return; // 🚫 skip for pickup mode

  // Default courier to station when we don’t have GPS yet
  if (!this.courierLatLng && this.stationLatLng) {
    this.courierLatLng = this.stationLatLng;
  }

  if (this.courierLatLng) {
    if (!this.courierMarker) {
      this.courierMarker = L.marker(this.courierLatLng as L.LatLngExpression, { icon: this.courierIcon })
        .addTo(this.map)
        .bindPopup('Courier');
    } else {
      this.courierMarker.setLatLng(this.courierLatLng as L.LatLngExpression);
    }
  }

  // Ensure the other two markers exist if we already have coords
  if (this.stationLatLng && !this.stationMarker) {
    this.stationMarker = L.marker(this.stationLatLng as L.LatLngExpression, { icon: this.stationIcon })
      .addTo(this.map)
      .bindPopup('Station');
  }
  if (this.customerLatLng && !this.customerMarker) {
    this.customerMarker = L.marker(this.customerLatLng as L.LatLngExpression, { icon: this.customerIcon })
      .addTo(this.map)
      .bindPopup('Customer');
  }

// Visual stacking (skip for CircleMarker)
if (this.stationMarker instanceof L.Marker) this.stationMarker.setZIndexOffset(400);
if (this.customerMarker instanceof L.Marker) this.customerMarker.setZIndexOffset(500);
if (this.courierMarker instanceof L.Marker) this.courierMarker.setZIndexOffset(1000);

  // Fit
  const markers = [this.stationMarker, this.customerMarker, this.courierMarker].filter(
    (m): m is L.Marker => !!m
  );
  if (markers.length >= 2) {
    const group = L.featureGroup(markers);
    const bounds = group.getBounds();
    if (bounds.isValid()) this.map.fitBounds(bounds, { padding: [40, 40] });
  }
  // 🧩 Fetch & render optimized station→customer route (user tracking)
if (this.stationLatLng && this.customerLatLng) {
  const coords = [
    { lng: (this.stationLatLng as any).lng, lat: (this.stationLatLng as any).lat },
    { lng: (this.customerLatLng as any).lng, lat: (this.customerLatLng as any).lat },
  ];

  const url = `https://router.project-osrm.org/route/v1/driving/${coords[0].lng},${coords[0].lat};${coords[1].lng},${coords[1].lat}?overview=full&geometries=geojson`;

  this.http.get<any>(url).subscribe({
    next: (res) => {
      const route = res?.routes?.[0];
      if (!route) return;

      // Remove previous line if exists
      if (this.stationRouteLine) this.map.removeLayer(this.stationRouteLine);

      // Draw optimized route
      this.stationRouteLine = L.polyline(
        route.geometry.coordinates.map((c: any) => [c[1], c[0]]),
        { color: '#2F80ED', weight: 5, opacity: 0.9 }
      ).addTo(this.map);

      console.log('✅ Optimized route (user view) rendered.');
    },
    error: (err) => console.warn('⚠️ OSRM optimized route fetch failed:', err),
  });
}
}

// ───────────────────────────────────────────────────────────────
// Routing / ETA (Stable + Different Colors per Route)
// ───────────────────────────────────────────────────────────────
private updateETA() {
  if (!this.map || !this.mapReady) return;
  if (this.samePlace) { // nothing to route if same spot
    if (this.routeLine) { this.map.removeLayer(this.routeLine); this.routeLine = undefined; }
    this.eta = { distance: '0.00 km', duration: '0 min' };
    return;
  }
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

      const distanceKm = (route.distance / 1000).toFixed(2);
      const durationMin = Math.round(route.duration / 60);
      this.eta = { distance: `${distanceKm} km`, duration: `${durationMin} min` };

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
if (this.stationRouteLine) return;

  if (!this.map || !this.mapReady) return;
  if (this.samePlace) {
    if (this.stationRouteLine) {
      this.map.removeLayer(this.stationRouteLine);
      this.stationRouteLine = undefined;
    }
    return;
  }
  if (!this.stationLatLng || !this.customerLatLng) return;

  const s = this.stationLatLng as any;
  const c = this.customerLatLng as any;

  // 🧩 Prevent requesting if coordinates are identical or too close
  const dist = this.getDistanceKm(s.lat, s.lng, c.lat, c.lng);
  if (dist < 0.08) { // < 80m
    console.log('⚠️ Station and customer too close, skipping OSRM request');
    if (this.stationRouteLine) this.map.removeLayer(this.stationRouteLine);
    this.stationRouteLine = L.polyline(
      [s, c],
      { color: '#2F80ED', weight: 4, opacity: 0.7, dashArray: '5,10' }
    ).addTo(this.map);
    return;
  }

  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${s.lng},${s.lat};${c.lng},${c.lat}` +
    `?overview=full&geometries=geojson&alternatives=false`;

  // 🛰️ Try routing via OSRM
  this.http.get<any>(url).subscribe({
    next: (res) => {
      const route = res?.routes?.[0];
      if (!route) {
        console.warn('⚠️ No OSRM route returned — using fallback line');
        this.drawFallbackLine();
        return;
      }

      // Clear previous route (only this one)
      if (this.stationRouteLine) this.map.removeLayer(this.stationRouteLine);

      this.stationRouteLine = L.polyline(
        route.geometry.coordinates.map((co: any) => [co[1], co[0]]),
        { color: '#2F80ED', weight: 5, opacity: 0.9 }
      ).addTo(this.map);

      // ✅ Keep the route persistent — lock it once drawn
      if (!this._routeDrawnOnce) {
        this._routeDrawnOnce = true;
        const bounds = this.stationRouteLine.getBounds();
        if (bounds.isValid()) this.map.fitBounds(bounds, { padding: [40, 40] });
      }
    },
    error: (err) => {
      console.warn('⚠️ Station route request failed:', err);
      this.drawFallbackLine();
    },
  });

  // 🔁 Failsafe retry in case OSRM times out
  setTimeout(() => {
    if (!this.stationRouteLine && this.stationLatLng && this.customerLatLng) {
      console.warn('⚠️ OSRM timed out — drawing fallback line manually');
      this.drawFallbackLine();
    }
  }, 2500);
}

// 🔧 Fallback helper — direct dashed route, persistent
private drawFallbackLine() {
  if (!this.map || !this.stationLatLng || !this.customerLatLng) return;
  if (this.stationRouteLine) this.map.removeLayer(this.stationRouteLine);

  this.stationRouteLine = L.polyline(
    [this.stationLatLng as any, this.customerLatLng as any],
    { color: '#2F80ED', weight: 4, opacity: 0.7, dashArray: '6,8' }
  ).addTo(this.map);

  if (!this._routeDrawnOnce) {
    this._routeDrawnOnce = true;
    const bounds = this.stationRouteLine.getBounds();
    if (bounds.isValid()) this.map.fitBounds(bounds, { padding: [40, 40] });
  }
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

// 🔹 Recenter Map Button (Locate)
recenterToDefault() {
  if (!this.map) return;
  const tuguegarao: L.LatLngExpression = [17.6131, 121.7269];

  // Choose best focus priority
  const target =
    this.customerLatLng ||
    this.stationLatLng ||
    this.courierLatLng ||
    tuguegarao;

  this.map.setView(target, 14);
  this.showToast('📍 Map recentered', 'tertiary');
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
        statusHistory: arrayUnion(safeStatusEntry(event, 'Courier GPS')),
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


  // ─────────────── Decline Detection ───────────────
isDeclined(): boolean {
  const s = (this.order?.status || '').toLowerCase();
  return s === 'declined';
}

getDeclineReason(): string {
return (
  (this.order as any)?.declineReason ||
  (this.order as any)?.cancelReason ||
  'Your order was declined by the station.'
);
}


  // ───────────────────────────────────────────────────────────────
  // UI Helpers
  // ───────────────────────────────────────────────────────────────
getStatusColor(status: string) {
  switch (status) {
    case 'Pending':
      return 'medium';

    case 'Order Confirmed':
    case 'Preparing':
      return 'warning';

    case 'Waiting for Courier':
      return 'secondary';

    case 'Assigned to Courier':
    case 'In Transit':
      return 'tertiary';

    case 'Delivered':
    case 'Received':
    case 'Picked Up':
      return 'success';

    case 'Cancelled':
    case 'Declined by the Station':
      return 'danger';

    default:
      return 'medium';
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

// ─────────────── Cancel Order (Full Cross-Sync + Manager Notification) ───────────────
async cancelOrder() {
  if (!this.orderId || !this.order) return;

  const alert = await this.alertCtrl.create({
    header: 'Cancel Order',
    message: 'Are you sure you want to cancel this order?',
    buttons: [
      { text: 'No', role: 'cancel' },
      {
        text: 'Yes, Cancel',
        role: 'destructive',
        handler: async () => {
          try {
            const user = this.auth.currentUser;
            if (!user) {
              await this.showToast('Not logged in.', 'warning');
              return;
            }

            const orderId = this.orderId;
            const stationId =
              this.stationId || this.order?.stations?.[0]?.stationId;

            const payload = {
              status: 'Cancelled',
              cancelledAt: serverTimestamp(),
              lastUpdatedAt: serverTimestamp(),
              statusHistory: arrayUnion(safeStatusEntry('Cancelled', 'Customer')),
            };

            // 🔹 Core Firestore paths
            const paths = [
              `orders/${orderId}`,
              `users/${user.uid}/orders/${orderId}`,
            ];
            if (stationId) {
              paths.push(`stations/${stationId}/orders/${orderId}`);
              paths.push(`stations/${stationId}/archivedOrders/${orderId}`);
            }

            // 🔹 Update or create in all paths safely
            for (const path of paths) {
              const ref = doc(this.firestore, path);
              await updateDoc(ref, payload).catch(async () => {
                if (path.includes('archivedOrders')) {
                  await setDoc(ref, { ...this.order, ...payload, archived: true });
                }
              });
            }

            // ─────────────── Manager Notification ───────────────
            if (stationId) {
              const notifRef = doc(
                collection(this.firestore, `stations/${stationId}/notifications`)
              );
              await setDoc(notifRef, {
                title: 'Order Cancelled',
                message: `User ${user.displayName || 'A customer'} cancelled order #${orderId}.`,
                type: 'order_cancelled',
                orderId,
                createdAt: serverTimestamp(),
                read: false,
              });
              console.log('📩 Manager notified of cancellation.');
            }

            // ─────────────── User Notification (Optional UX Feedback) ───────────────
            const userNotifRef = doc(
              collection(this.firestore, `users/${user.uid}/notifications`)
            );
            await setDoc(userNotifRef, {
              title: 'Order Cancelled',
              message: `You cancelled your order #${orderId}.`,
              type: 'order_cancelled',
              orderId,
              createdAt: serverTimestamp(),
              read: false,
            });

            await this.showToast('❌ Order cancelled successfully', 'warning');

            // 🔹 Redirect to Orders after short delay
            setTimeout(() => this.router.navigate(['/orders']), 700);
          } catch (err) {
            console.error('❌ Cancel failed:', err);
            this.showToast('Failed to cancel order.', 'danger');
          }
        },
      },
    ],
  });

  await alert.present();
}


getMode(item: any): string {
  const raw = (item?.mode || (this.order as any)?.mode || 'delivery').toString().toLowerCase().trim();
  return raw === 'pickup' || raw === 'pick up' ? 'Pick Up' : 'Delivery';
}

// 🔹 Delivery Slot (Morning / Afternoon)
getSlot(item: any): string {
  const slot = item?.slot || (this.order as any)?.slot;
  return slot ? slot.charAt(0).toUpperCase() + slot.slice(1) : '—';
}

// 🔹 Scheduled Time (if any)
getTime(item: any): string | null {
  return item?.scheduledAt || (this.order as any)?.scheduledAt || null;
}

private capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

// ─────────────── Safe Accessors for Delivery Info ───────────────
getWindowValue(order: any): string | null {
  if (order?.delivery?.window) return order.delivery.window;
  if (order?.items?.length && (order.items[0] as any).slot)
    return (order.items[0] as any).slot;
  return null;
}

getScheduleValue(order: any): string | null {
  if (order?.delivery?.schedule) return order.delivery.schedule;
  if (order?.items?.length && (order.items[0] as any).scheduledAt)
    return (order.items[0] as any).scheduledAt;
  return null;
}

getNotesValue(order: any): string {
  if (order?.delivery?.notes && order.delivery.notes.trim() !== '')
    return order.delivery.notes;
  if (order?.items?.length && (order.items[0] as any).notes)
    return (order.items[0] as any).notes;
  return '—';
}

getWaterType(order: any): string {
  if (!order?.items?.length) return '—';
  const types = order.items
    .map((i: any) => i.waterType || i.type)
    .filter(Boolean);
  const unique = [...new Set(types)];
  return unique.length ? unique.join(', ') : '—';
}


// ─────────────── Formatters for readability ───────────────
formatWindow(window?: string | null): string {
  if (!window) return '—';
  const w = window.toLowerCase();
  if (w.includes('morning')) return 'Morning';
  if (w.includes('afternoon')) return 'Afternoon';
  if (w.includes('evening')) return 'Evening';
  return window.charAt(0).toUpperCase() + window.slice(1);
}

formatSchedule(schedule?: string | null): string {
  if (!schedule) return '—';
  const [hStr, mStr] = schedule.split(':');
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr || '0', 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m.toString().padStart(2, '0')} ${ampm}`;
}

isCompleted(index: number): boolean {
  const currentIndex = this.statusHistory.findIndex(
    (s) => s.status.toLowerCase() === (this.order?.status || '').toLowerCase()
  );
  return index < currentIndex;
}

isActive(index: number): boolean {
  const currentIndex = this.statusHistory.findIndex(
    (s) => s.status.toLowerCase() === (this.order?.status || '').toLowerCase()
  );
  return index === currentIndex;
}

// ─────────────── Confirm Received (Delivery) ───────────────
async confirmReceived() {
  if (!this.orderId) return;
  try {
    const ref = doc(this.firestore, `orders/${this.orderId}`);
    await updateDoc(ref, {
      status: 'Received',
      statusHistory: arrayUnion({
        status: 'Received',
        changedAt: new Date(),
        by: 'Customer'
      })
    });
    this.order!.status = 'Received';
    this.showToast('✅ Order marked as received.', 'success');
  } catch (err) {
    console.error('❌ confirmReceived error:', err);
    this.showToast('Failed to update order status.', 'danger');
  }
}

// ────────────────────────────────
// ✅ Confirm Picked-Up (Full Sync + Safe Archive + Fix 2 Compatibility)
// ────────────────────────────────
async confirmPickedUp() {
  try {
    const user = this.auth.currentUser;
    if (!this.orderId || !this.order) {
      this.showToast('⚠️ Missing order data', 'warning');
      return;
    }

    const stationId =
      this.order.stationId || this.order.stations?.[0]?.stationId;
    if (!stationId) {
      this.showToast('⚠️ Missing station reference', 'warning');
      return;
    }

    const orderId = this.orderId;
    const stationOrderRef = doc(this.firestore, `stations/${stationId}/orders/${orderId}`);
    const userOrderRef = user ? doc(this.firestore, `users/${user.uid}/orders/${orderId}`) : null;
    const globalOrderRef = doc(this.firestore, `orders/${orderId}`);

    // ✅ Use consistent "Picked Up" status (not Received)
    const payload = {
      status: 'Picked Up',
      rated: false,
      archived: true,
      lastUpdatedAt: serverTimestamp(),
      statusHistory: arrayUnion({
        status: 'Picked Up',
        changedAt: new Date(), // local timestamp (serverTimestamp not allowed inside arrayUnion)
        by: 'Customer',
      }),
    };

    // 🔹 Update all active docs (global, station, user)
    const updates = [
      updateDoc(globalOrderRef, payload),
      updateDoc(stationOrderRef, payload),
    ];
    if (userOrderRef) updates.push(updateDoc(userOrderRef, payload));
    await Promise.allSettled(updates);

    // ✅ Redundant sync (ensure user doc always matches)
    if (user && userOrderRef) {
      await setDoc(userOrderRef, { ...this.order, ...payload }, { merge: true });
    }

    // 🔹 Archive properly once picked up
    const archivedRef = doc(this.firestore, `stations/${stationId}/archivedOrders/${orderId}`);
    await setDoc(
      archivedRef,
      {
        ...this.order,
        ...payload,
        completedAt: serverTimestamp(),
        archivedAt: serverTimestamp(),
      },
      { merge: true }
    );

    // 🔹 Remove from active station orders
    await deleteDoc(stationOrderRef);

    // 🔔 Notify station manager
    const notifRef = doc(collection(this.firestore, `stations/${stationId}/notifications`));
    await setDoc(notifRef, {
      type: 'order_update',
      title: 'Order Picked Up',
      message: `Customer has picked up order #${orderId}`,
      orderId,
      createdAt: serverTimestamp(),
      read: false,
    });

    // ✅ Update UI instantly
    this.order.status = 'Picked Up';
    await this.showToast('✅ Order marked as Picked Up', 'success');
  } catch (err) {
    console.error('❌ Failed to mark as Picked Up:', err);
    this.showToast('❌ Failed to mark order as Picked Up', 'danger');
  }
}


goToRatingPage() {
  if (!this.orderId) return;
  const mode = this.orderMode; // pass mode to rating page
  this.router.navigate(['/rating', this.orderId], {
    queryParams: { mode },
  });
}

/** 🔹 Load saved optimized route from Firestore (courier's plan) */
private async loadCourierRoute() {
  try {
    // Wait until courier is identified
    const courierId =
      (this.order as any)?.courierId ||
      (this.order as any)?.courier?.id;

    if (!courierId) return;

    const plan: RoutePlan | null = await this.optimizer.loadRouteFromFirestore(courierId);
    if (!plan || !plan.legs?.length) {
      console.log('⚠️ No optimized route found for courier.');
      return;
    }

    this.optimizedLegs = plan.legs;
    console.log('🗺️ Loaded courier optimized route:', plan);

    // ✅ Draw on map
    if (this.map && this.mapReady) {
      const coords = plan.legs.flatMap((leg) => [
        [leg.from.lat, leg.from.lng],
        [leg.to.lat, leg.to.lng],
      ]);
      const line = L.polyline(
  coords.map((c) => L.latLng(c[0], c[1])),
  { color: '#2F80ED', weight: 5, opacity: 0.9 }
  );
      line.addTo(this.map);
      this.stationRouteLine = line; // reuse same ref
      const bounds = line.getBounds();
      if (bounds.isValid()) this.map.fitBounds(bounds, { padding: [40, 40] });
    }
  } catch (err) {
    console.warn('⚠️ Failed to load courier route:', err);
  }
}

}
