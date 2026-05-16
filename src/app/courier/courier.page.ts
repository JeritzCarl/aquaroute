import { Component, OnInit, OnDestroy, NgZone, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ToastController } from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import { Subscription } from 'rxjs';
import {
  Firestore,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  arrayUnion,
  collection,
  onSnapshot,
  addDoc,
} from '@angular/fire/firestore';
import { Geolocation } from '@capacitor/geolocation';
import { OrderSyncService } from '../services/order-sync.service';
import { CourierService } from '../services/courier.service';
import { RouteMapComponent } from '../route-map/route-map.component';
import { RouteOptimizerService } from '../services/route-optimizer.service';
import { LatLng, GeoService } from '../services/geo.service';
import { NotificationService } from '../services/notification.service';
import { increment } from 'firebase/firestore';
import { RoutePlan } from '../services/route-optimizer.service';
import { MLWeightService } from '../services/ml-weight.service';

type Order = any;

interface UserProfile {
  role?: string;
  locationSetupDone?: boolean;
  name?: string;
  stationName?: string;
  photoUrl?: string;
  [key: string]: any;
}

@Component({
  selector: 'app-courier',
  templateUrl: './courier.page.html',
  styleUrls: ['./courier.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule, RouteMapComponent],
})
export class CourierPage implements OnInit, OnDestroy {
  // ─────────────── Identity / State ───────────────
  uid: string | null = null;
  stationId: string | null = null;
  myCourierId: string | null = null;

  courierName = 'Courier';
  stationName = 'Station';
  stationAddress = 'Tuguegarao City';
  courierPhotoUrl = 'assets/pins/courier-icon.png';
  online = false;
  onlineStatusText = '🔴 Offline';

  assignedOrders: Order[] = [];
  stationCoords?: LatLng;
  courierCoords?: LatLng | null = null;
  deliveriesCoords: LatLng[] = [];
  optimizedLegs: Array<{ from: LatLng; to: LatLng }> = [];
  totalDistanceKm: number = 0;
  totalTimeMin: number = 0;
  map: any;
  deliveryProofFile: File | null = null;
  deliveryProofPreviewUrl: string | null = null;
  deliveryProofUploading = false;

  private readonly CLOUD_NAME = 'ddmbxblmz';
  private readonly UPLOAD_PRESET = 'aquaroute_unsigned';

  completedCount = 0;
  gallonsDelivered = 0;
  estimatedEarnings = 0;
  avgRating: number = 0;
  totalRatings: number = 0;
  recentFeedbacks: Array<{ rating: number; feedback: string; createdAt: any }> = [];

  initializing = true;
  ordersLoading = true;
  stationOpen = true;
  unreadCount = 0;


  private subs: Array<Subscription | (() => void)> = [];
  private watchId: string | null = null;

  // ─────────────── Tuguegarao guardrails ───────────────
  private readonly TUG_CENTER: LatLng = { lat: 17.6131, lng: 121.7269 };
  private readonly LAT_MIN = 17.58;
  private readonly LAT_MAX = 17.67;
  private readonly LNG_MIN = 121.68;
  private readonly LNG_MAX = 121.79;

constructor(
  private auth: Auth,
  private courierService: CourierService,
  private toastCtrl: ToastController,         
  private firestore: Firestore,                
  private router: Router,
  private optimizer: RouteOptimizerService,
  private zone: NgZone,
  private cdRef: ChangeDetectorRef,              
  private notificationService: NotificationService,
  private orderSync: OrderSyncService,
  private mlWeightService: MLWeightService
) {}


// ─────────────── Lifecycle ───────────────
async ngOnInit(): Promise<void> {
// 🟢 Ask for GPS permission correctly (Capacitor 7)
try {
  const perm = await navigator.geolocation.getCurrentPosition(
    () => console.log('📍 Location permission granted.'),
    (err) => console.warn('⚠️ Location permission denied or unavailable:', err)
  );
} catch (err) {
  console.warn('⚠️ Failed to request geolocation permission:', err);
}

if (this.router.url.includes('/courier')) {
  console.log('✅ Already on courier page, skipping re-navigation');
}

  // ✅ Wait until Firebase Auth and Firestore role both resolve
  const user = await new Promise<any>((resolve) => {
    const unsub = onAuthStateChanged(this.auth, (u) => {
      unsub();
      resolve(u);
    });
  });

  if (!user) {
    console.warn('⚠️ No authenticated user, redirecting to login');
    this.router.navigateByUrl('/login', { replaceUrl: true });
    return;
  }

  this.uid = user.uid;
  this.courierName = user.displayName || this.courierName;
  this.courierPhotoUrl = user.photoURL || this.courierPhotoUrl;

  // 🔹 Wait for Firestore to confirm courier role before continuing
  const userRef = doc(this.firestore, `users/${this.uid}`);
  const snap = await getDoc(userRef);
  const data = snap.exists() ? (snap.data() as UserProfile) : null;

if (!data) {
  console.warn('⚠️ User data not yet available — waiting for AuthService role sync');
  // ⏳ Do NOT redirect — AuthService will handle this once Firestore catches up
} else if (data.role?.toLowerCase() !== 'courier') {
  console.warn('⚠️ Role mismatch — redirecting to login (not landing)');
  this.router.navigate(['/login'], { replaceUrl: true });
  return;
}

  // ✅ Proceed safely once confirmed courier

  this.uid = user.uid;
  this.courierName = user.displayName || this.courierName;
  this.courierPhotoUrl = user.photoURL || this.courierPhotoUrl;

  // ✅ Verify role safely without redirecting
  try {
    const userRef = doc(this.firestore, `users/${this.uid}`);
    const snap = await getDoc(userRef);
    const data = snap.exists() ? (snap.data() as UserProfile) : {};

    if (!data.role || data.role.toLowerCase() !== 'courier') {
      console.log('ℹ️ Role check skipped (AuthService will handle redirection)');
    }
  } catch (e) {
    console.warn('⚠️ Role verification skipped:', e);
  }

  // ✅ Proceed with courier setup (no redirects)
  this.online = true;
  this.onlineStatusText = '🟢 Online';

  await this.initialize();
  await this.tryAutoLocate();

  try {
    const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true });
    const { latitude, longitude } = pos.coords;
    if (this.inTuguegarao({ lat: latitude, lng: longitude })) {
      this.courierCoords = { lat: latitude, lng: longitude };
      await this.courierService.flushLocationUpdate(
        this.stationId!,
        this.myCourierId!,
        this.uid!,
        latitude,
        longitude
      );
      console.log('✅ Forced GPS sync → courier marker set to actual device position');
    } else {
      console.warn('⚠️ GPS position outside Tuguegarao bounds — using station coords.');
    }
  } catch (err) {
    console.warn('⚠️ Failed to force GPS sync:', err);
  }

  await this.startCourierTracking();
  await this.updateCourierStatus(true);
  await this.backfillDailyLogs();

  // ✅ Listen for notifications
  const notifSub = this.notificationService
    .listenToCourierNotifications(this.uid!)
    .subscribe((list) => {
      this.unreadCount = list.filter((n) => !n.read).length;
      this.zone.run(() => this.cdRef.detectChanges());
    });
  this.subs.push(notifSub);
}


ngOnDestroy(): void {
  // ✅ Unsubscribe from all streams and listeners
  this.subs.forEach((s) => {
    if (s && typeof (s as any).unsubscribe === 'function') {
      (s as Subscription).unsubscribe();
    } else if (typeof s === 'function') {
      s(); // Firestore onSnapshot unsubscribe
    }
  });

  this.stopCourierTracking();
}

// ─────────────── Pull-to-refresh ───────────────
async doRefresh(evt: CustomEvent) {
  try {
    this.ordersLoading = true;

    // ✅ Stop previous subscriptions (Firestore, Observables)
    this.subs.forEach((s) => {
      if (typeof s === 'function') s();
      else if (s && typeof (s as any).unsubscribe === 'function') (s as Subscription).unsubscribe();
    });

    this.subs = [];

    // ✅ Reinitialize courier data
    await this.initialize();
  } finally {
    (evt.target as HTMLIonRefresherElement).complete();
  }
}

// ✅ FINAL FIXED initialize(): precise GPS-only courier tracking with safe render fallback
private async initialize() {
  try {
    if (!this.uid) return;
    console.log('🚚 Initializing CourierPage for uid:', this.uid);

    // 🔹 Fetch courier + station info
    const info = await this.courierService.getCourierStationAndProfile(this.uid);
    if (!info) {
      console.warn('⚠️ No courier profile found. Redirecting...');
      this.initializing = false;
      return;
    }

    this.stationId = info.stationId;
    this.myCourierId = info.courierId;
    this.stationName = info.stationName || 'Station';
    this.stationAddress = info.stationAddress || 'Tuguegarao City';
    this.courierPhotoUrl = info.photoUrl || this.courierPhotoUrl;

    // ✅ Load station coordinates early so ML logging and route planning have a real origin
await this.loadStationCoords();

console.log('📍 Station coords after load:', this.stationCoords);

    // ⭐ Ratings listener
    if (this.myCourierId) this.listenToCourierRatings();

    // 💾 Cache IDs
    if (this.stationId) localStorage.setItem('stationId', this.stationId);
    if (this.myCourierId) localStorage.setItem('courierId', this.myCourierId);

    // 🟢 Station open/close listener
    if (this.stationId) {
      const stationDoc = doc(this.firestore, `stations/${this.stationId}`);
      const unsub = onSnapshot(stationDoc, (snap) => {
        if (snap.exists()) {
          const data = snap.data() as any;
          this.stationOpen = data.isOpen !== false;
          if (!this.stationOpen) {
            this.assignedOrders = [];
            this.zone.run(() => this.cdRef.detectChanges());
          }
        }
      });
      this.subs.push(() => unsub());
    }

    // 🚫 Start clean
    this.courierCoords = null;
    console.log('📡 Waiting for GPS lock...');

    // ✅ Try first GPS fix
    try {
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 });
      this.courierCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      console.log('✅ Initial GPS fix:', this.courierCoords);
    } catch (err) {
      console.warn('⚠️ Could not get initial GPS position:', err);
    }

    // 🛰️ Wait briefly (max 10s) for valid Tuguegarao fix
    let attempts = 0;
    while ((!this.courierCoords || !this.inTuguegarao(this.courierCoords)) && attempts < 10) {
      console.log('⏳ Waiting for valid GPS fix...');
      await new Promise(r => setTimeout(r, 1000));
      attempts++;
    }

    // ✅ If still no valid GPS, use last known courier position (NOT station)
    if (!this.courierCoords) {
      console.warn('⚠️ No valid GPS fix after 10s — trying last known courier position.');
      try {
        const lastSnap = await getDoc(doc(this.firestore, `stations/${this.stationId}/couriers/${this.myCourierId}`));
        const last = lastSnap.exists() ? lastSnap.data() as any : null;
        if (last?.lat && last?.lng) {
          this.courierCoords = { lat: last.lat, lng: last.lng };
          console.log('✅ Used last known courier position from Firestore.');
        }
      } catch {
        console.warn('⚠️ No last known courier position — skipping map until GPS fix.');
      }
    }

    // ✅ Sync to Firestore if GPS available
    if (this.stationId && this.myCourierId && this.uid && this.courierCoords) {
      await this.courierService.flushLocationUpdate(
        this.stationId,
        this.myCourierId,
        this.uid,
        this.courierCoords.lat,
        this.courierCoords.lng
      );
    }

    // 🧭 Begin continuous GPS tracking
    await this.startCourierTracking();

// 📦 Listen for both active and archived courier orders
const sub = this.courierService
  .getAssignedOrders(this.stationId!, this.myCourierId!)
  .subscribe({
    next: async (orders) => {
      try {
 const allOrders = orders || [];
const activeOrders = allOrders.filter(
  (o) => !['Delivered', 'Archived', 'Cancelled'].includes(o.status)
);

// 🧩 Fetch archived orders safely via Promise wrapper
let archivedOrders: any[] = [];
try {
  archivedOrders = await new Promise<any[]>((resolve) => {
    const aSub = this.courierService
      .getArchivedOrders(this.stationId!, this.myCourierId!)
      .subscribe({
        next: (a) => {
          resolve(a || []);
          aSub.unsubscribe();
        },
        error: () => resolve([]),
      });
  });
} catch {
  archivedOrders = [];
}

// 🧾 Combine completed (Delivered + archived)
const completedOrders = [
  ...allOrders.filter((o) => o.status === 'Delivered'),
  ...archivedOrders,
];

// ✅ Compute metrics from combined completed set
this.computeMetrics(completedOrders);

// ✅ Resolve coords per order and keep only valid mapped orders
const enrichedOrders: Array<Order & { resolvedCoords: LatLng; distanceKm: number }> = [];

for (const order of activeOrders) {
  const coordsList = await this.resolveDeliveryCoords([order]);
  const coords = coordsList[0];

  if (!coords) {
    console.warn('⚠️ Skipping order from route/list because it has no valid coordinates:', order?.id);
    continue;
  }

  const distanceKm = this.courierCoords
    ? Number(this.haversineDistance(this.courierCoords, coords).toFixed(2))
    : 999999;

  enrichedOrders.push({
    ...order,
    resolvedCoords: coords,
    distanceKm,
  });
}

const smartRanked = await this.rankStopsBySmartETA(
  enrichedOrders.map((o) => ({
    orderId: o.id,
    coords: o.resolvedCoords,
  }))
);

this.assignedOrders = smartRanked
  .map((r) => {
    const original = enrichedOrders.find((o) => o.id === r.orderId);
    return original
      ? {
          ...original,
          distanceKm: r.distanceKm,
          predictedMinutes: r.predictedMinutes,
        }
      : null;
  })
  .filter(Boolean)
  .map(({ resolvedCoords, ...order }: any) => order);

this.deliveriesCoords = smartRanked.map((o) => o.coords);
this.ordersLoading = false;

// 🧭 Fallback route legs from courier → sorted deliveries
if (this.courierCoords && this.deliveriesCoords.length) {
  const waypoints = [this.courierCoords, ...this.deliveriesCoords];
  this.optimizedLegs = waypoints
    .map((pt, i, arr) =>
      i < arr.length - 1 ? { from: arr[i], to: arr[i + 1] } : null
    )
    .filter(Boolean) as Array<{ from: LatLng; to: LatLng }>;
} else {
  this.optimizedLegs = [];
  this.totalDistanceKm = 0;
  this.totalTimeMin = 0;
}

// 🧩 Build optimized route from courier current location → sorted deliveries
if (this.courierCoords && this.deliveriesCoords.length) {
  const stops = this.assignedOrders.map((o, i) => ({
    orderId: o.id,
    coords: this.deliveriesCoords[i],
  }));

  try {
    const plan: RoutePlan = await this.optimizer.optimize(
      { coords: this.courierCoords } as any,
      stops
    );

    this.optimizedLegs = plan.legs || [];
    this.totalDistanceKm = (plan.totalDistanceMeters || 0) / 1000;
    this.totalTimeMin = (plan.totalTimeSec || 0) / 60;
    console.log('✅ Optimized route plan generated:', plan);

    if (this.myCourierId && this.stationId) {
      await this.optimizer.saveRouteToFirestore(this.myCourierId, this.stationId, plan);
      console.log('💾 Saved optimized route to Firestore for courier:', this.myCourierId);
    }
  } catch (err) {
    console.warn('⚠️ Failed to build optimized route:', err);
  }
} else {
  console.log('ℹ️ No valid delivery coordinates available for map/route.');
}

await this.loadSavedRoutePlan();

if (this.map) {
  setTimeout(() => {
    try {
      this.map.invalidateSize?.();
      this.map.fitBounds?.(
        [
          [this.courierCoords?.lat, this.courierCoords?.lng],
          ...this.deliveriesCoords.map((p) => [p.lat, p.lng]),
        ].filter(
          (p): p is [number, number] =>
            Array.isArray(p) &&
            Number.isFinite(p[0]) &&
            Number.isFinite(p[1])
        ),
        { padding: [30, 30] }
      );
    } catch (e) {
      console.warn('⚠️ Map resize/focus failed:', e);
    }
  }, 250);
}

        // 🩵 Always refresh UI state
        this.zone.run(() => this.cdRef.detectChanges());
      } catch (err) {
        console.warn('⚠️ Failed to fetch archived orders for metrics:', err);
        this.ordersLoading = false;
      }
    },
    error: (err) => {
      console.error('❌ getAssignedOrders stream failed:', err);
      this.ordersLoading = false;
    },
  });

this.subs.push(sub);

    this.zone.run(() => this.cdRef.detectChanges());
  } catch (err) {
    console.warn('⚠️ initialize() failed:', err);
  } finally {
    this.initializing = false;

    // 🩵 Ensure map always re-renders once DOM is ready
setTimeout(() => {
  if (this.map) {
    try {
      this.map.invalidateSize?.();
      console.log('🗺️ Courier map stabilized');
    } catch (e) {
      console.warn('⚠️ Courier map stabilization failed:', e);
    }
  }
  this.zone.run(() => this.cdRef.detectChanges());
}, 800);
  }
}

// ─────────────── Station loader (authoritative from Firestore; re-geocode if outside Tuguegarao) ───────────────
private async loadStationCoords(): Promise<void> {
  if (!this.stationId) return;

  const stationRef = doc(this.firestore, `stations/${this.stationId}`);
  const snap = await getDoc(stationRef);

  let source = 'none';

  if (snap.exists()) {
    const s = snap.data() as any;
    if (typeof s?.stationAddress === 'string' && s.stationAddress.trim()) {
      this.stationAddress = s.stationAddress.trim();
    }

    // ✅ Check Firestore lat/lng validity
    if (s?.lat != null && s?.lng != null) {
      const pt = this.normalizeLatLng({ lat: Number(s.lat), lng: Number(s.lng) });
      if (this.inTuguegarao(pt)) {
        this.stationCoords = pt;
        source = 'firestore.valid';
      } else {
        console.warn('⚠️ Station coords outside Tuguegarao, re-geocoding...');
        const geo = await this.geocodeTuguegarao(this.stationAddress);
        if (geo) {
          this.stationCoords = geo;
          source = 'geocode.repaired';
          await updateDoc(stationRef, { lat: geo.lat, lng: geo.lng });
        } else {
          this.stationCoords = this.TUG_CENTER;
          source = 'fallback.tuguegarao';
        }
      }
    } else {
      const geo = await this.geocodeTuguegarao(this.stationAddress);
      if (geo) {
        this.stationCoords = geo;
        source = 'geocode.missing';
        await updateDoc(stationRef, { lat: geo.lat, lng: geo.lng });
      } else {
        this.stationCoords = this.TUG_CENTER;
        source = 'default-fallback';
      }
    }
  }

  console.log('📍 Station coords →', this.stationCoords, `(source=${source})`, 'address=', this.stationAddress);
}


private normalizeLatLng(p: LatLng): LatLng {
  let { lat, lng } = p;
  if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) {
    [lat, lng] = [lng, lat];
  }
  return { lat, lng };
}


  private async geocodeStationAddress(addr: string): Promise<LatLng | null> {
  const q = `${addr}, Tuguegarao City, Cagayan, Philippines`.trim();
  const url =
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ph&viewbox=121.68,17.67,121.79,17.58&bounded=1&q=${encodeURIComponent(q)}`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    const data = await res.json();
    if (Array.isArray(data) && data.length) {
      const { lat, lon } = data[0];
      return { lat: parseFloat(lat), lng: parseFloat(lon) };
    }
  } catch (e) {
    console.warn('⚠️ Geocoding failed:', e);
  }
  return null;
}


  // ─────────────── Deliveries resolver ───────────────
  private async resolveDeliveryCoords(orders: Order[]): Promise<LatLng[]> {
    const points: LatLng[] = [];

    for (const o of orders) {
      // 1) prefer saved coords
// 1️⃣ Try direct lat/lng under any of the known keys
// 1️⃣ Try direct lat/lng under known delivery keys only
const d =
  o?.delivery?.latLng ||
  o?.deliveryCoords ||
  o?.latLng; // ❌ removed o?.stationLatLng fallback

const lat = d?.lat ?? o?.lat ?? o?.latLng?.lat;
const lng = d?.lng ?? o?.lng ?? o?.latLng?.lng;

if (lat && lng) {
  const pt = { lat: Number(lat), lng: Number(lng) };
  if (this.inTuguegarao(pt)) {
    points.push(pt);
    continue;
  }
}
      // 2) fallback: geocode address if present
      const addr: string =
        o?.delivery?.address || o?.flatAddress || o?.address || '';

      if (addr && addr.trim().length > 5) {
        const geo = await this.geocodeTuguegarao(addr);
        if (geo) {
          points.push(geo);
          // (optional) you can persist back to order doc here if you want
          continue;
        }
      }

      // 3) skip if we truly have nothing valid
      console.warn('⚠️ Skipped order with no valid location:', o?.id);
    }

    return points;
  }



// ─────────────── Geocoder with Tuguegarao bias + cache + structured search ───────────────
private async geocodeTuguegarao(raw: string): Promise<LatLng | null> {
  const cleaned = (raw || '').trim();
  if (!cleaned) return null;

  // cache key
  const key = 'geo_' + (cleaned + '_tuguegarao').toLowerCase().replace(/\s+/g, '_');
  try {
    const cached = localStorage.getItem(key);
    if (cached) {
      const v = JSON.parse(cached) as LatLng;
      if (this.inTuguegarao(v)) return v;
    }
  } catch {}

  // Strategy A: structured search (street + city)
  try {
    const paramsA = new URLSearchParams({
      format: 'json',
      limit: '1',
      countrycodes: 'ph',
      addressdetails: '1',
      city: 'Tuguegarao City',
      street: cleaned, // e.g. "Campos Street, Caritan Sur"
    });
    const resA = await fetch(`https://nominatim.openstreetmap.org/search?${paramsA.toString()}`, {
      headers: { 'Accept-Language': 'en' },
    });
    const dataA = await resA.json();
    if (Array.isArray(dataA) && dataA.length) {
      const pt = { lat: parseFloat(dataA[0].lat), lng: parseFloat(dataA[0].lon) };
      if (this.inTuguegarao(pt)) {
        localStorage.setItem(key, JSON.stringify(pt));
        return pt;
      }
    }
  } catch (e) {
    console.warn('Geocode A failed:', e);
  }

  // Strategy B: free-text with strict viewbox around Tuguegarao
  try {
    const q = `${cleaned}, Tuguegarao City, Cagayan, Philippines`;
    const paramsB = new URLSearchParams({
      format: 'json',
      limit: '1',
      countrycodes: 'ph',
      addressdetails: '1',
      // viewbox=left,top,right,bottom (lon,lat)
      viewbox: '121.68,17.67,121.79,17.58',
      bounded: '1',
      q,
    });
    const resB = await fetch(`https://nominatim.openstreetmap.org/search?${paramsB.toString()}`, {
      headers: { 'Accept-Language': 'en' },
    });
    const dataB = await resB.json();
    if (Array.isArray(dataB) && dataB.length) {
      const pt = { lat: parseFloat(dataB[0].lat), lng: parseFloat(dataB[0].lon) };
      if (this.inTuguegarao(pt)) {
        localStorage.setItem(key, JSON.stringify(pt));
        return pt;
      }
    }
  } catch (e) {
    console.warn('Geocode B failed:', e);
  }

  return null;
}

private inTuguegarao(p: LatLng): boolean {
  return (
    p.lat > this.LAT_MIN &&
    p.lat < this.LAT_MAX &&
    p.lng > this.LNG_MIN &&
    p.lng < this.LNG_MAX
  );
}

// ─────────────── Navigation (always from courier's current GPS) ───────────────
openNavigation(o: Order) {
  // 🔹 Destination (order address or lat/lng)
  const lat = o?.delivery?.lat ?? o?.delivery?.latLng?.lat;
  const lng = o?.delivery?.lng ?? o?.delivery?.latLng?.lng;

  const dest =
    typeof lat === 'number' && typeof lng === 'number'
      ? `${lat},${lng}`
      : encodeURIComponent(
          (o?.delivery?.address || o?.flatAddress || o?.address || 'Tuguegarao City') +
            ', Tuguegarao City'
        );

  // 🔹 Origin = courier live coords only (no station fallback)
  let origin = '';
  if (this.courierCoords) {
    origin = `${this.courierCoords.lat},${this.courierCoords.lng}`;
  } else {
    console.warn('⚠️ No courier GPS available — using "Current Location" placeholder.');
    origin = 'Current+Location';
  }

  const url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&travelmode=driving`;
  window.open(url, '_system');
}

  // ─────────────── Order Actions ───────────────
canStartDelivery(o: Order) {
  return o?.status === 'Assigned to Courier';
}

canMarkDelivered(o: Order) {
  return o?.status === 'In Transit';
}

async startDelivery(order: Order) {
  if (!this.stationId || !order?.id) return;

  const now = serverTimestamp();
  const localNow = new Date();
  const orderRef = doc(this.firestore, `stations/${this.stationId}/orders/${order.id}`);
  const globalRef = doc(this.firestore, `orders/${order.id}`);

  try {
    await updateDoc(orderRef, {
      status: 'In Transit',
      deliveryStartAt: now,
      lastUpdatedAt: now,
      updatedAt: now,
      statusHistory: arrayUnion({
        status: 'In Transit',
        changedAt: localNow,
        by: this.courierName || 'Courier',
      }),
    });

    await setDoc(
      globalRef,
      {
        status: 'In Transit',
        deliveryStartAt: now,
        lastUpdatedAt: now,
        updatedAt: now,
        courier: {
          id: this.myCourierId,
          name: this.courierName,
        },
        stationId: this.stationId,
        stationName: this.stationName,
        statusHistory: arrayUnion({
          status: 'In Transit',
          changedAt: localNow,
          by: this.courierName || 'Courier',
        }),
      },
      { merge: true }
    );

    await this.orderSync.mirrorToUserOrders(
      order.id,
      'In Transit',
      this.courierName || 'Courier'
    );

    if (order?.userId) {
      await this.notificationService.notifyUserOrderStatus(
        order.userId,
        order.id,
        'In Transit',
        this.stationName || 'AquaRoute Station'
      );
    }

    const localOrder = this.assignedOrders.find(o => o.id === order.id);
    if (localOrder) localOrder.status = 'In Transit';

    await this.show('🚚 Delivery started.', 'success');
  } catch (err) {
    console.error('❌ Failed to start delivery:', err);
    await this.show('Failed to start delivery.', 'danger');
  }
}

  onDeliveryProofSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (!file) return;

  if (!file.type.startsWith('image/')) {
    this.show('Please upload an image file only.', 'warning');
    return;
  }

  this.deliveryProofFile = file;
  this.deliveryProofPreviewUrl = URL.createObjectURL(file);
}

async uploadDeliveryProof(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', this.UPLOAD_PRESET);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${this.CLOUD_NAME}/image/upload`,
    {
      method: 'POST',
      body: formData,
    }
  );

  const data = await response.json();

  if (!data.secure_url) {
    throw new Error('Cloudinary upload failed.');
  }

  return data.secure_url;
}

// ─────────────── Start Delivery (accurate timestamp + cross-role notifications) ───────────────
async setOutForDelivery(o: Order) {
  if (!this.stationOpen) {
    await this.show('Station is closed. Cannot start delivery.', 'warning');
    return;
  }

  if (!this.stationId || !o?.id) return;
  const now = serverTimestamp();

  // 🔹 Update Firestore status
  await this.courierService.updateOrderStatus(
    this.stationId,
    o.id,
    this.courierName,
    'Out for Delivery',
    `${this.courierName} picked up the order`
  );

  // 🔹 Mirror status to global + user documents for real-time tracking
try {
  const globalRef = doc(this.firestore, `orders/${o.id}`);
  await setDoc(
    globalRef,
    {
      status: 'Out for Delivery',
      deliveryStartAt: serverTimestamp(),
      courier: {
        id: this.myCourierId,
        name: this.courierName,
      },
      stationId: this.stationId,
      stationName: this.stationName,
      updatedAt: serverTimestamp(),
      statusHistory: arrayUnion({
        status: 'Out for Delivery',
        changedAt: new Date(),
        by: this.courierName,
      }),
    },
    { merge: true }
  );

  // ✅ Also mirror to user’s subcollection
  const userRef = doc(this.firestore, `users/${o.userId}/orders/${o.id}`);
  await setDoc(
    userRef,
    {
      status: 'Out for Delivery',
      deliveryStartAt: serverTimestamp(),
      courier: {
        id: this.myCourierId,
        name: this.courierName,
      },
      updatedAt: serverTimestamp(),
      statusHistory: arrayUnion({
        status: 'Out for Delivery',
        changedAt: new Date(),
        by: this.courierName,
      }),
    },
    { merge: true }
  );

  console.log('✅ Mirrored Out for Delivery to global + user orders');
} catch (err) {
  console.error('⚠️ Failed to mirror Out for Delivery:', err);
}

  // 🔹 Add delivery start time and status history
  const orderRef = doc(this.firestore, `stations/${this.stationId}/orders/${o.id}`);
await updateDoc(orderRef, {
  deliveryStartAt: serverTimestamp(),
statusHistory: arrayUnion({
  status: 'Out for Delivery',
  changedAt: new Date(), // ✅ safe
  by: this.courierName,
}),
});

  // 🔹 Notify user: "Your order is out for delivery"
  try {
    await this.notificationService.notifyUserOrderStatus(
      o.userId,
      o.id,
      'Out for Delivery',
      o.stationName || 'AquaRoute Station'
    );
  } catch (err) {
    console.warn('⚠️ Failed to notify user:', err);
  }

  // 🔹 Notify manager: "Courier started delivery"
  try {
    if (this.stationId) {
      const stationRef = doc(this.firestore, `stations/${this.stationId}`);
      const stationSnap = await getDoc(stationRef);
      const managerId = stationSnap.exists() ? (stationSnap.data() as any).ownerId : null;

      if (managerId) {
        await this.notificationService.addManagerNotification(managerId, {
          type: 'delivery',
          subtype: 'courierUpdate',
          message: `🚴 ${this.courierName || 'Courier'} started delivery for order #${o.id}.`,
          read: false,
          createdAt: serverTimestamp(),
        });
        console.log(`📩 Manager notified: Courier started delivery for order #${o.id}`);
      } else {
        console.warn('⚠️ No managerId found for station; skipped manager notification.');
      }
    }
  } catch (err) {
    console.error('⚠️ Failed to notify manager (Out for Delivery):', err);
  }
  // 🔹 Mirror to user orders for real-time update
await this.mirrorToUserOrders(o, 'Out for Delivery');

// 🔹 Notify user and manager
await this.show(`🚚 Order ${o.id} is Out for Delivery`, 'success');

}

// ─────────────── Delivery Confirmation (Full Sync + Notifications + Logs) ───────────────
async confirmDelivery(order: any) {
  if (!this.stationOpen) {
    await this.show('Station is closed. Cannot confirm delivery.', 'warning');
    return;
  }
  if (!order?.id) {
    await this.show('Invalid order data.', 'danger');
    return;
  }

  if (!this.deliveryProofFile) {
  await this.show('Please upload delivery proof before confirming delivery.', 'warning');
  return;
}

let proofUrl = '';
try {
  this.deliveryProofUploading = true;
  proofUrl = await this.uploadDeliveryProof(this.deliveryProofFile);
} catch (error) {
  console.error('⚠️ Failed to upload delivery proof:', error);
  await this.show('Failed to upload delivery proof. Please try again.', 'danger');
  this.deliveryProofUploading = false;
  return;
} finally {
  this.deliveryProofUploading = false;
}

  try {
    const now = serverTimestamp();
    const localNow = new Date();
    const courierName = this.courierName || 'Courier';
    const stationId = this.stationId;
    const orderId = order.id;

    // ────────────────────────────────
    // 🔹 Resolve references
    // ────────────────────────────────
    let orderRef = doc(this.firestore, `stations/${stationId}/orders/${orderId}`);
    let useStationScoped = true;
    const stationSnap = await getDoc(orderRef);
    if (!stationSnap.exists()) {
      const globalRef = doc(this.firestore, `orders/${orderId}`);
      const globalSnap = await getDoc(globalRef);
      if (globalSnap.exists()) {
        orderRef = globalRef;
        useStationScoped = false;
      } else {
        await this.show('Order not found in Firestore.', 'danger');
        return;
      }
    }

    const histRef =
      stationId && this.myCourierId
        ? doc(this.firestore, `stations/${stationId}/couriers/${this.myCourierId}/deliveryHistory/${orderId}`)
        : null;
    const archivedRef = stationId ? doc(this.firestore, `stations/${stationId}/archivedOrders/${orderId}`) : null;
    const globalRef = doc(this.firestore, `orders/${orderId}`);

    // 🔹 Compute duration from actual delivery start only
    let durationMinutes = 0;
    const orderSnap = await getDoc(orderRef);
    let orderData: any = null;

    if (orderSnap.exists()) {
      orderData = orderSnap.data();
      durationMinutes = this.getValidDurationMinutes(orderData);
    }

    if (durationMinutes <= 0) {
      console.warn('⚠️ Invalid delivery duration detected. ML logging will be skipped for this order.');
    }

    // ────────────────────────────────
    // 🔹 Update station/global order as Delivered
    // ────────────────────────────────
await updateDoc(orderRef, {
  status: 'Delivered',
  deliveredAt: now,
  completedAt: now,
  durationMinutes,
  deliveryProof: {
    imageUrl: proofUrl,
    uploadedAt: now,
    uploadedBy: courierName,
  },
  statusHistory: arrayUnion({
    status: 'Delivered',
    changedAt: localNow,
    by: courierName,
  }),
});

await setDoc(globalRef, {
  status: 'Delivered',
  deliveredAt: now,
  completedAt: now,
  durationMinutes,
  deliveryProof: {
    imageUrl: proofUrl,
    uploadedAt: now,
    uploadedBy: courierName,
  },
  statusHistory: arrayUnion({
    status: 'Delivered',
    changedAt: localNow,
    by: courierName,
  }),
  lastSyncedAt: serverTimestamp(),
  deliveredBy: courierName,
}, { merge: true });

    // ────────────────────────────────
    // 🔹 Archive + courier history
    // ────────────────────────────────
    if (histRef) {
      await setDoc(histRef, {
        ...order,
        status: 'Delivered',
        deliveredAt: now,
        archived: true,
        archivedBy: courierName,
        totalAmount: order?.charges?.total || 0,
        courierId: this.myCourierId,
        durationMinutes,
        updatedAt: now,
      }, { merge: true });
    }

    if (archivedRef) {
      await setDoc(archivedRef, {
        ...order,
        status: 'archived',
        archived: true,
        archivedAt: now,
        completedAt: order?.completedAt ?? now,
        deliveredAt: now,
        archivedBy: courierName,
        deliveredBy: courierName,
        stationId,
        totalAmount: order?.charges?.total ?? 0,
        courier: {
          id: this.myCourierId,
          name: courierName,
          ...(order?.courier || {}),
        },
        durationMinutes,
        updatedAt: now,
      }, { merge: true });
    }

    // ────────────────────────────────
    // 🔹 Mirror to user's orders
    // ────────────────────────────────
    await this.orderSync.mirrorToUserOrders(orderId, 'Delivered');

    if (order?.userId) {
  const userOrderRef = doc(this.firestore, `users/${order.userId}/orders/${orderId}`);
  await setDoc(
    userOrderRef,
    {
      status: 'Delivered',
      deliveryProof: {
        imageUrl: proofUrl,
        uploadedAt: now,
        uploadedBy: courierName,
      },
      lastUpdatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

// 🧠 ML logging — update both per-barangay and per-delivery datasets
try {
  if (durationMinutes > 0 && durationMinutes <= 180) {
    // 🏷️ Detect barangay from structured field or address
    const barangay = this.extractBarangay({
  ...orderData,
  ...order,
  delivery: {
    ...(orderData?.delivery || {}),
    ...(order?.delivery || {}),
  },
});

    // 📦 Count total items safely
    const itemCount = Array.isArray(order?.items)
      ? order.items.reduce((sum: number, item: any) => {
          return sum + (Number(item.quantity) || 0);
        }, 0)
      : 1;

    // 🚚 Delivery mode
    const deliveryMode =
      order?.delivery?.mode ||
      order?.mode ||
      'delivery';

    // 🕒 Time bucket
    const hour = new Date().getHours();
    const hourBucket =
      hour < 12 ? 'morning' :
      hour < 18 ? 'afternoon' : 'evening';

// 📍 Resolve approximate delivery distance in km
let distanceKm = 0;

try {
  const rawDeliveryLat =
    order?.delivery?.lat ??
    orderData?.delivery?.lat ??
    order?.delivery?.latLng?.lat ??
    orderData?.delivery?.latLng?.lat ??
    order?.deliveryCoords?.lat ??
    orderData?.deliveryCoords?.lat ??
    order?.latLng?.lat ??
    orderData?.latLng?.lat;

  const rawDeliveryLng =
    order?.delivery?.lng ??
    orderData?.delivery?.lng ??
    order?.delivery?.latLng?.lng ??
    orderData?.delivery?.latLng?.lng ??
    order?.deliveryCoords?.lng ??
    orderData?.deliveryCoords?.lng ??
    order?.latLng?.lng ??
    orderData?.latLng?.lng;

  const deliveryLat = Number(rawDeliveryLat);
  const deliveryLng = Number(rawDeliveryLng);

  console.log('📍 ML distance debug → stationCoords:', this.stationCoords);
  console.log('📍 ML distance debug → raw delivery lat/lng:', rawDeliveryLat, rawDeliveryLng);
  console.log('📍 ML distance debug → parsed delivery lat/lng:', deliveryLat, deliveryLng);

  if (
    this.stationCoords &&
    Number.isFinite(deliveryLat) &&
    Number.isFinite(deliveryLng)
  ) {
    distanceKm = Number(
      this.haversineDistance(this.stationCoords, {
        lat: deliveryLat,
        lng: deliveryLng,
      }).toFixed(2)
    );
  } else {
    console.warn('⚠️ Skipping distanceKm calculation because coords are invalid.', {
      stationCoords: this.stationCoords,
      rawDeliveryLat,
      rawDeliveryLng,
      deliveryLat,
      deliveryLng,
    });
  }
} catch (e) {
  console.warn('⚠️ Failed to compute distanceKm for ML log:', e);
}

    const prediction = await this.mlWeightService.predictDeliveryMinutes({
      barangay,
      distanceKm,
      itemCount,
      hourBucket,
    });

    const predictedMinutes = prediction.predictedMinutes;
    const predictionError = durationMinutes - predictedMinutes;

    console.log('🧠 Final ML log values:', {
  orderId,
  barangay,
  itemCount,
  hourBucket,
  durationMinutes,
  distanceKm,
  predictedMinutes,
  predictionError,
});

    // ────────────────────────────────
    // 🔹 1. Update barangay-level stats in /ml_stats
    // ────────────────────────────────
    const statsRef = doc(this.firestore, `ml_stats/${barangay}`);
    const statsSnap = await getDoc(statsRef);

    if (!statsSnap.exists()) {
await setDoc(statsRef, {
  barangay,
  totalTrips: 1,
  totalMinutes: durationMinutes,
  avgMinutes: durationMinutes,
  distanceFactor: 3,
  itemFactor: 1,
  morningFactor: 1,       
  afternoonFactor: 1,     
  eveningFactor: 1,       
  lastUpdated: serverTimestamp(),
});
    } else {
      const data = statsSnap.data() as any;
      const totalTrips = (data.totalTrips || 0) + 1;
      const totalMinutes = (data.totalMinutes || 0) + durationMinutes;
      const avgMinutes = Math.round(totalMinutes / totalTrips);

      await updateDoc(statsRef, {
        barangay,
        totalTrips,
        totalMinutes,
        avgMinutes,
        distanceFactor: data.distanceFactor ?? 3,
        itemFactor: data.itemFactor ?? 1,
        morningFactor: data.morningFactor ?? 1,
        afternoonFactor: data.afternoonFactor ?? 1,
        eveningFactor: data.eveningFactor ?? 1,
        lastUpdated: serverTimestamp(),
      });
    }

    // ────────────────────────────────
    // 🔹 2. Log richer per-delivery data in /ml_delivery_logs
    // ────────────────────────────────
    const logsRef = collection(this.firestore, 'ml_delivery_logs');
    await addDoc(logsRef, {
      orderId: order?.id || orderId,
      barangay,
      courierName: this.courierName || 'Unknown Courier',
      stationName: this.stationName || 'Unknown Station',
      durationMinutes: Number(durationMinutes),
      predictedMinutes: Number(predictedMinutes),
      predictionError: Number(predictionError),
      distanceKm: Number(distanceKm.toFixed(2)),
      itemCount: Number(itemCount),
      hourBucket,
      deliveryMode,
      confidence: prediction.confidence,
      deliveredAt: new Date().toISOString(),
      createdAt: serverTimestamp(),
    });

    console.log(
      `📊 ML log saved for ${barangay}: actual=${durationMinutes} min, predicted=${predictedMinutes} min, error=${predictionError}`
    );

    try {
  await this.mlWeightService.trainFromLogs();
  console.log('🧠 ML model retrained successfully after delivery.');
} catch (trainErr) {
  console.warn('⚠️ ML retraining failed after delivery:', trainErr);
}

  }
  else {
  console.warn('⚠️ Skipping ML log because duration is invalid:', durationMinutes);
}
} catch (err) {
  console.warn('⚠️ ML stats logging failed:', err);
}

    // ────────────────────────────────
    // 🔹 Update courier daily log
    // ────────────────────────────────
    if (stationId && this.myCourierId) {
      try {
        const todayKey = new Date().toISOString().split('T')[0];
        const logRef = doc(this.firestore, `stations/${stationId}/couriers/${this.myCourierId}/dailyLogs/${todayKey}`);
        const existing = await getDoc(logRef);
        const prev = existing.exists() ? existing.data() : {};
        const totalDeliveries = (prev?.['totalDeliveries'] || 0) + 1;
        const totalEarnings = (prev?.['totalEarnings'] || 0) + (order?.charges?.total || 0);
        const totalDuration = (prev?.['totalDuration'] || 0) + (durationMinutes || 0);
        const averageDuration = Math.round(totalDuration / totalDeliveries);
        await setDoc(logRef, {
          date: todayKey,
          totalDeliveries,
          totalEarnings,
          totalDuration,
          averageDuration,
          updatedAt: serverTimestamp(),
        }, { merge: true });
      } catch (err) {
        console.warn('⚠️ Failed to update courier daily log:', err);
      }
    }

    // ────────────────────────────────
    // 🔹 Notifications (User + Manager)
    // ────────────────────────────────
    try {
      // Notify user with delivery proof
      if (order.userId) {
        await this.notifyUserOrderDelivered(order, proofUrl);
      }

  // Notify manager

      // Notify manager
      if (stationId) {
        const stationRef = doc(this.firestore, `stations/${stationId}`);
        const snap = await getDoc(stationRef);
        const managerId = snap.exists() ? (snap.data() as any).ownerId : null;
        if (managerId) {
          await this.notificationService.addManagerNotification(managerId, {
            type: 'delivery',
            subtype: 'courierUpdate',
            message: `🚚 ${courierName} marked order #${orderId} as Delivered.`,
            read: false,
            createdAt: serverTimestamp(),
          });
          console.log(`📩 Manager notified: Courier delivered order #${orderId}`);
        }
      }
    } catch (err) {
      console.error('⚠️ Notification failed:', err);
    }

    // ────────────────────────────────
    // 🔹 Local cleanup & refresh
    // ────────────────────────────────
    if (useStationScoped) {
      setTimeout(async () => {
        try {
          await deleteDoc(orderRef);
          console.log('🗑️ Station order deleted after sync delay');
        } catch {}
      }, 12000);
    }

// remove delivered order from active list
this.assignedOrders = this.assignedOrders.filter(
  o => o.id !== orderId
);

// auto move to next order if available
if (this.assignedOrders.length > 0) {
  this.expandedOrderId = this.assignedOrders[0].id;
} else {
  this.expandedOrderId = null; // go back to list
}
    this.deliveriesCoords = await this.resolveDeliveryCoords(this.assignedOrders);
    this.computeMetrics();
    this.zone.run(() => this.cdRef.detectChanges());
    await this.recalcAfterDelivery();
    this.deliveryProofFile = null;
    this.deliveryProofPreviewUrl = null;
    await this.show('✅ Order marked as delivered', 'success');
  } catch (err) {
    console.error('❌ confirmDelivery() failed:', err);
    await this.show('Failed to confirm delivery.', 'danger');
  }
}


// ─────────────── Single-shot GPS Fallback (for --external live reload) ───────────────
private async tryAutoLocate() {
  try {
    console.log('📡 Attempting single-shot GPS locate (external/live-reload safety)...');
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 10000,
    });

    const { latitude, longitude } = pos.coords;
    const pt = { lat: latitude, lng: longitude };

    if (this.inTuguegarao(pt)) {
      this.courierCoords = pt;
      console.log('✅ GPS located (fallback success):', this.courierCoords);

      // 🔹 Sync immediately to Firestore
      if (this.stationId && this.myCourierId && this.uid) {
        await this.courierService.flushLocationUpdate(
          this.stationId,
          this.myCourierId,
          this.uid,
          pt.lat,
          pt.lng
        );
      }
    } else {
console.warn('⚠️ GPS outside Tuguegarao — waiting for a valid fix instead.');
this.courierCoords = null;
return; // prevent fallback
    }
} catch (err) {
  console.warn('⚠️ tryAutoLocate() failed:', err);
  // ❌ Remove station fallback
  this.courierCoords = null;
}
}


// ─────────────── GPS (live device position, real-time + Firestore mirror) ───────────────
private async startCourierTracking() {
  try {
    console.log('📡 Starting courier GPS tracking...');
    let lastUpdateTime = 0;
    let lastCoords: LatLng | null = null;

    // 🧹 Clear any existing watcher to prevent duplicates
    if (this.watchId) {
      await Geolocation.clearWatch({ id: this.watchId });
    }

    this.watchId = await Geolocation.watchPosition(
      {
        enableHighAccuracy: true,  // use GPS chip, not Wi-Fi
        timeout: 7000,              // faster retry
        maximumAge: 0,              // always fresh fix
      },
      async (pos, err) => {
        if (err || !pos?.coords) return;

        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        const pt = { lat, lng };
        const now = Date.now();

        // ⚠️ Skip invalid or out-of-area fixes
        if (!this.inTuguegarao(pt)) {
          console.warn('⚠️ Ignored GPS fix outside Tuguegarao:', pt);
          return;
        }

        // 🕒 Throttle Firestore writes — every 2.5s minimum
        if (now - lastUpdateTime < 2500) return;

        // 🚫 Ignore micro-jitter (<3 meters)
        if (lastCoords) {
          const dist = this.haversineDistance(lastCoords, pt);
          if (dist < 0.003) return;
        }

        // ✅ Accept new coordinate
        lastUpdateTime = now;
        lastCoords = pt;
        this.courierCoords = pt;

        // 🧭 Update route dynamically
        await this.rebuildRouteFromCourier();

        console.log('📍 Courier GPS update:', pt);

        // 🔁 Firestore sync (batched + throttled)
        if (this.stationId && this.myCourierId && this.uid) {
          try {
            await this.courierService.flushLocationUpdate(
              this.stationId,
              this.myCourierId,
              this.uid,
              lat,
              lng
            );
          } catch (e) {
            console.warn('⚠️ Firestore courier location sync failed:', e);
          }
        }

        // 🩵 Live UI refresh
        this.zone.run(() => this.cdRef.detectChanges());
      }
    );
  } catch (err) {
    console.warn('⚠️ Failed to start GPS tracking:', err);
  }
}

// ─────────────── Distance calculator (km) ───────────────
private haversineDistance(a: LatLng, b: LatLng): number {
  const R = 6371; // Earth radius in km
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(h)); // returns distance in km
}

private async rankStopsBySmartETA(
  stops: Array<{ orderId: string; coords: LatLng }>
): Promise<Array<{ orderId: string; coords: LatLng; distanceKm: number; predictedMinutes: number }>> {
  const hour = new Date().getHours();
  const hourBucket =
    hour < 12 ? 'morning' :
    hour < 18 ? 'afternoon' : 'evening';

  const ranked = await Promise.all(
    stops.map(async (stop) => {
      const order = this.assignedOrders.find((o) => o.id === stop.orderId);

      const distanceKm = this.courierCoords
        ? Number(this.haversineDistance(this.courierCoords, stop.coords).toFixed(2))
        : 999999;

      const itemCount = Array.isArray(order?.items)
        ? order.items.reduce((sum: number, item: any) => sum + (Number(item.quantity) || 0), 0)
        : 1;

      const barangay = this.extractBarangay(order);

      let predictedMinutes = distanceKm * 5; // fallback estimate

      try {
        const prediction = await this.mlWeightService.predictDeliveryMinutes({
          barangay,
          distanceKm,
          itemCount,
          hourBucket,
        });

        predictedMinutes = Number(prediction?.predictedMinutes || predictedMinutes);
      } catch (err) {
        console.warn('⚠️ ML prediction failed for stop:', stop.orderId, err);
      }

      return {
        ...stop,
        distanceKm,
        predictedMinutes,
      };
    })
  );

  ranked.sort((a, b) => {
    if (a.predictedMinutes !== b.predictedMinutes) {
      return a.predictedMinutes - b.predictedMinutes;
    }
    return a.distanceKm - b.distanceKm;
  });

  return ranked;
}

private toMillis(value: any): number {
  if (!value) return 0;

  if (typeof value?.toDate === 'function') {
    return value.toDate().getTime();
  }

  if (typeof value?.seconds === 'number') {
    return value.seconds * 1000;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

private extractBarangay(order: any): string {
  const candidates = [
    order?.delivery?.barangay,
    order?.delivery?.addressInfo?.barangay,
    order?.delivery?.selectedAddress?.barangay,
    order?.address?.barangay,
    order?.customerAddress?.barangay,
    order?.shippingAddress?.barangay,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  const rawAddress =
    order?.delivery?.address ||
    order?.deliveryAddress ||
    order?.address ||
    order?.customerAddress?.fullAddress ||
    '';

  if (typeof rawAddress === 'string' && rawAddress.trim()) {
    const brgyMatch =
      rawAddress.match(/barangay\s+([a-z0-9\s\-]+)/i) ||
      rawAddress.match(/brgy\.?\s*([a-z0-9\s\-]+)/i);

    if (brgyMatch?.[1]) {
      return brgyMatch[1].trim();
    }

    const commaParts = rawAddress
      .split(',')
      .map((p: string) => p.trim())
      .filter(Boolean);

    if (commaParts.length >= 2) {
      return commaParts[1];
    }
  }

  return 'Unknown';
}

private getValidDurationMinutes(orderData: any): number {
  const nowMs = Date.now();

  const startCandidates = [
    orderData?.deliveryStartAt,
    orderData?.outForDeliveryAt,
    orderData?.pickedUpAt,
  ];

  let startMs = 0;

  for (const candidate of startCandidates) {
    const ms = this.toMillis(candidate);
    if (ms > 0 && ms < nowMs) {
      startMs = ms;
      break;
    }
  }

  if (!startMs && Array.isArray(orderData?.statusHistory)) {
    const outForDeliveryEntry = [...orderData.statusHistory]
      .reverse()
      .find((entry: any) => entry?.status === 'Out for Delivery');

    startMs = this.toMillis(outForDeliveryEntry?.changedAt);
  }

  if (!startMs) return 0;

  const mins = Math.round((nowMs - startMs) / 60000);

  if (mins <= 0 || mins > 180) {
    return 0;
  }

  return mins;
}

// ─────────────── Real-time Firestore Listener ───────────────
private listenToCourierLivePosition() {
  if (!this.stationId || !this.myCourierId) return;

  const ref = doc(this.firestore
, `stations/${this.stationId}/couriers/${this.myCourierId}`);
  const unsub = onSnapshot(ref, (snap) => {
    if (snap.exists()) {
      const data = snap.data() as any;
      if (data?.lat && data?.lng) {
        const pt = { lat: Number(data.lat), lng: Number(data.lng) };
        if (this.inTuguegarao(pt)) {
          this.courierCoords = pt;
          this.zone.run(() => this.cdRef.detectChanges());
        }
      }
    }
  });

  // store both RxJS and Firestore unsubscribers
  this.subs.push(() => unsub());
}

  private stopCourierTracking() {
    if (this.watchId) {
      Geolocation.clearWatch({ id: this.watchId });
      this.watchId = null;
    }
  }

// ─────────────── Consistent Earnings & Counts (Delivered-only) ───────────────
private computeMetrics(completedOrders: Order[] = []) {
  // 🟢 If no completed orders passed, keep everything at zero
  if (!Array.isArray(completedOrders)) completedOrders = [];

  // ✅ Total number of completed (Delivered) orders
  this.completedCount = completedOrders.length;

  // ✅ Total gallons delivered = sum of all item quantities from completed orders
  this.gallonsDelivered = completedOrders.reduce((sum, o) => {
    const qty = Array.isArray(o?.items)
      ? o.items.reduce(
          (s: number, it: any) => s + (Number(it.quantity) || 0),
          0
        )
      : 0;
    return sum + qty;
  }, 0);

  // ✅ Total earnings = sum of charges.total across completed orders
  this.estimatedEarnings = completedOrders.reduce(
    (sum, o) => sum + (Number(o?.charges?.total) || 0),
    0
  );

  // 🧾 Optional debug output
  console.log('📊 Courier metrics recalculated:', {
    completed: this.completedCount,
    gallons: this.gallonsDelivered,
    earnings: this.estimatedEarnings,
  });
}

  // ─────────────── Courier Active ───────────────
  private async updateCourierStatus(active: boolean) {
    if (!this.stationId || !this.myCourierId) return;
    try {
const ref = doc(this.firestore, `stations/${this.stationId}/couriers/${this.myCourierId}`);
      await updateDoc(ref, { active });
    } catch (err) {
      console.error('⚠️ Failed to update courier status', err);
    }
  }

  // ─────────────────────────────────────────────
// 🧩 TEMPORARY FIX — Backfill courier daily logs
// ─────────────────────────────────────────────
private async backfillDailyLogs() {
  if (!this.stationId || !this.myCourierId) return;

  try {
    console.log('🧾 Backfilling courier daily logs...');

    const histRef = collection(
      this.firestore,
      `stations/${this.stationId}/couriers/${this.myCourierId}/deliveryHistory`
    );
    const snap = await getDocs(histRef);

    const grouped: Record<string, any[]> = {};

    // Group all deliveries by date
snap.forEach((d: any) => {
  const data = d.data() as any;
      const delivered =
        data.deliveredAt?.toDate?.() ||
        new Date(data.deliveredAt?.seconds * 1000 || 0);

      if (!delivered || isNaN(delivered.getTime())) return;

      const key = delivered.toISOString().split('T')[0];
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(data);
    });

    for (const [dateKey, list] of Object.entries(grouped)) {
      const totalDeliveries = list.length;
      const totalEarnings = list.reduce(
        (sum, o) => sum + (Number(o?.charges?.total) || Number(o?.totalAmount) || 0),
        0
      );

      const durations = list
        .map((o) => o?.durationMinutes || 0)
        .filter((v: number) => v > 0);
      const avgDuration =
        durations.length > 0
          ? Math.round(durations.reduce((s, v) => s + v, 0) / durations.length)
          : 0;

      const logRef = doc(
        this.firestore,
        `stations/${this.stationId}/couriers/${this.myCourierId}/dailyLogs/${dateKey}`
      );

      await setDoc(
        logRef,
        {
          date: dateKey,
          totalDeliveries,
          totalEarnings,
          averageDuration: avgDuration,
          updatedAt: new Date(),
        },
        { merge: true }
      );

      console.log(`✅ Created daily log for ${dateKey}:`, {
        totalDeliveries,
        totalEarnings,
        avgDuration,
      });
    }

    console.log('🎉 Backfill complete.');
  } catch (err) {
    console.error('❌ Failed to backfill daily logs:', err);
  }
}

// ─────────────── Ratings + Feedback Listener ───────────────
private listenToCourierRatings() {
  if (!this.myCourierId) return;

  // 🔹 Live rating updates
  const courierRef = doc(this.firestore, `couriers/${this.myCourierId}`);
  const unsubRating = onSnapshot(courierRef, (snap) => {
    if (snap.exists()) {
      const data = snap.data() as any;
      this.avgRating = data.avgRating ?? 0;
      this.totalRatings = data.totalRatings ?? 0;
      this.zone.run(() => this.cdRef.detectChanges());
    }
  });

  // 🔹 Listen for new rating feedback notifications
  const notifRef = collection(this.firestore, `couriers/${this.myCourierId}/notifications`);
  const unsubNotif = onSnapshot(notifRef, (snap) => {
    snap.docChanges().forEach((change) => {
      const n = change.doc.data() as any;
      if (change.type === 'added' && n.type === 'rating') {
        this.show(
          `⭐ New rating received${n.message ? ': ' + n.message : ''}`,
          'medium'
        );
      }
    });
  });

  this.subs.push(() => unsubRating());
  this.subs.push(() => unsubNotif());
}

// ─────────────── Mirror status to User's Orders subcollection ───────────────
private async mirrorToUserOrders(order: any, newStatus: string) {
  try {
    const userId = order?.userId || order?.customerId;
    if (!userId || !order?.id) return;

    const userOrderRef = doc(this.firestore, `users/${userId}/orders/${order.id}`);
    await setDoc(
      userOrderRef,
      {
        status: newStatus,
        lastUpdatedAt: serverTimestamp(),
statusHistory: arrayUnion({
  status: newStatus,
  changedAt: new Date(), // ✅
  by: this.courierName || 'Courier',
}),
      },
      { merge: true }
    );
    console.log(`👥 Synced user order ${order.id} → ${newStatus}`);
  } catch (err) {
    console.warn('⚠️ Failed to mirror user order:', err);
  }
}

// ─────────────── Push Notification + Firestore Mirror (User Notify) ───────────────
private async notifyUserOrderDelivered(order: any, proofImageUrl?: string): Promise<void> {
  try {
    const userId = order?.userId;
    if (!userId) return;

    // 🔹 Create Firestore notification document
    const notifRef = collection(this.firestore, `users/${userId}/notifications`);
    await addDoc(notifRef, {
      type: 'orderUpdate',
      subtype: 'delivery_proof',
      title: 'Order Delivered',
      message: `Your order from ${order?.stationName || 'AquaRoute Station'} has been delivered.`,
      orderId: order?.id,
      proofImageUrl: proofImageUrl || null,
      createdAt: serverTimestamp(),
      read: false,
    });

    // 🔹 Optional push notification if token exists
    const userRef = doc(this.firestore, `users/${userId}`);
    const userSnap = await getDoc(userRef);
    const token = userSnap.exists() ? (userSnap.data() as any).pushToken : null;

    if (token) {
      await this.notificationService.sendPush({
        title: 'Order Delivered',
        body: 'Your AquaRoute delivery has arrived!',
        token,
        orderId: order?.id,
      });
    }

    console.log(`📩 Notification sent to user ${userId} for delivered order ${order?.id}`);
  } catch (err) {
    console.warn('⚠️ Failed to send delivery notification:', err);
  }
}

  // ─────────────── UI Helpers ───────────────
getStatusColor(status: string): string {
  switch (status) {
    case 'Pending':
    case 'Preparing':
      return 'warning';
    case 'Out for Delivery':
      return 'tertiary';
    case 'Delivered':
    case 'Completed':
      return 'success';
    case 'Cancelled':
      return 'danger';
    default:
      return 'medium';
  }
}

// ✅ Checks if there are any Delivery-mode orders
hasDeliveryOrders(): boolean {
  return Array.isArray(this.assignedOrders) &&
    this.assignedOrders.some(o => (o?.mode || 'Delivery') === 'Delivery');
}


  private async show(message: string, color: 'success' | 'warning' | 'danger' | 'medium') {
    const t = await this.toastCtrl.create({ message, duration: 2000, color });
    await t.present();
  }

  openNotifications(): void {
  this.router.navigate(['/courier-notifications']).catch(() => {});
}


expandedOrderId: string | null = null;
loadingOrderId: string | null = null;

async loadOrderDetails(orderId: string) {
  if (!this.stationId || !orderId) return null;

  try {
    const ref = doc(this.firestore, `stations/${this.stationId}/orders/${orderId}`);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      console.warn(`⚠️ Order ${orderId} not found in Firestore`);
      return null;
    }

    const data = snap.data() as any;
    const firstItem = data.items?.[0] || {};

    // 🔹 Normalize containerSwap like in Manager Orders
    const containerSwap =
      data.containerSwap === true ||
      data.containerSwap === 'true' ||
      data.containerSwap === 'Yes' ||
      data.charges?.containerSwap === true ||
      data.items?.[0]?.containerSwap === true ||
      data.items?.[0]?.charges?.containerSwap === true ||
      (Array.isArray(data.stations) && data.stations.some((st: any) => st.containerSwap === true)) ||
      false;

    // 🔹 Build delivery info
    const delivery = {
      fullName: data.delivery?.fullName || data.customerName || '',
      address: data.delivery?.address || data.deliveryAddress || '',
      phone: data.delivery?.phone || data.contact || '',
      notes:
        data.delivery?.notes?.trim?.() !== ''
          ? data.delivery?.notes
          : firstItem?.notes || null,
      window:
        data.delivery?.window ||
        firstItem?.slot ||
        data.slot ||
        null,
      schedule:
        data.delivery?.schedule ||
        firstItem?.scheduledAt ||
        data.scheduledAt ||
        null,
      mode:
        data.delivery?.mode ||
        data.mode ||
        firstItem?.mode ||
        'delivery',
    };

    // 🔹 Normalize charges
    const charges = {
      subtotal:
        data.charges?.subtotal ??
        data.subtotal ??
        data.items?.[0]?.charges?.subtotal ??
        0,
      deliveryFee:
        data.charges?.deliveryFee ??
        data.deliveryFee ??
        data.items?.[0]?.charges?.deliveryFee ??
        0,
      total:
        data.charges?.total ??
        data.total ??
        data.items?.[0]?.charges?.total ??
        0,
      containerSwap,
    };

    // 🔹 Merge normalized data
    const mergedOrder = {
      ...data,
      id: orderId,
      delivery,
      charges,
      containerSwap,
    };

    this.assignedOrders = this.assignedOrders.map(o =>
      o.id === orderId ? { ...o, ...mergedOrder } : o
    );

    console.log('📦 Courier normalized order details:', {
      id: orderId,
      containerSwap,
    });

    this.zone.run(() => this.cdRef.detectChanges());
    return mergedOrder;
  } catch (err) {
    console.error(`❌ Failed to fetch order ${orderId}:`, err);
    await this.show('Failed to load full order details.', 'danger');
    return null;
  }
}


// ─────────────── Formatters for readable delivery info ───────────────
formatWindow(window: string | null): string {
  if (!window) return '—';
  const w = window.toLowerCase();
  if (w.includes('morning')) return 'Morning';
  if (w.includes('afternoon')) return 'Afternoon';
  if (w.includes('evening')) return 'Evening';
  return window.charAt(0).toUpperCase() + window.slice(1);
}

formatSchedule(schedule: string | null): string {
  if (!schedule) return '—';
  // handles "10:00" → "10:00 AM", "15:30" → "3:30 PM"
  const [hStr, mStr] = schedule.split(':');
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr || '0', 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m.toString().padStart(2, '0')} ${ampm}`;
}

// 🔹 Get Water Type for each order
getWaterType(order: any): string {
  if (!order?.items?.length) return '—';
  const types = order.items
    .map((i: any) => i.waterType || i.type)
    .filter(Boolean);
  const unique = [...new Set(types)];
  return unique.length ? unique.join(', ') : '—';
}

// ─────────────── Expand / Collapse Order Card ───────────────
async toggleOrder(orderId: string) {
  if (this.expandedOrderId === orderId) {
    this.expandedOrderId = null;
  } else {
    this.expandedOrderId = orderId;
    this.loadingOrderId = orderId;
    await this.loadOrderDetails(orderId);
    this.loadingOrderId = null;
  }
}


private async rebuildRouteFromCourier() {
  if (!this.courierCoords || !this.deliveriesCoords?.length) {
    console.warn('⚠️ Missing data for rebuildRouteFromCourier');
    return;
  }

  const stops = this.assignedOrders.map((o, i) => ({
    orderId: o.id,
    coords: this.deliveriesCoords[i],
  }));

  const reordered = await this.rankStopsBySmartETA(stops);

  this.assignedOrders = reordered
    .map((r) => {
      const order = this.assignedOrders.find((o) => o.id === r.orderId);
      return order ? { ...order, distanceKm: r.distanceKm, predictedMinutes: r.predictedMinutes } : null;
    })
    .filter(Boolean) as Order[];

  this.deliveriesCoords = reordered.map((r) => r.coords);

  try {
    const plan = await this.optimizer.optimize(
      { coords: this.courierCoords } as any,
      reordered.map(({ orderId, coords }) => ({ orderId, coords }))
    );

    this.optimizedLegs = plan.legs || [];
    this.totalDistanceKm = (plan.totalDistanceMeters || 0) / 1000;
    this.totalTimeMin = (plan.totalTimeSec || 0) / 60;

    console.log('🧠 Rebuilt ML-assisted route:', plan);
  } catch (err) {
    console.warn('⚠️ Route optimization failed:', err);
  }

  this.zone.run(() => this.cdRef.detectChanges());
}

onMapReady(leafletMap: any) {
  this.map = leafletMap;
  console.log('🗺️ Courier map initialized');

  setTimeout(() => {
    try {
      this.map.invalidateSize?.();

      const bounds: [number, number][] = [];

      if (this.courierCoords) {
        bounds.push([this.courierCoords.lat, this.courierCoords.lng]);
      }

      for (const pt of this.deliveriesCoords) {
        if (pt?.lat != null && pt?.lng != null) {
          bounds.push([pt.lat, pt.lng]);
        }
      }

      if (bounds.length > 1) {
        this.map.fitBounds?.(bounds, { padding: [30, 30] });
      } else if (bounds.length === 1) {
        this.map.setView?.(bounds[0], 15);
      }
    } catch (err) {
      console.warn('⚠️ Failed to finalize courier map view:', err);
    }
  }, 250);
}

/** 🔁 Load any saved route plan from Firestore */
private async loadSavedRoutePlan() {
  if (!this.myCourierId) return;
  try {
    const saved = await this.optimizer.loadRouteFromFirestore(this.myCourierId);
    if (saved && saved.legs?.length) {
      this.optimizedLegs = saved.legs;
      console.log('📦 Loaded saved optimized route for courier:', saved.sequence);
      this.zone.run(() => this.cdRef.detectChanges());
    }
  } catch (err) {
    console.warn('⚠️ Failed to load saved route plan:', err);
  }
}

/** 🔁 Recalculate optimized route after completing a stop */
private async recalcAfterDelivery(): Promise<void> {
  if (!this.courierCoords || !this.assignedOrders?.length) return;

  const remainingStops = this.assignedOrders
    .filter(o => !['Delivered', 'Archived', 'Cancelled'].includes(o.status))
    .map((o, i) => ({
      orderId: o.id,
      coords: this.deliveriesCoords[i],
    }));

    const reordered = remainingStops
  .map((stop) => ({
    ...stop,
    distanceKm: this.courierCoords
      ? this.haversineDistance(this.courierCoords, stop.coords)
      : 999999,
  }))
  .sort((a, b) => a.distanceKm - b.distanceKm);

this.assignedOrders = reordered
  .map((r) => this.assignedOrders.find((o) => o.id === r.orderId))
  .filter(Boolean) as Order[];

this.deliveriesCoords = reordered.map((r) => r.coords);

  if (!remainingStops.length) {
    console.log('✅ No remaining deliveries — route complete.');
    return;
  }

  try {
const plan = await this.optimizer.optimize(
  { coords: this.courierCoords } as any,
  reordered.map(({ orderId, coords }) => ({ orderId, coords }))
);

    this.optimizedLegs = plan.legs || [];
    console.log('🔁 Re-optimized route from current location:', plan);

    // Save to Firestore so Track-Order can reflect new path
    if (this.myCourierId && this.stationId) {
      await this.optimizer.saveRouteToFirestore(this.myCourierId, this.stationId, plan);
      console.log('💾 Re-saved updated route to Firestore');
    }
  } catch (err) {
    console.warn('⚠️ Failed to re-optimize after delivery:', err);
  }
}

/** 🔁 Manually trigger route recalculation */
async recalculateRoute() {
  try {
    if (!this.courierCoords || !this.assignedOrders.length) {
      await this.show('No active deliveries or GPS fix yet.', 'warning');
      return;
    }

    const stops = this.assignedOrders.map((o, i) => ({
      orderId: o.id,
      coords: this.deliveriesCoords[i],
    }));

    const plan = await this.optimizer.optimize(
      { coords: this.courierCoords } as any,
      stops
    );

    this.optimizedLegs = plan.legs || [];
    await this.optimizer.saveRouteToFirestore(this.myCourierId!, this.stationId!, plan);

    await this.show('✅ Route recalculated successfully.', 'success');
  } catch (err) {
    console.warn('⚠️ Manual route recalculation failed:', err);
    await this.show('Failed to recalculate route.', 'danger');
  }
}
}
