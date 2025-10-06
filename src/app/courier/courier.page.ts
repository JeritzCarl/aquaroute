// src/app/courier/courier.page.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ToastController } from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import { Subscription } from 'rxjs';
import { CourierService } from '../services/courier.service';
import { Firestore, doc, docData, getDoc, updateDoc } from '@angular/fire/firestore';

// 🔹 Import the Route Map component
import { RouteMapComponent } from '../route-map/route-map.component';

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
  // Identity / scope
  uid: string | null = null;
  stationId: string | null = null;
  myCourierId: string | null = null;

  // UI header/meta
  courierName = 'Courier';
  stationName = 'Station';
  stationAddress = 'Tuguegarao City';
  courierPhotoUrl: string = 'assets/default-avatar.png';
  online = false;
  onlineStatusText = '🔴 Offline';

  // Data
  assignedOrders: Order[] = [];

  // Metrics
  completedCount = 0;
  gallonsDelivered = 0;
  estimatedEarnings = 0;

  // Loading state
  initializing = true;
  ordersLoading = true;

  // Internal
  private subs: Subscription[] = [];
  private watchId: number | null = null;

  // 🚚 Location throttling
  private lastUpdateTime = 0;
  private updateInterval = 10000;
  private pendingUpdate: { lat: number; lng: number } | null = null;
  private flushTimer: any = null;

  private _lastWaypointsKey: string | null = null;
  private _lastWaypointsLogged: string[] | null = null;


  // ✅ Station coordinates (for accurate navigation)
  stationLat?: number;
  stationLng?: number;

  constructor(
    private auth: Auth,
    private courierService: CourierService,
    private toast: ToastController,
    private afs: Firestore,
    private router: Router
  ) {}

  // ───────────────────────────────────────────────────────────────
  // Init
  // ───────────────────────────────────────────────────────────────
  ngOnInit() {
    const cached = localStorage.getItem('courierProfile');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        this.courierName = parsed.name || this.courierName;
        this.stationName = parsed.stationName || this.stationName;
        this.courierPhotoUrl = parsed.photoUrl || this.courierPhotoUrl;
      } catch {}
    }

    // ✅ Restore cached station coordinates if available
    const cachedCoords = localStorage.getItem('stationCoords');
    if (cachedCoords) {
      try {
        const coords = JSON.parse(cachedCoords);
        if (coords.lat && coords.lng) {
          this.stationLat = coords.lat;
          this.stationLng = coords.lng;
          console.log('📍 Cached station coords restored:', coords);
        }
      } catch {}
    }

    onAuthStateChanged(this.auth, async (user) => {
      if (user) {
        this.uid = user.uid;
        this.courierName = user.displayName || this.courierName;
        this.courierPhotoUrl = user.photoURL || this.courierPhotoUrl;

        const userRef = doc(this.afs, `users/${this.uid}`);
        const snap = await getDoc(userRef);

        if (snap.exists()) {
          const data = snap.data() as UserProfile;
          if (data.role !== 'courier') {
            this.router.navigateByUrl('/landing', { replaceUrl: true });
            return;
          }
          if (!data.locationSetupDone) {
            this.router.navigateByUrl('/location-setup', { replaceUrl: true });
            return;
          }
        } else {
          this.router.navigateByUrl('/landing', { replaceUrl: true });
          return;
        }

        this.online = true;
        this.onlineStatusText = '🟢 Online';
        this.startLocationWatch();

        await this.initialize();
        await this.updateCourierStatus(true);
      } else {
        this.uid = null;
        this.initializing = false;
        this.online = false;
        this.onlineStatusText = '🔴 Offline';
        this.stopLocationWatch();
        await this.updateCourierStatus(false);
      }
    });
  }

  // ───────────────────────────────────────────────────────────────
  // Initialize courier data
  // ───────────────────────────────────────────────────────────────
  private async initialize() {
    try {
      if (!this.uid) return;

      const info = await this.courierService.getCourierStationAndProfile(this.uid);
      if (!info) {
        await this.show('⚠️ No courier profile found for this account.', 'warning');
        return;
      }

      this.stationId = info.stationId;
      this.myCourierId = info.courierId;
      this.stationAddress = info.stationAddress || this.stationAddress;
      this.courierName = info.name || this.courierName;
      this.stationName = info.stationName || this.stationName;
      this.courierPhotoUrl = info.photoUrl || this.courierPhotoUrl;

      localStorage.setItem(
        'courierProfile',
        JSON.stringify({
          name: this.courierName,
          stationName: this.stationName,
          photoUrl: this.courierPhotoUrl,
        })
      );

      // ✅ Load station coordinates from Firestore for accurate navigation
      if (this.stationId) {
        const stationRef = doc(this.afs, `stations/${this.stationId}`);
        const snap = await getDoc(stationRef);
        if (snap.exists()) {
          const data: any = snap.data();
          if (data?.lat && data?.lng) {
            this.stationLat = data.lat;
            this.stationLng = data.lng;
          } else if (data?.stationLatLng?.lat && data?.stationLatLng?.lng) {
            this.stationLat = data.stationLatLng.lat;
            this.stationLng = data.stationLatLng.lng;
          }

          // ✅ Smart caching
          if (this.stationLat && this.stationLng) {
            localStorage.setItem(
              'stationCoords',
              JSON.stringify({ lat: this.stationLat, lng: this.stationLng })
            );
            console.log('📍 Station coords cached:', this.stationLat, this.stationLng);
          }
          // ✅ Initialize courier position at station before GPS starts
            if (this.stationLat && this.stationLng && this.stationId && this.myCourierId && this.uid) {
              try {
                await this.courierService.flushLocationUpdate(
                  this.stationId,
                  this.myCourierId,
                  this.uid,
                  this.stationLat,
                  this.stationLng
                );
                console.log('📍 Courier initialized at station coordinates.');
                // ✅ Fallback: if station coordinates are still missing, geocode from address
if ((!this.stationLat || !this.stationLng) && this.stationAddress) {
  console.warn('⚠️ Station has no coordinates — geocoding from address...');
  try {
    const query = encodeURIComponent(this.stationAddress + ', Tuguegarao City');
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${query}`);
    const data = await res.json();
    if (data.length > 0) {
      this.stationLat = parseFloat(data[0].lat);
      this.stationLng = parseFloat(data[0].lon);
      console.log('📍 Geocoded station →', this.stationLat, this.stationLng);
      localStorage.setItem(
        'stationCoords',
        JSON.stringify({ lat: this.stationLat, lng: this.stationLng })
      );
    }
  } catch (err) {
    console.warn('⚠️ Geocode failed:', err);
  }
}
              } catch (err) {
                console.warn('⚠️ Failed to initialize courier location:', err);
              }
            }
        }
      }

      if (this.stationId && this.myCourierId) {
        const profileRef = doc(this.afs, `stations/${this.stationId}/couriers/${this.myCourierId}`);
        const profile$ = docData(profileRef, { idField: 'id' });
        const profileSub = profile$.subscribe((data: any) => {
          if (!data) return;
          this.courierName = data.name || this.courierName;
          this.stationName = data.stationName || this.stationName;
          this.courierPhotoUrl = data.photoUrl || this.courierPhotoUrl;

          localStorage.setItem(
            'courierProfile',
            JSON.stringify({
              name: this.courierName,
              stationName: this.stationName,
              photoUrl: this.courierPhotoUrl,
            })
          );
        });
        this.subs.push(profileSub as unknown as Subscription);
      }

      const sub = this.courierService
        .getAssignedOrders(this.stationId!, this.myCourierId!)
        .subscribe((orders) => {
          this.assignedOrders = orders || [];
          this.computeMetrics();
          this.ordersLoading = false;
        });
      this.subs.push(sub);

      this.courierService.listenForNewAssignments(
        this.stationId!,
        this.myCourierId!,
        async (orderId: string) => {
          await this.show(`📦 New order assigned: ${orderId}`, 'success');
        }
      );
    } finally {
      this.initializing = false;
    }
  }

  // ───────────────────────────────────────────────────────────────
  // Refresh + Destroy
  // ───────────────────────────────────────────────────────────────
  async doRefresh(evt: CustomEvent) {
    try {
      this.ordersLoading = true;
      this.subs.forEach((s) => s.unsubscribe());
      this.subs = [];
      await this.initialize();
    } finally {
      (evt.target as HTMLIonRefresherElement).complete();
    }
  }

  ngOnDestroy() {
    this.subs.forEach((s) => s.unsubscribe());
    this.stopLocationWatch();
  }

  // ───────────────────────────────────────────────────────────────
  // Metrics
  // ───────────────────────────────────────────────────────────────
  private computeMetrics() {
    this.completedCount = this.assignedOrders.filter((o) => o.status === 'Delivered').length;

    this.gallonsDelivered = this.assignedOrders.reduce((sum, o) => {
      const n = Array.isArray(o?.items)
        ? o.items.reduce((s: number, it: any) => s + (it.quantity || 0), 0)
        : 0;
      return sum + n;
    }, 0);

    this.estimatedEarnings = this.assignedOrders.reduce(
      (sum, o) => sum + (Number(o?.charges?.deliveryFee) || 0),
      0
    );
  }

  // ───────────────────────────────────────────────────────────────
  // Update Courier Active Status
  // ───────────────────────────────────────────────────────────────
  private async updateCourierStatus(active: boolean) {
    if (!this.stationId || !this.myCourierId) return;
    try {
      const ref = doc(this.afs, `stations/${this.stationId}/couriers/${this.myCourierId}`);
      await updateDoc(ref, { active });
      console.log(`🚚 Courier status updated → ${active ? 'Online' : 'Offline'}`);
    } catch (err) {
      console.error('⚠️ Failed to update courier status', err);
    }
  }
  
    // ─────────────── Order Actions (Pick Up / Delivered) ───────────────
  canStartDelivery(o: Order) {
    return o?.status === 'Preparing' || o?.status === 'Pending Pickup';
  }

  canMarkDelivered(o: Order) {
    return o?.status === 'Out for Delivery';
  }

  async setOutForDelivery(o: Order) {
    if (!this.stationId || !o?.id) return;
    await this.courierService.updateOrderStatus(
      this.stationId,
      o.id,
      this.courierName,
      'Out for Delivery',
      `${this.courierName} picked up the order`
    );
    await this.show(`🚚 Order ${o.id} is Out for Delivery`, 'success');
  }

  async setDelivered(o: Order) {
    if (!this.stationId || !o?.id) return;
    await this.courierService.updateOrderStatus(
      this.stationId,
      o.id,
      this.courierName,
      'Delivered',
      `${this.courierName} delivered the order`
    );
    await this.show(`✅ Order ${o.id} marked Delivered`, 'success');
  }

  // ─────────────── Computed Waypoints (for RouteMap) ───────────────
// ─────────────── Computed Waypoints (for RouteMap) ───────────────
get orderWaypoints(): string[] {
  // 🧭 Collect all valid delivery addresses
  const waypoints = (this.assignedOrders || [])
    .map((o) => o?.delivery?.address || o?.flatAddress || o?.address)
    .filter((addr) => typeof addr === 'string' && addr.trim().length > 5);

  // 🧹 Remove duplicates and filter out the station address (if same)
  const unique = Array.from(
    new Set(
      waypoints.filter(
        (addr) =>
          !this.stationAddress ||
          addr.trim().toLowerCase() !== this.stationAddress.trim().toLowerCase()
      )
    )
  );

  // 🧩 If no valid delivery addresses, fallback to station only
  if (unique.length === 0 && this.stationAddress) {
    if (!this._lastWaypointsLogged) {
      console.log('📍 No active orders → showing station only');
      console.log('📍 Station Address for Map:', this.stationAddress);
      this._lastWaypointsLogged = [this.stationAddress];
    }
    return [this.stationAddress];
  }

  // 🧠 Prevent console spam & re-render loops
  const newWaypointsKey = JSON.stringify(unique);
  if (this._lastWaypointsKey !== newWaypointsKey) {
    console.log('🛣️ Waypoints sent to map (final):', unique);
    console.log('📍 Station Address for Map:', this.stationAddress);
    this._lastWaypointsKey = newWaypointsKey;
    this._lastWaypointsLogged = unique;
  }

  return unique;
}

  // ───────────────────────────────────────────────────────────────
  // Navigation Fix (uses station coordinates or courier location)
  // ───────────────────────────────────────────────────────────────
openNavigation(o: Order) {
  const lat = o?.delivery?.lat ?? o?.delivery?.latLng?.lat;
  const lng = o?.delivery?.lng ?? o?.delivery?.latLng?.lng;

  // ⚠️ Validate destination coordinates
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    this.show('⚠️ No delivery location available', 'warning');
    return;
  }

  // ✅ Ensure we always have station coordinates (restore from cache if missing)
  if (!this.stationLat || !this.stationLng) {
    const cached = localStorage.getItem('stationCoords');
    if (cached) {
      const { lat: cLat, lng: cLng } = JSON.parse(cached);
      this.stationLat = cLat;
      this.stationLng = cLng;
      console.log('📦 Restored station coords from cache for navigation:', cLat, cLng);
    }
  }

  // 🔹 Determine proper origin
  let origin = '';

  if (
    (o?.status === 'Preparing' || o?.status === 'Pending Pickup') &&
    this.stationLat &&
    this.stationLng
  ) {
    // ✅ Courier starts from the station
    origin = `${this.stationLat},${this.stationLng}`;
    console.log('🧭 Origin set to station coordinates:', origin);
  } else if (o?.status === 'Preparing' || o?.status === 'Pending Pickup') {
    // 🟡 Fallback to station address string
    origin = encodeURIComponent(this.stationAddress || 'Tuguegarao City');
    console.log('🧭 Origin fallback to address:', origin);
  } else {
    // 🟢 Use current courier location for en-route navigation
    origin = 'My+Location';
    console.log('🧭 Origin set to My Location');
  }

  // 🔹 Destination (always valid numeric lat/lng)
  const dest = `${lat},${lng}`;

  // ✅ Build full Google Maps route link
  const url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&travelmode=driving`;

  console.log('🗺️ Navigation URL:', url);
  window.open(url, '_system');
}

  // ───────────────────────────────────────────────────────────────
  // Courier location watch (unchanged)
  // ───────────────────────────────────────────────────────────────
  private startLocationWatch() {
    if (!('geolocation' in navigator)) {
      console.warn('❌ Geolocation not supported');
      return;
    }
    if (this.watchId !== null) return;

    this.watchId = navigator.geolocation.watchPosition(
      async (pos) => {
        if (!this.stationId || !this.myCourierId || !this.uid) return;
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const now = Date.now();

        if (now - this.lastUpdateTime < this.updateInterval) {
          this.pendingUpdate = { lat, lng };
          return;
        }
        await this.flushLocationUpdate(lat, lng);
      },
      (err) => {
        console.error('⚠️ Location watch error:', err);
        this.show('⚠️ Unable to fetch GPS location', 'warning');
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
    );

    this.flushTimer = setInterval(async () => {
      if (this.pendingUpdate && this.stationId && this.myCourierId && this.uid) {
        const { lat, lng } = this.pendingUpdate;
        this.pendingUpdate = null;
        await this.flushLocationUpdate(lat, lng);
      }
    }, this.updateInterval);
  }

  private async flushLocationUpdate(lat: number, lng: number) {
    try {
      this.lastUpdateTime = Date.now();
      await this.courierService.flushLocationUpdate(
        this.stationId!,
        this.myCourierId!,
        this.uid!,
        lat,
        lng
      );
      const activeOrders = this.assignedOrders.filter((o) => o.status === 'Out for Delivery');
      for (const o of activeOrders) {
        await this.courierService.updateActiveOrderLocation(this.stationId!, o.id, lat, lng);
      }
    } catch (err) {
      console.error('⚠️ Failed to update courier location:', err);
    }
  }

  private stopLocationWatch() {
    if (this.watchId !== null && 'geolocation' in navigator) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  // ───────────────────────────────────────────────────────────────
  // UI Helpers
  // ───────────────────────────────────────────────────────────────
  badgeColor(status: string) {
    const s = (status || '').toLowerCase();
    if (s.includes('prepar')) return 'warning';
    if (s.includes('out for')) return 'tertiary';
    if (s.includes('deliver')) return 'success';
    if (s.includes('cancel')) return 'danger';
    return 'medium';
  }

  private async show(message: string, color: 'success' | 'warning' | 'danger' | 'medium') {
    const t = await this.toast.create({ message, duration: 2000, color });
    await t.present();
  }
}
