// manager.page.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, AlertController, ToastController } from '@ionic/angular';
import { RouterModule, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Auth, onAuthStateChanged, User } from '@angular/fire/auth';
import {
  Firestore,
  collection,
  collectionData,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  getDoc,
  getDocs,
  setDoc,
  arrayUnion,
  serverTimestamp,
  onSnapshot,
} from '@angular/fire/firestore';
import { Observable, Subscription } from 'rxjs';
import { UserService } from '../services/user.service';
import { NotificationService } from '../services/notification.service';
import { Station } from '../models/station.model';
import { Product } from '../models/product.model';
import { Courier } from '../models/courier.model';
import { Order, OrderItem, CourierRef } from '../models/order.model';
import * as L from 'leaflet';
import { RealtimeSyncService } from '../services/realtime-sync.service';
import { RouteLoggerService } from '../services/route-logger.service';
import { Geolocation } from '@capacitor/geolocation';
import { OrderSyncService } from '../services/order-sync.service';
import { LatLng, GeoService } from '../services/geo.service';
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from '@angular/fire/storage';
import { Storage } from '@ionic/storage-angular';
import { MLWeightService } from '../services/ml-weight.service';

function safeStatusEntry(status: string, by: string) {
  return {
    status,
    changedAt: new Date(), // ✅ safe local timestamp
    by,
  };
}

@Component({
  selector: 'app-manager',
  standalone: true,
  templateUrl: './manager.page.html',
  styleUrls: ['./manager.page.scss'],
imports: [CommonModule, IonicModule, RouterModule, FormsModule],
providers: [
  {
    provide: Storage,
    useFactory: async () => {
      const storage = new Storage();
      await storage.create();
      return storage;
    },
  },
],
})
export class ManagerPage implements OnInit, OnDestroy {
  myStation: Station | null = null;
  myProducts$!: Observable<Product[]>;
  myOrders$!: Observable<Order[]>;
  otherStations: Station[] = [];
  myCouriers: Courier[] = [];
  vehicleOptions: string[] = [];

  myOrdersList: Order[] = [];
  newOrdersCount = 0;
  preparingCount = 0;
  inTransitCount = 0;
  completedCount = 0;
  efficiencyScore = 0;
  managerId?: string;

  private map!: L.Map;
  private markersLayer!: L.LayerGroup;

  activeOrdersCount = 0;
  isOpen: boolean = false;
  openSchedule: string | null = null;

  profilePic: string = 'assets/profile-placeholder.png';
  displayName: string | null = null;
  email: string | null = null;
  phoneNumber: string | null = null;

  selectedTab: string = 'dashboard';

  stationVerificationStatus: 'pending' | 'approved' | 'disabled' | 'rejected' | null = null;
  stationStatusMessage = '';

  uploadProgress = 0;
  selectedImageFile: File | null = null;
  uploadedImageUrl: string | null = null;

  private subs: Subscription[] = [];
  private lastSeenOrders = new Set<string>();
  private firestoreSubs: any[] = [];
  private readonly STORAGE_KEY = 'manager_seen_orders';

  newOrdersBadge = 0;
  private unsubscribeOrdersListener?: () => void;
  private readonly validTransitions: Record<string, string> = {
    New: 'Preparing',
    Pending: 'Preparing',
    Preparing: 'Out for Delivery',
    'Out for Delivery': 'Delivered',
  };

  private lastActiveOrderCount = 0;
  private hasShownToast = false;
  unreadNotifCount = 0;
  private notifUnsub?: () => void;


  constructor(
    private firestore: Firestore,
    private userService: UserService,
    private notificationService: NotificationService,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
    private router: Router,
    private auth: Auth,
    private readonly realtime: RealtimeSyncService,
    private readonly routeLogger: RouteLoggerService,
    private readonly orderSync: OrderSyncService,
    private storage: Storage,
    private mlWeightService: MLWeightService,
  ) {}
  
// ───────────────────────────────────────────────────────────
// Lifecycle
// ───────────────────────────────────────────────────────────
ngOnInit(): void {
  const userSub = this.userService.user$.subscribe(async (user) => {
    if (!user) {
      this.teardownOrdersListener();
      this.myStation = null;
      this.profilePic = 'assets/profile-placeholder.png';
      this.displayName = null;
      this.email = null;
      this.phoneNumber = null;
      this.setEmptyStreams();
      return;
    }

    // 🔑 Role check: allow only managers
    const snap = await getDoc(doc(this.firestore, `users/${user.uid}`));
    if (!snap.exists()) {
      console.warn('⚠️ User doc not found');
      return;
    }

    const role = snap.data()?.['role'];
    if (role !== 'manager') {
      console.warn(`⚠️ User role is ${role}, not manager`);
      return;
    }

    this.managerId = user.uid;

    this.listenToManagerNotifications(user.uid);


    // Header profile (only runs if manager)
    this.displayName = user.displayName ?? 'Manager';
    this.email = user.email ?? null;
    this.profilePic = (user.photoURL as string) ?? this.profilePic;
    this.phoneNumber = user.phoneNumber ? user.phoneNumber.replace(/^\+63/, '0') : null;

    // Stations owned by user
    const stationsRef = collection(this.firestore, 'stations');
    const qStations = query(stationsRef, where('ownerId', '==', user.uid));

const stationsSub = collectionData(qStations, { idField: 'id' }).subscribe(async (stations: any[]) => {
  this.myStation = stations?.length ? (stations[0] as Station) : null;
  this.applyStationVerificationState(this.myStation);

  if (this.myStation?.id) {
  this.listenForStationActiveChanges();
  }

  // ✅ Persist for Notifications Page
if (this.myStation?.id) {
  localStorage.setItem('stationId', this.myStation.id);
  console.log('📍 Station ID saved to localStorage:', this.myStation.id);
}

// ✅ Immediately display water types after registering (fix)
if (this.myStation) {
  const s: any = this.myStation;

  if (s['availableTypes']) {
    const available = Object.entries(s['availableTypes'])
      .filter(([_, val]) => val)
      .map(([key]) => key);
    s['waterTypesDisplay'] = available.join(', ');
  } else if (Array.isArray(s['types'])) {
    s['waterTypesDisplay'] = s['types'].join(', ');
  } else {
    s['waterTypesDisplay'] = '—';
  }
}

  // ✅ Validate coordinates (no Roxas issue)
  if (this.myStation) {
    const lat = this.myStation.lat || 0;
    const lng = this.myStation.lng || 0;
    const outOfBounds =
      lat < 17.58 || lat > 17.67 || lng < 121.68 || lng > 121.79;

    if (outOfBounds || !lat || !lng) {
      console.warn('⚠️ Invalid station coordinates detected — correcting to Tuguegarao bounds.');
      this.myStation.lat = 17.6209;
      this.myStation.lng = 121.7266;
      await updateDoc(doc(this.firestore, `stations/${this.myStation.id}`), {
        lat: this.myStation.lat,
        lng: this.myStation.lng,
        lastLocationUpdate: new Date(),
      }).catch(() => {});
    }
  }

  // 🔹 Init map once station is loaded
  if (this.myStation?.lat && this.myStation?.lng) {
    this.initMap([this.myStation.lat, this.myStation.lng]);
  } else {
    this.initMap(); // fallback to Tuguegarao
  }

  // Reset & rebuild streams + listeners
  this.teardownOrdersListener();


      if (this.myStation?.id) {
      this.initDashboardSync();
        // Products
        const productsRef = collection(this.firestore, `stations/${this.myStation.id}/products`);
        this.myProducts$ = collectionData(productsRef, { idField: 'id' }) as Observable<Product[]>;

        // ─────────────────────────────
        // 🧩 Orders Listener (active)
        // ─────────────────────────────
        const ordersRef = collection(this.firestore, `stations/${this.myStation.id}/orders`);
        const ordersSub = collectionData(ordersRef, { idField: 'id' }).subscribe(async (orders: any[]) => {
          // ✅ Rebuild timeline for each order
          this.myOrdersList = (orders || []).map((order: any) => {
            const rawMode =
              (order && (order as any)['mode']) ||
              (order?.items && (order.items[0] as any)?.mode) ||
              'delivery';
            const mode = rawMode.toString().toLowerCase().replace(/\s+/g, '');
            const flow =
              mode === 'pickup'
                ? ['Pending', 'Order Confirmed', 'Preparing', 'Ready for Pickup', 'Picked Up']
                : ['Pending', 'Order Confirmed', 'Preparing', 'Out for Delivery', 'Delivered'];

            return {
              ...order,
              statusHistory: flow.map((status) => ({
                status,
                changedAt:
                  order.statusHistory?.find((s: any) => s.status === status)?.changedAt ||
                  new Date(),
              })),
            };
          }) as Order[];

          const activeOrders = this.myOrdersList.filter(
            (o) => !['Delivered', 'Cancelled'].includes(o.status)
          );

          this.newOrdersBadge = activeOrders.length;
          this.newOrdersCount = activeOrders.filter((o) => o.status === 'Pending').length;
          this.preparingCount = activeOrders.filter((o) => o.status === 'Preparing').length;
          this.inTransitCount = activeOrders.filter((o) => o.status === 'Out for Delivery').length;
          this.completedCount = this.myOrdersList.filter(
            (o) => o.status === 'Delivered' || o.archived
          ).length;

          // 🔔 Toast when new orders appear
          if (activeOrders.length > this.lastActiveOrderCount && !this.hasShownToast) {
            const toast = await this.toastCtrl.create({
              message: `📦 New order received (${activeOrders.length})`,
              duration: 2000,
              color: 'primary',
            });
            await toast.present();
            this.hasShownToast = true;
          }

          if (activeOrders.length === 0) this.hasShownToast = false;
          this.lastActiveOrderCount = activeOrders.length;
        });
        this.firestoreSubs.push(ordersSub);


        // ─────────────────────────────
        // 🧩 Archived Orders Listener
        // ─────────────────────────────
        const archivedRef = collection(this.firestore, `stations/${this.myStation.id}/archivedOrders`);
        const archivedSub = collectionData(archivedRef, { idField: 'id' }).subscribe((archived: any[]) => {
          const archivedOrders = (archived || []).map((order: any) => {
            const rawMode =
              (order && (order as any)['mode']) ||
              (order?.items && (order.items[0] as any)?.mode) ||
              'delivery';
            const mode = rawMode.toString().toLowerCase().replace(/\s+/g, '');
            const flow =
              mode === 'pickup'
                ? ['Pending', 'Order Confirmed', 'Preparing', 'Ready for Pickup', 'Picked Up']
                : ['Pending', 'Order Confirmed', 'Preparing', 'Out for Delivery', 'Delivered'];

            return {
              ...order,
              archived: true,
              statusHistory: flow.map((status) => ({
                status,
                changedAt:
                  order.statusHistory?.find((s: any) => s.status === status)?.changedAt ||
                  new Date(),
              })),
            };
          }) as Order[];

          const totalArchived = archivedOrders.length;
          this.completedCount = totalArchived;

          this.myOrdersList = [
            ...this.myOrdersList.filter((o) => !o.archived),
            ...archivedOrders,
          ];

          console.log(`📁 Archived Orders Loaded: ${totalArchived}`);
        });
        this.firestoreSubs.push(archivedSub);

        // Couriers
        const couriersRef = collection(this.firestore, `stations/${this.myStation.id}/couriers`);
        const couriersSub = collectionData(couriersRef, { idField: 'id' }).subscribe((couriers: any[]) => {
          this.myCouriers = (couriers || []) as Courier[];
        });
        this.firestoreSubs.push(couriersSub);

// 🟢 Real-time Ratings Listener (live updates on manager dashboard)
if (this.myStation?.id) {
  const ratingsRef = collection(this.firestore, `stations/${this.myStation.id}/ratings`);
  const ratingsUnsub = onSnapshot(ratingsRef, (snap) => {
    // 🔹 Filter out invalid or unrated entries
    const ratings = snap.docs
      .map(d => d.data() as any)
      .filter(r => typeof r.ratingStation === 'number' && r.ratingStation > 0);

    if (ratings.length > 0) {
      const total = ratings.reduce((sum, r) => sum + r.ratingStation, 0);
      const avg = total / ratings.length;

      // 🔹 Update local dashboard values only if valid ratings exist
      (this.myStation as any)['avgRating'] = Number(avg.toFixed(2));
      this.efficiencyScore = Math.round(avg * 20);
    } else {
      (this.myStation as any)['avgRating'] = 0;
      this.efficiencyScore = 0;
    }
  });
  this.firestoreSubs.push({ unsubscribe: ratingsUnsub });
}

// ✅ Load actual vehicle list from Firestore station doc
if (this.myStation?.id) {
  const sRef = doc(this.firestore, `stations/${this.myStation.id}`);
  const snap = await getDoc(sRef);
  if (snap.exists()) {
    const data = snap.data() as any;
    // vehicleTypes can be stored as array or map; normalize it
    if (Array.isArray(data.vehicleTypes)) {
      this.vehicleOptions = data.vehicleTypes;
    } else if (data.vehicles && Array.isArray(data.vehicles)) {
      this.vehicleOptions = data.vehicles;
    } else if (typeof data.vehicleTypes === 'object') {
      this.vehicleOptions = Object.keys(data.vehicleTypes).filter(k => data.vehicleTypes[k]);
    } else {
      this.vehicleOptions = [];
    }
  }
}
      } else {
        this.setEmptyStreams();
      }

      // 🧩 Auto-repair user orders (Delivered → History)
      await this.autoRepairUserOrders();
    });

    this.subs.push(stationsSub);
  });

  this.subs.push(userSub);

  // Market tab: load all stations
  const stationsRef = collection(this.firestore, 'stations');
  const allStationsSub = collectionData(stationsRef, { idField: 'id' }).subscribe((all: any[]) => {
    this.otherStations = (all || []) as Station[];
  });
  this.subs.push(allStationsSub);
}


ngAfterViewInit() {
  // 🔄 Listen to city-wide sync
  this.realtime.snap$.subscribe((snapshots) => {
    snapshots.forEach((s) => {
      s.couriers.forEach((c) => {
        if (c.lat && c.lng) {
          // Light ghost marker for other stations' couriers
          L.circleMarker([c.lat, c.lng], {
            radius: 5,
            color: c.stationId === this.myStation?.id ? '#2F80ED' : '#99c3ff',
            opacity: c.stationId === this.myStation?.id ? 1 : 0.4,
          }).addTo(this.map!);
        }
      });
    });
  });
}

// ─────────────────────────────────────────────
// 🔁 Sync Notification Badge on Page Enter
// ─────────────────────────────────────────────
ionViewWillEnter() {
  if (this.managerId) {
    const notifRef = collection(this.firestore, `users/${this.managerId}/notifications`);
    const qUnread = query(notifRef, where('read', '==', false));

    // Temporary snapshot to update badge without opening notifications page
    onSnapshot(qUnread, (snap) => {
      this.unreadNotifCount = snap.size || 0;
    });
  }
}

ionViewDidEnter() {
  // 🔹 When re-entering Manager page
  setTimeout(() => {
    if (!this.map && this.myStation?.lat && this.myStation?.lng) {
      this.initMap([this.myStation.lat, this.myStation.lng]);
    } else if (this.map) {
      this.map.invalidateSize();
      (this.map as any)._onResize?.();
    }
  }, 300);
}

ionViewDidLeave() {
  // Only remove if the whole Manager page is exited (not tab switch)
  if (this.router.url !== '/manager' && this.map) {
    this.map.remove();
    this.map = undefined as any;
  }
}

onTabChange(tab: string) {
  if (!this.isStationApproved && tab !== 'dashboard') {
    this.selectedTab = 'dashboard';
    return;
  }

  this.selectedTab = tab;

  if (tab === 'dashboard') {
    // Delay a bit to let the view settle before resizing
    setTimeout(() => {
      if (this.map) {
        this.map.invalidateSize();
        (this.map as any)._onResize?.();
      }
    }, 300);
  }
}

ngOnDestroy(): void {
  // 🔹 Stop any order-specific snapshot listener
  this.teardownOrdersListener();

  // 🔹 Cleanup regular Angular/RxJS subscriptions
  this.subs.forEach((s) => s.unsubscribe?.());
  this.subs = [];

  // 🔹 Cleanup Firestore real-time listeners
  this.firestoreSubs.forEach((s) => s.unsubscribe?.());
  this.firestoreSubs = [];

  // 🔹 Stop notification badge listener
  if (this.notifUnsub) this.notifUnsub();

  // 🔹 Stop dashboard sync listener
if (this.unsubDashboard) this.unsubDashboard();
}



private setEmptyStreams(): void {
  this.myProducts$ = new Observable<Product[]>((obs) => {
    obs.next([]);
    obs.complete();
  });
  this.myOrders$ = new Observable<Order[]>((obs) => {
    obs.next([]);
    obs.complete();
  });
  this.myOrdersList = [];
  this.computeDashboardCounts();
  this.newOrdersBadge = 0; // reset badge
}


// ───────────────────────────────────────────────────────────
// Dashboard
// ───────────────────────────────────────────────────────────
async computeDashboardCounts(): Promise<void> {
  const orders = this.myOrdersList || [];
  this.newOrdersCount = orders.filter((o) => o.status === 'New' || o.status === 'Pending').length;
  this.preparingCount = orders.filter((o) => o.status === 'Preparing').length;
  this.inTransitCount = orders.filter((o) => o.status === 'Out for Delivery').length;
  this.completedCount = orders.filter(
    (o) => o.status === 'Delivered' || o.archived === true
  ).length;

  // 🔹 Pull average rating directly from Firestore subcollection: stations/{id}/ratings
  if (this.myStation?.id) {
    try {
      const ratingsRef = collection(this.firestore, `stations/${this.myStation.id}/ratings`);
      const ratingsSnap = await getDocs(ratingsRef);
      const ratings = ratingsSnap.docs.map((d) => d.data() as any);

      if (ratings.length > 0) {
        const total = ratings.reduce((sum, r) => sum + (r.value || 0), 0);
        const avg = total / ratings.length;
        // convert 1–5 stars → percentage (so 4.5★ = 90%)
        this.efficiencyScore = Math.round(avg * 20);
      } else {
        this.efficiencyScore = 0;
      }
    } catch (err) {
      console.warn('⚠️ Failed to fetch ratings:', err);
      this.efficiencyScore = 0;
    }
  } else {
    this.efficiencyScore = 0;
  }
}


// ─────────────────────────────────────────────
// 📊 Live Manager Dashboard Sync (Completed Orders, Earnings, Avg Rating)
// ─────────────────────────────────────────────
private unsubDashboard?: () => void;

private initDashboardSync(): void {
  if (!this.myStation?.id) return;

  const archivedRef = collection(this.firestore, `stations/${this.myStation.id}/archivedOrders`);

  this.unsubDashboard = onSnapshot(archivedRef, async (snap) => {
    const data = snap.docs.map(d => d.data());
    const completedCount = data.length;
    const totalEarnings = data.reduce((sum, o: any) => sum + (o?.charges?.total || o?.totalAmount || 0), 0);

    this.completedCount = completedCount;
    this.efficiencyScore = Math.round((completedCount / (completedCount + (this.newOrdersCount || 1))) * 100);
    (this as any).totalEarnings = totalEarnings;

    // 🔹 Update avgRating live
    if (this.myStation?.id) {
      const ratingsRef = collection(this.firestore, `stations/${this.myStation.id}/ratings`);
      const ratingSnap = await getDocs(ratingsRef);
      const ratings = ratingSnap.docs.map(d => d.data() as any);
      const avg = ratings.length ? ratings.reduce((a, b) => a + (b.ratingStation || b.rating || 0), 0) / ratings.length : 0;
      (this.myStation as any)['avgRating'] = Number(avg.toFixed(2));
    }

    console.log(`📊 Dashboard Sync → Completed: ${completedCount}, Earnings: ₱${totalEarnings}`);
  });
}

// ───────────────────────────────────────────────────────────
// Station Info (clean + safe + rating-ready)
// ───────────────────────────────────────────────────────────
get stationInfo() {
  if (!this.myStation) return null;
  const s: any = this.myStation;

  // 🧹 Clean full address (no empty parts or extra commas)
  const parts = [s['address'], s['barangay'], s['city'], s['zipCode']].filter(
    (p) => p && p.trim() !== ''
  );
  const fullAddress = parts.join(', ');

  // 💧 Water Types Display
  let waterTypes = '—';
  if (s['availableTypes']) {
    const available = Object.entries(s['availableTypes'])
      .filter(([_, val]) => val)
      .map(([key]) => key);
    if (available.length) waterTypes = available.join(', ');
  } else if (s['types']) {
    waterTypes = Array.isArray(s['types']) ? s['types'].join(', ') : s['types'];
  }

  return {
    Station_Name: s['stationName'] || '—',
    Owner_Name: s['ownerName'] || '—',
    Contact_Email: s['contactEmail'] || s['ownerEmail'] || '—',
    Phone: s['phone'] || '—',
    Full_Address: fullAddress,
    Station_Types: Array.isArray(s['types']) ? s['types'].join(', ') : '—',
    Water_Types: waterTypes,
    Operating_Hours: s['operatingHours']
      ? `${s['operatingHours'].open} - ${s['operatingHours'].close}`
      : 'Not set',
  };
}


private listenForNewOrders(): void {
  if (!this.myStation?.id) return;

  // Restore previous cache
  const saved = localStorage.getItem(this.STORAGE_KEY);
  if (saved) {
    try {
      this.lastSeenOrders = new Set(JSON.parse(saved));
    } catch {
      this.lastSeenOrders.clear();
    }
  }

  const ordersRef = collection(this.firestore, `stations/${this.myStation.id}/orders`);
  const unsubOrders = onSnapshot(ordersRef, (snapshot) => {
    let newOrderCount = 0;

    snapshot.docChanges().forEach((change) => {
      const order = { id: change.doc.id, ...change.doc.data() } as any;

      // 🟢 Handle Added Orders
      if (change.type === 'added' && !this.lastSeenOrders.has(order.id)) {
        if (order.status === 'Pending' || order.status === 'New') {
          this.lastSeenOrders.add(order.id);
          newOrderCount++;
          this.showToast(`🆕 New Order #${order.id} received!`, 'success');
        }
      }

      // 🟣 Handle Delivered/Archived — remove from cache
      if (order.status === 'Delivered' || order.archived) {
        this.lastSeenOrders.delete(order.id);
      }
    });

    // Save cache to localStorage (after each update)
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify([...this.lastSeenOrders]));

    // 🔢 Badge Update
    this.newOrdersBadge = newOrderCount;
  });

  this.subs.push({ unsubscribe: unsubOrders } as any);
}


  private teardownOrdersListener(): void {
    if (this.unsubscribeOrdersListener) {
      this.unsubscribeOrdersListener();
      this.unsubscribeOrdersListener = undefined;
    }
  }

  /** Call this from Orders button click to clear the badge */
public async onOpenOrders(): Promise<void> {
  if (this.shouldBlockManagerActions) {
    await this.showToast('⚠️ Station not approved yet.', 'warning');
    return;
  }

  this.resetNewOrdersBadge();
  this.router.navigate(['/manager-orders']).catch(() => {});
}

  resetNewOrdersBadge(): void {
    this.newOrdersBadge = 0;
  }

// ───────────────────────────────────────────────────────────
// Orders (with Courier Assignment) + Push to Customer + Auto-Archive (with Metadata + Global + User Mirror)
// ───────────────────────────────────────────────────────────
async updateOrderStatus(
  
  orderId: string | undefined,
  nextStatus: 'Preparing' | 'Out for Delivery' | 'Delivered'
): Promise<void> {
if (this.shouldBlockManagerActions) {
  await this.showToast('⚠️ Station not approved yet.', 'warning');
  return;
}

  if (!this.myStation?.id || !orderId) return;
  const stationId = this.myStation.id;

  // 🔹 Fetch order data first
  const orderRef = doc(this.firestore, `stations/${stationId}/orders/${orderId}`);
  const snap = await getDoc(orderRef);
  if (!snap.exists()) return;
  const orderData = snap.data() as Order;
  const currentStatus: string = orderData['status'] || 'New';

  // 🚦 Enforce valid transitions
  if (this.validTransitions[currentStatus] !== nextStatus) {
    await this.showToast(`⚠️ Can't move ${currentStatus} → ${nextStatus}`, 'warning');
    return;
  }

  // 🚚 Require courier before Out for Delivery
  if (nextStatus === 'Out for Delivery' && !orderData?.['courier']) {
    await this.showToast('⚠️ Assign a courier before marking as Out for Delivery', 'warning');
    return;
  }

  // 🧭 Normalize mode and determine correct flow (same as Track-Order page)
  const rawMode =
    ((orderData as any)?.mode) ||
    ((orderData?.items?.[0] as any)?.mode) ||
    'delivery';

  const mode = rawMode.toString().toLowerCase().replace(/\s+/g, '');
  const flow =
    mode === 'pickup'
      ? ['Pending', 'Order Confirmed', 'Preparing', 'Ready for Pickup', 'Picked Up']
      : ['Pending', 'Order Confirmed', 'Preparing', 'Out for Delivery', 'Delivered'];

  // ✅ Unified sync to Firestore (station + global)
  await this.orderSync.updateOrderStatus(orderId, stationId, nextStatus, 'manager');

  // 🔁 Ensure timeline is aligned with defined flow
  await updateDoc(orderRef, {
    statusHistory: arrayUnion({
      status: nextStatus,
      changedAt: serverTimestamp(),
      by: 'Manager',
    }),
    validFlow: flow, // optional audit record
  });

  // 🔔 Mirror to user order (for customer view)
  try {
    await this.mirrorToUserOrders(orderData, nextStatus);
  } catch (err) {
    console.warn('⚠️ Failed to mirror user order:', err);
  }

  // 🟢 Auto-stock deduction when Delivered
  if (nextStatus === 'Delivered' && Array.isArray(orderData?.['items'])) {
    for (const item of orderData['items']) {
      const productRef = doc(this.firestore, `stations/${stationId}/products/${item.productId}`);
      const productSnap = await getDoc(productRef);
      if (productSnap.exists()) {
        const currentStock = (productSnap.data() as any)['stock'] ?? 0;
        const newStock = Math.max(currentStock - (item.quantity || 1), 0);
        await updateDoc(productRef, { stock: newStock, inStock: newStock > 0 });
      }
    }
  }

  // 🔔 Notify User (via NotificationService)
  if (orderData?.['userId']) {
    await this.notificationService.notifyUserOrderUpdateFromManager(
      orderData['userId'],
      orderId,
      nextStatus,
      this.myStation?.['stationName']
    );
  }

  // 🔔 Notify Manager (self-log)
  if (this.managerId) {
    await this.notificationService.addManagerNotification(this.managerId, {
      type: 'system',
      message: `Order #${orderId} updated to ${nextStatus}.`,
      read: false,
    });
  }

  // 🗂 Auto-archive when Delivered
  if (nextStatus === 'Delivered') {
    const snapshot = await getDoc(orderRef);
    if (snapshot.exists()) {
      const orderInfo = snapshot.data();
      const archivedRef = doc(this.firestore, `stations/${stationId}/archivedOrders/${orderId}`);
      await setDoc(
        archivedRef,
        {
          ...orderInfo,
          archived: true,
          completedAt: serverTimestamp(),
          archivedBy: this.displayName || 'Manager',
          deliveredBy: (orderInfo as any)['courier']?.name || 'Unknown Courier',
          stationId,
          totalAmount: (orderInfo as any)['charges']?.total ?? 0,
        },
        { merge: true }
      );

      // 🧹 Delete from active orders after short delay
      setTimeout(async () => {
        try {
          await deleteDoc(orderRef);
          console.log(`🗑️ Station order ${orderId} deleted after archive.`);
        } catch (e) {
          console.warn('⚠️ Failed to delete delivered orderRef:', e);
        }
      }, 6000);
    }
  }

  await this.showToast(`✅ Order set to ${nextStatus}`, 'success');
}


// ───────────────────────────────────────────────────────────
// Assign Courier to Order (Full Cross-Role Notifications + Auto-Status Sync)
// ───────────────────────────────────────────────────────────
async assignCourier(order: Order, courier?: Courier): Promise<void> {
  if (this.shouldBlockManagerActions) {
  await this.showToast('⚠️ Station not approved yet.', 'warning');
  return;
}
  if (!this.myStation?.id || !order?.id) return;

  const stationId = this.myStation.id;
  const orderRef = doc(this.firestore, `stations/${stationId}/orders/${order.id}`);

  // ──────────────── CASE 1: Courier already provided ────────────────
  if (courier?.id) {
    // ✅ Update Firestore order (add courier info + status)
    await updateDoc(orderRef, {
      couriers: arrayUnion({
        id: courier.id,
        name: courier.name,
        vehicle: courier.vehicle,
        eta: courier.eta || null,
        assignedAt: new Date(),
      }),
      assignedCourierId: courier.id,
      courier: {
        id: courier.id,
        name: courier.name,
        vehicle: courier.vehicle,
        eta: courier.eta || null,
        assignedAt: new Date(),
      } as CourierRef,
      courierId: courier.id,
      status: 'Courier Assigned',
      statusHistory: arrayUnion({
        status: 'Courier Assigned',
        changedAt: serverTimestamp(),
        by: this.displayName || 'Manager',
        note: `Assigned ${courier.name}`,
      }),
    });

    // 🔔 Notify the courier (Firestore + Push)
    await this.notificationService.sendCourierAssignment(courier.id, order.id);

    // 🔔 Notify the user (customer) about the assignment + auto-status sync
    if (order.userId) {
      await this.notificationService.notifyUserOrderStatus(
        order.userId,
        order.id,
        'Courier Assigned',
        this.myStation?.stationName
      );

      // ✅ Mirror the new status to user's order document
      const userOrderRef = doc(this.firestore, `users/${order.userId}/orders/${order.id}`);
      await updateDoc(userOrderRef, {
        status: 'Courier Assigned',
        lastUpdatedAt: serverTimestamp(),
        statusHistory: arrayUnion({
          status: 'Courier Assigned',
          changedAt: serverTimestamp(),
          by: this.displayName || 'Manager',
        }),
      });
    }

    // 🔔 Manager self-log
    if (this.managerId) {
      await this.notificationService.addManagerNotification(this.managerId, {
        type: 'assignment',
        message: `Assigned ${courier.name} to order #${order.id}`,
        relatedId: order.id,
        read: false,
      });
    }

    // 🔔 Update courier doc
    const courierRef = doc(this.firestore, `stations/${stationId}/couriers/${courier.id}`);
    await updateDoc(courierRef, {
      lastAssignedOrder: order.id,
      updatedAt: serverTimestamp(),
    });

    await this.showToast(`✅ Assigned ${courier.name} to order ${order.id}`, 'success');
    return;
  }

  // ──────────────── CASE 2: No courier passed → show multi-picker ────────────────
  const couriersRef = collection(this.firestore, `stations/${stationId}/couriers`);
  const snapshot = await getDocs(couriersRef);
  const couriers = snapshot.docs.map((d: any) => ({ id: d.id, ...d.data() }));

  if (!couriers.length) {
    await this.showToast('⚠️ No couriers available. Add one first.', 'warning');
    return;
  }

  const alert = await this.alertCtrl.create({
    header: 'Assign Courier(s)',
    message: 'Select one or more couriers for this delivery.',
    inputs: couriers.map((c: any) => ({
      type: 'checkbox',
      label: `${c.name} (${c.vehicle})`,
      value: c,
    })),
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Assign',
        handler: async (selectedCouriers: any[]) => {
          if (!selectedCouriers?.length) {
            await this.showToast('⚠️ Please select at least one courier.', 'warning');
            return;
          }

          for (const c of selectedCouriers) {
            await this.assignCourier(order, c);
          }
        },
      },
    ],
  });
  await alert.present();
}



public async promptNewCourierAndAssign(order: Order | null): Promise<void> {
  if (this.shouldBlockManagerActions) {
  await this.showToast('⚠️ Station not approved yet.', 'warning');
  return;
}

  try {
    // 🟦 If called with an order (assign flow)
    if (order) {
      await this.assignCourier(order);
      return;
    }

    // 🟥 Must have a station
    const stationId = this.myStation?.id;
    if (!stationId) return;

    // 🟨 STEP 1: Ask for Gmail only (no name field)
    const emailAlert = await this.alertCtrl.create({
      header: 'New Courier',
      message: 'Enter courier Gmail.',
      inputs: [
        { name: 'email', type: 'email', placeholder: 'Courier Gmail (must end with @gmail.com)' },
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Next',
          role: 'confirm',
          handler: async (data: any): Promise<boolean> => {
            try {
              const email: string = (data?.email || '').trim().toLowerCase();
              const gmailPattern = /^[a-zA-Z0-9._%+-]+@gmail\.com$/;

              if (!email || !gmailPattern.test(email)) {
                await this.showToast('⚠️ Enter a valid Gmail (e.g. user@gmail.com).', 'warning');
                return false; // keep alert open
              }

              // 🚫 Prevent duplicate couriers (global)
              const globalCouriersRef = collection(this.firestore, 'couriers');
              const dupQ = query(globalCouriersRef, where('email', '==', email));
              const dupSnap = await getDocs(dupQ);
              if (!dupSnap.empty) {
                await this.showToast('⚠️ Gmail already assigned to another courier.', 'warning');
                return false;
              }

              // 🚫 Prevent adding self
              const me = this.auth.currentUser;
              if (me?.email?.toLowerCase() === email) {
                await this.showToast('⚠️ You cannot assign your own Gmail.', 'warning');
                return false;
              }

              // 🔎 Lookup user in Firestore
              const usersRef = collection(this.firestore, 'users');
              const uQ = query(usersRef, where('email', '==', email));
              const uSnap = await getDocs(uQ);

              if (uSnap.empty) {
                await this.showToast(`⚠️ No registered user found for ${email}`, 'warning');
                return false; // keep alert open
              }

              const uDoc = uSnap.docs[0];
              const courierUid = uDoc.id;
              const uData = uDoc.data() as any;

              // ✅ Preferred display name from Firestore
              let displayName: string =
                (uData?.displayName || uData?.name || '').toString().trim();

              if (!displayName) {
                const local = email.split('@')[0];
                const cleaned = local.replace(/[0-9]/g, '');
                const spaced = cleaned.replace(/[._]+/g, ' ');
                const words = spaced
                  .split(/[\s]+/)
                  .filter(Boolean)
                  .map(w => w.charAt(0).toUpperCase() + w.slice(1));
                if (words.length === 1) {
                  const one = words[0];
                  const mid = Math.floor(one.length / 2);
                  if (one.length >= 6) {
                    displayName = `${one.slice(0, mid)} ${one.slice(mid)}`;
                  } else {
                    displayName = one;
                  }
                } else {
                  displayName = words.join(' ');
                }
              }

              // ✅ STEP 2: Confirm the detected name (no typing needed)
              const confirmAlert = await this.alertCtrl.create({
                header: 'Confirm Courier',
                message: `Gmail: ${email}\nName: ${displayName}`,
                buttons: [
                  { text: 'Back', role: 'cancel' },
                  {
                    text: 'Continue',
                    role: 'confirm',
                    handler: async () => {
                      // ✅ Fetch vehicle options from station
                      const sRef = doc(this.firestore, `stations/${stationId}`);
                      const sSnap = await getDoc(sRef);
                      let vehicleOptions: string[] = [];
                      if (sSnap.exists()) {
                        const sData = sSnap.data() as any;
                        if (Array.isArray(sData.vehicleTypes)) vehicleOptions = sData.vehicleTypes;
                        else if (Array.isArray(sData.vehicles)) vehicleOptions = sData.vehicles;
                        else if (sData?.vehicleTypes && typeof sData.vehicleTypes === 'object') {
                          vehicleOptions = Object.keys(sData.vehicleTypes).filter(k => sData.vehicleTypes[k]);
                        }
                      }
                      if (vehicleOptions.length === 0) vehicleOptions = ['Motorbike', 'Tricycle', 'Van'];

                      // STEP 3: Vehicle selection (finalize add)
                      const vehicleAlert = await this.alertCtrl.create({
                        header: 'Select Vehicle Type',
                        inputs: vehicleOptions.map(v => ({ type: 'radio', label: v, value: v })),
                        buttons: [
                          { text: 'Cancel', role: 'cancel' },
                          {
                            text: 'Save',
                            handler: async (vehicle: string) => {
                              // 🔐 Add to station couriers
                              const stationCouriers = collection(this.firestore, `stations/${stationId}/couriers`);
                              await setDoc(doc(stationCouriers, courierUid), {
                                name: displayName,
                                email,
                                uid: courierUid,
                                vehicle,
                                active: true,
                                createdAt: new Date(),
                              });

                              // 🔁 Mirror globally
                              await setDoc(doc(this.firestore, `couriers/${courierUid}`), {
                                stationId,
                                stationName: this.myStation?.stationName || null,
                                name: displayName,
                                email,
                                vehicle,
                                uid: courierUid,
                                active: true,
                                createdAt: new Date(),
                              });

                              // 🔁 Update user role → courier
                              await setDoc(doc(this.firestore, `users/${courierUid}`), { role: 'courier' }, { merge: true });

                              await this.showToast(`✅ Courier ${displayName} added`, 'success');
                            },
                          },
                        ],
                      });
                      await vehicleAlert.present();
                    },
                  },
                ],
              });
              await confirmAlert.present();

              return true; // close Gmail alert after passing checks
            } catch (err) {
              console.error('❌ New Courier flow error:', err);
              await this.showToast('⚠️ Something went wrong.', 'danger');
              return false;
            }
          },
        },
      ],
    });

    await emailAlert.present();
  } catch (err) {
    console.error('❌ promptNewCourierAndAssign failed:', err);
    await this.showToast('⚠️ Unexpected error creating courier.', 'danger');
  }
}

  public chipColor(status: string): string {
    if (!status) return 'medium';
    const s = status.toLowerCase();
    if (s.includes('new') || s.includes('pending')) return 'warning';
    if (s.includes('prepar')) return 'secondary';
    if (s.includes('out for delivery')) return 'tertiary';
    if (s.includes('delivered')) return 'success';
    return 'medium';
  }

  async toggleCourierActive(courier: Courier): Promise<void> {
    if (this.shouldBlockManagerActions) {
  await this.showToast('⚠️ Station not approved yet.', 'warning');
  return;
}
    if (!this.myStation?.id || !courier?.id) return;

    const newStatus = !courier.active;
    const ref = doc(this.firestore, `stations/${this.myStation.id}/couriers/${courier.id}`);
    await updateDoc(ref, { active: newStatus });

    await this.showToast(`🚚 Courier marked as ${newStatus ? 'active' : 'inactive'}`, 'success');
  }

  async deleteCourier(courier: Courier): Promise<void> {
    if (this.shouldBlockManagerActions) {
  await this.showToast('⚠️ Station not approved yet.', 'warning');
  return;
}
    if (!this.myStation || !this.myStation.id || !courier?.id) {
      await this.showToast('⚠️ Missing station or courier info', 'warning');
      return;
    }

    const confirm = await this.alertCtrl.create({
      header: 'Delete Courier',
      message: `Are you sure you want to permanently remove ${courier.name}?`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: async () => {
            try {
              // 🔽 Delete from station couriers
              await deleteDoc(doc(this.firestore, `stations/${this.myStation!.id}/couriers/${courier.id}`));

              // 🔽 Delete from global couriers collection
              await deleteDoc(doc(this.firestore, `couriers/${courier.id}`));

              // 🔽 Reset user role back to "user"
              const userRef = doc(this.firestore, `users/${courier.id}`);
              await setDoc(userRef, { role: 'user' }, { merge: true });

              await this.showToast(
                `🗑 Courier ${courier.name} permanently deleted`,
                'success'
              );
            } catch (err) {
              console.error('Delete courier failed:', err);
              await this.showToast('⚠️ Failed to delete courier', 'danger');
            }
          },
        },
      ],
    });

    await confirm.present();
  }


async editCourier(courier: Courier): Promise<void> {
  if (this.shouldBlockManagerActions) {
  await this.showToast('⚠️ Station not approved yet.', 'warning');
  return;
}
  if (!this.myStation?.id || !courier?.id) return;
  const stationId = this.myStation.id;

  // ensure latest vehicles
  const sRef = doc(this.firestore, `stations/${stationId}`);
  const sSnap = await getDoc(sRef);
  if (sSnap.exists()) {
    const data = sSnap.data() as any;
    if (Array.isArray(data.vehicleTypes)) this.vehicleOptions = data.vehicleTypes;
    else if (Array.isArray(data.vehicles)) this.vehicleOptions = data.vehicles;
  }

  const alert = await this.alertCtrl.create({
    header: 'Edit Courier Info',
    inputs: [
      { name: 'name', type: 'text', value: courier.name, placeholder: 'Courier Name' },
    ],
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Next',
        handler: async (data: any) => {
          const select = await this.alertCtrl.create({
            header: 'Select Vehicle',
            inputs: this.vehicleOptions.map(v => ({
              type: 'radio',
              label: v,
              value: v,
              checked: v === courier.vehicle,
            })),
            buttons: [
              { text: 'Cancel', role: 'cancel' },
              {
                text: 'Save',
                handler: async (selected: string) => {
                  const ref = doc(this.firestore, `stations/${stationId}/couriers/${courier.id}`);
                  await updateDoc(ref, {
                    name: data.name || courier.name,
                    vehicle: selected || courier.vehicle,
                    updatedAt: new Date(),
                  });
                  await this.showToast(`✅ Courier ${courier.name} updated`, 'success');
                },
              },
            ],
          });
          await select.present();
        },
      },
    ],
  });
  await alert.present();
}



async addProduct(): Promise<void> {
  if (this.shouldBlockManagerActions) {
  await this.showToast('⚠️ Station not approved yet.', 'warning');
  return;
}

  if (!this.myStation?.id) return;

  const alert = await this.alertCtrl.create({
    header: 'Add Product',
    inputs: [
      { name: 'name', placeholder: 'Product name', type: 'text' },
      { name: 'price', placeholder: 'Base price (₱)', type: 'number' },
      { name: 'description', placeholder: 'Short description', type: 'text' },
      { name: 'imageUrl', placeholder: 'Paste image URL or leave blank', type: 'url' },
    ],
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Add',
        handler: async (data: any) => {
          if (!data?.name || data?.price === undefined || data?.price === null) {
            await this.showToast('⚠️ Name and price are required', 'warning');
            return false; // 🚫 Keeps alert open
          }

          const imageUrl = data.imageUrl?.trim() || 'assets/placeholder.png';

          const productsRef = collection(this.firestore, `stations/${this.myStation!.id}/products`);
          await addDoc(productsRef, {
            name: data.name,
            basePrice: Number(data.price),
            description: data.description || '',
            imageUrl,
            inStock: true,
            createdAt: new Date(),
          } as Product);

          await this.showToast('✅ Product added', 'success');
          return true; // ✅ Close alert cleanly
        },
      },
    ],
  });

  await alert.present();
}

onImageError(event: any) {
  event.target.src = 'assets/water-placeholder.png';
}

async editProduct(product: Product): Promise<void> {
  if (this.shouldBlockManagerActions) {
  await this.showToast('⚠️ Station not approved yet.', 'warning');
  return;
}

  if (!this.myStation?.id || !product?.id) return;

  const alert = await this.alertCtrl.create({
    header: 'Edit Product',
    inputs: [
      { name: 'name', value: product.name, type: 'text', placeholder: 'Product Name' },
      { name: 'price', value: product.basePrice, type: 'number', placeholder: 'Base Price' },
      { name: 'description', value: product.description, type: 'text', placeholder: 'Description' },
      { name: 'imageUrl', value: product.imageUrl, type: 'url', placeholder: 'Image URL' },
    ],
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Save',
        handler: async (data: any) => {
          if (!data?.name || data?.price === undefined || data?.price === null) {
            await this.showToast('⚠️ Name and price are required', 'warning');
            return;
          }

          const ref = doc(this.firestore, `stations/${this.myStation!.id}/products/${product.id}`);
          await updateDoc(ref, {
            name: data?.name,
            basePrice: Number(data?.price),
            description: data?.description || '',
            imageUrl: data?.imageUrl || 'assets/placeholder.png',
            updatedAt: new Date(),
          });

          await this.showToast('✅ Product updated successfully', 'success');
        },
      },
    ],
  });

  await alert.present();
}

  async deleteProduct(productId: string): Promise<void> {
    if (this.shouldBlockManagerActions) {
  await this.showToast('⚠️ Station not approved yet.', 'warning');
  return;
}
    if (!this.myStation?.id) return;

    await deleteDoc(doc(this.firestore, `stations/${this.myStation.id}/products/${productId}`));
    await this.showToast('🗑️ Product deleted', 'warning');
  }

  

// ─────────────────────────────────────────────
// 🧩 Enhanced Edit Station Info (Unified 12h Format + Water Type Availability)
// ─────────────────────────────────────────────
async editStation(): Promise<void> {
  if (this.shouldBlockManagerActions) {
  await this.showToast('⚠️ Station not approved yet.', 'warning');
  return;
}
  const s = this.myStation;
  if (!s?.id) return;
  const stationRef = doc(this.firestore, `stations/${s.id}`);

  // 🔹 Generate full 12-hour format times (15-min increments, identical to Register Page)
  const times: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      const period = h < 12 ? 'AM' : 'PM';
      const hour = h % 12 === 0 ? 12 : h % 12;
      const hh = hour.toString().padStart(2, '0');
      const mm = m.toString().padStart(2, '0');
      times.push(`${hh}:${mm} ${period}`);
    }
  }

  // 🔹 Load current data
  const operatingHours = s['operatingHours'] || { open: '08:00 AM', close: '06:00 PM' };
  const availableTypes = s['availableTypes'] || {
    Purified: true,
    Alkaline: true,
    Mineral: true,
  };

  // ───────── Step 1 – Basic Info ─────────
  const alert = await this.alertCtrl.create({
    header: 'Edit Station Info',
    inputs: [
      { name: 'stationName', type: 'text', value: s.stationName, placeholder: 'Station Name' },
      { name: 'address', type: 'text', value: s.address, placeholder: 'Address' },
      { name: 'email', type: 'email', value: (s as any).email || s['ownerEmail'], placeholder: 'Email' },
      { name: 'phone', type: 'tel', value: s.phone, placeholder: 'Phone' },
    ],
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Next',
        handler: async (data: any) => {
          // ───────── Step 2 – Opening Hour ─────────
          const openAlert = await this.alertCtrl.create({
            header: 'Select Opening Time',
            inputs: times.map((t) => ({
              type: 'radio',
              label: t,
              value: t,
              checked: t === operatingHours.open,
            })),
            buttons: [
              { text: 'Cancel', role: 'cancel' },
              {
                text: 'Next',
                handler: async (selectedOpen: string) => {
                  // ───────── Step 3 – Closing Hour ─────────
                  const closeAlert = await this.alertCtrl.create({
                    header: 'Select Closing Time',
                    inputs: times.map((t) => ({
                      type: 'radio',
                      label: t,
                      value: t,
                      checked: t === operatingHours.close,
                    })),
                    buttons: [
                      { text: 'Back', role: 'cancel' },
                      {
                        text: 'Next',
                        handler: async (selectedClose: string) => {
                          // ───────── Step 4 – Available Water Types ─────────
                          const typeAlert = await this.alertCtrl.create({
                            header: 'Available Water Types',
                            message: 'Toggle which types are currently available.',
                            inputs: [
                              { type: 'checkbox', label: 'Purified', value: 'Purified', checked: availableTypes.Purified },
                              { type: 'checkbox', label: 'Alkaline', value: 'Alkaline', checked: availableTypes.Alkaline },
                              { type: 'checkbox', label: 'Mineral', value: 'Mineral', checked: availableTypes.Mineral },
                            ],
                            buttons: [
                              { text: 'Back', role: 'cancel' },
                              {
                                text: 'Save',
                                handler: async (selected: string[]) => {
                                  const updatedAvailable = {
                                    Purified: selected.includes('Purified'),
                                    Alkaline: selected.includes('Alkaline'),
                                    Mineral: selected.includes('Mineral'),
                                  };

                                  await updateDoc(stationRef, {
                                    stationName: data.stationName || s.stationName,
                                    address: data.address || s.address,
                                    email: data.email || s['email'] || s['ownerEmail'] || null,
                                    phone: data.phone || s.phone,
                                    operatingHours: {
                                      open: selectedOpen || operatingHours.open,
                                      close: selectedClose || operatingHours.close,
                                    },
                                    availableTypes: updatedAvailable,
                                    updatedAt: new Date(),
                                  });

                                  this.myStation = {
                                    ...this.myStation!,
                                    stationName: data.stationName,
                                    address: data.address,
                                    email: data.email,
                                    phone: data.phone,
                                    operatingHours: {
                                      open: selectedOpen,
                                      close: selectedClose,
                                    },
                                    availableTypes: updatedAvailable,
                                  } as any;

                                  await this.showToast('✅ Station info updated successfully', 'success');
                                },
                              },
                            ],
                          });
                          await typeAlert.present();
                        },
                      },
                    ],
                  });
                  await closeAlert.present();
                },
              },
            ],
          });
          await openAlert.present();
        },
      },
    ],
  });
  await alert.present();
}

  // ───────────────────────────────────────────────────────────
  // Nav / Header
  // ───────────────────────────────────────────────────────────
openNotifications(): void {
  this.router.navigate(['/manager-notifications']).catch(() => {});
}

  openSettings(): void {
    this.router.navigate(['/account']).catch(() => {});
  }

  openProfileFull(): void {
    this.router.navigate(['/manager-profile']).catch(() => {});
  }

  // ───────────────────────────────────────────────────────────
  // Auth
  // ───────────────────────────────────────────────────────────  
async logout(): Promise<void> {
  try {
    await this.userService.signOut();

    // 🧹 Clear all local manager data
    this.newOrdersBadge = 0;
    this.newOrdersCount = 0;
    this.preparingCount = 0;
    this.inTransitCount = 0;
    this.completedCount = 0;
    this.lastActiveOrderCount = 0;
    this.hasShownToast = false;
    this.myOrdersList = [];
    this.myCouriers = [];
    this.myStation = null;

    localStorage.removeItem(this.STORAGE_KEY);
    await this.router.navigate(['/home'], { replaceUrl: true });

    await this.showToast('✅ Logged out successfully', 'success');
  } catch (err) {
    console.error('Logout failed:', err);
    await this.showToast('⚠️ Logout failed', 'danger');
  }
}


  async confirmDeleteAccount(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Delete Account',
      message: 'Are you sure you want to permanently delete your account? This action cannot be undone.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Delete', role: 'destructive', handler: () => this.deleteAccount() },
      ],
    });
    await alert.present();
  }

  async deleteAccount(): Promise<void> {
    try {
      await this.userService.deleteAccount();
      this.router.navigate(['/home']);
    } catch (err) {
      console.error('Delete account failed:', err);
      await this.showToast('⚠️ Delete account failed', 'danger');
    }
  }


// ───────────────────────────────────────────────────────────
// Market
// ───────────────────────────────────────────────────────────
viewStation(stationId?: string): void {
  // Hook for future station preview/navigation
  console.log('viewStation', stationId);
}

// ───────────────────────────────────────────────
// 🔹 Map Layer Tracking (customers, routes, couriers)
// ───────────────────────────────────────────────

// Keep track of all active markers and lines
private customerMarkers: L.Marker[] = [];
private routeLines: L.Polyline[] = [];
private courierMarkers: Record<string, L.Marker> = {};

// ───────────────────────────────────────────────
// 🧹 Clear All Customer Layers (used when map refreshes)
// ───────────────────────────────────────────────
private clearCustomerLayers(): void {
  if (!this.map) return;

  this.customerMarkers.forEach(marker => this.map.removeLayer(marker));
  this.routeLines.forEach(line => this.map.removeLayer(line));

  this.customerMarkers = [];
  this.routeLines = [];
}

// ───────────────────────────────────────────────
// ❌ Remove Specific Order’s Marker + Route
// (used when order becomes Delivered or archived)
// ───────────────────────────────────────────────
private removeOrderLayers(orderId: string): void {
  if (!this.map) return;

  // Remove matching customer marker(s)
  this.customerMarkers = this.customerMarkers.filter(marker => {
    const keep = (marker as any).orderId !== orderId;
    if (!keep) this.map.removeLayer(marker);
    return keep;
  });

  // Remove matching route line(s)
  this.routeLines = this.routeLines.filter(line => {
    const keep = (line as any).orderId !== orderId;
    if (!keep) this.map.removeLayer(line);
    return keep;
  });
}


// ───────────────────────────────────────────────────────────
// Initialize Manager Map (Station + Orders + Live Couriers)
// ───────────────────────────────────────────────────────────
private async initMap(center: L.LatLngExpression = [17.6209, 121.7266]) {
  if (this.map) return;

  const tugueFix = { lat: 17.6209, lng: 121.7266 };
  const bounds = { minLat: 17.58, maxLat: 17.67, minLng: 121.68, maxLng: 121.79 };

  let lat = this.myStation?.lat ?? tugueFix.lat;
  let lng = this.myStation?.lng ?? tugueFix.lng;

  const invalid =
    !lat || !lng ||
    lat < bounds.minLat || lat > bounds.maxLat ||
    lng < bounds.minLng || lng > bounds.maxLng;

  if (invalid && this.myStation?.id) {
    lat = tugueFix.lat;
    lng = tugueFix.lng;
    await updateDoc(doc(this.firestore, `stations/${this.myStation.id}`), {
      lat,
      lng,
      lastLocationUpdate: new Date(),
    }).catch(() => {});
  }

  // 🗺️ Initialize map
  this.map = L.map('manager-map', { center: [lat, lng], zoom: 14 });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
  }).addTo(this.map);

  // 🏠 Station marker
  const stationMarker = L.marker([lat, lng], {
    icon: L.icon({
      iconUrl: 'assets/pins/station-icon.png',
      iconSize: [30, 40],
      iconAnchor: [15, 40],
    }),
  }).addTo(this.map);
  stationMarker.bindPopup(`<b>${this.myStation?.stationName || 'Station'}</b>`);
  stationMarker.setZIndexOffset(100);

  // 🚫 Prevent dragging outside Tuguegarao
  this.map.on('moveend', () => {
    const c = this.map.getCenter();
    const inBounds =
      c.lat > bounds.minLat && c.lat < bounds.maxLat &&
      c.lng > bounds.minLng && c.lng < bounds.maxLng;
    if (!inBounds) this.map.setView([tugueFix.lat, tugueFix.lng], 14);
  });

  // ────────────────────────────────────────────────
  // 📦 Orders listener — markers only (no routes)
  // ────────────────────────────────────────────────
  if (this.myStation?.id) {
    const ordersRef = collection(this.firestore, `stations/${this.myStation.id}/orders`);
    collectionData(ordersRef, { idField: 'id' }).subscribe((orders: any[]) => {
      // Remove existing customer markers
      this.customerMarkers.forEach(m => this.map?.removeLayer(m));
      this.customerMarkers = [];

      const activeOrders = orders.filter(
        (o: any) => !['Delivered', 'Cancelled'].includes(o.status)
      );

      activeOrders.forEach((order: any) => {
        const oLat = order?.delivery?.latLng?.lat;
        const oLng = order?.delivery?.latLng?.lng;
        if (!oLat || !oLng) return;

        const icon = L.icon({
          iconUrl: order?.userPhoto || 'assets/pins/customer-icon.png',
          iconSize: [32, 32],
          iconAnchor: [16, 32],
        });

        const m = L.marker([oLat, oLng], { icon }).addTo(this.map!);
        m.bindPopup(
          `<b>${order.delivery.fullName}</b><br>${order.delivery.address}<br><small>${order.status}</small>`
        );
        this.customerMarkers.push(m);
      });
    });
  }

  // ────────────────────────────────────────────────
  // 🚚 Live Couriers Tracker — global path (accurate)
  // ────────────────────────────────────────────────
  const couriersRef = collection(this.firestore, 'couriers');
  const unsub = onSnapshot(couriersRef, (snap) => {
    const seen = new Set<string>();

    snap.forEach((docSnap) => {
      const c = docSnap.data() as any;
      const id = docSnap.id;
      if (!c.lat || !c.lng) return;
      if (c.stationId !== this.myStation?.id) return;

      seen.add(id);

      const icon = L.icon({
        iconUrl: c.photoURL || 'assets/pins/courier-icon.png',
        iconSize: [40, 40],
        iconAnchor: [20, 40],
      });

      if (this.courierMarkers[id]) this.map.removeLayer(this.courierMarkers[id]);
      const marker = L.marker([c.lat, c.lng], { icon }).addTo(this.map);
      marker.bindPopup(
        `🚚 <b>${c.name}</b><br>${c.vehicle || ''}<br>${
          c.active ? '🟢 Active' : '🔴 Inactive'
        }`
      );
      marker.setZIndexOffset(500);
      this.courierMarkers[id] = marker;
    });

    // Cleanup removed couriers
    Object.keys(this.courierMarkers).forEach((id) => {
      if (!seen.has(id)) {
        this.map.removeLayer(this.courierMarkers[id]);
        delete this.courierMarkers[id];
      }
    });
  });

  this.subs.push({ unsubscribe: unsub } as any);

  setTimeout(() => this.map?.invalidateSize(), 500);
}

// ─────────────────────────────────────────────
// AUTO DAILY SUMMARY LOGGER
// ─────────────────────────────────────────────
private async logDailySummary() {
  try {
    if (!this.myStation?.id) return;

    const stationId = this.myStation.id;
    const today = new Date();
    const dateKey = today.toISOString().split('T')[0]; // YYYY-MM-DD

    const ordersRef = collection(this.firestore, `stations/${stationId}/orders`);
    const archivedRef = collection(this.firestore, `stations/${stationId}/archivedOrders`);
    const historyRef = collection(this.firestore, `stations/${stationId}/orderHistory`);

    const [ordersSnap, archivedSnap] = await Promise.all([
      getDocs(ordersRef),
      getDocs(archivedRef),
    ]);

    // Combine and filter all delivered/completed orders
    const allOrders = [...ordersSnap.docs, ...archivedSnap.docs]
      .map((d) => ({ id: d.id, ...(d.data() as any) }))
      .filter((o) => o.status === 'Delivered' || o.status === 'completed')
      .filter((o) => {
        const delivered = o?.deliveredAt?.seconds
          ? new Date(o.deliveredAt.seconds * 1000)
          : null;
        return (
          delivered &&
          delivered.getDate() === today.getDate() &&
          delivered.getMonth() === today.getMonth() &&
          delivered.getFullYear() === today.getFullYear()
        );
      });

    const totalDeliveries = allOrders.length;
    const totalEarnings = allOrders.reduce(
      (sum, o) => sum + (o?.charges?.total || o?.totalAmount || 0),
      0
    );

    const durations = allOrders
      .map((o) => {
        const start = o?.deliveryStartAt?.seconds || o?.createdAt?.seconds;
        const end = o?.deliveredAt?.seconds || o?.completedAt?.seconds;
        return start && end && end > start
          ? Math.round((end - start) / 60)
          : null;
      })
      .filter((x): x is number => x !== null && x < 600);

    const averageDuration =
      durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0;

    const logRef = doc(this.firestore, `stations/${stationId}/dailyLogs/${dateKey}`);
    await setDoc(
      logRef,
      {
        date: dateKey,
        totalDeliveries,
        totalEarnings,
        averageDuration,
        updatedAt: new Date(),
      },
      { merge: true } // ✅ merge ensures update, not overwrite
    );

    for (const order of allOrders) {
      const orderRef = doc(this.firestore, `stations/${stationId}/orderHistory/${order.id}`);
      await setDoc(
        orderRef,
        {
          ...order,
          archivedAt: new Date(),
        },
        { merge: true }
      );

      // ✅ Remove from active orders after copying
      const activeOrderRef = doc(this.firestore, `stations/${stationId}/orders/${order.id}`);
      await updateDoc(activeOrderRef, {
        archived: true,
        movedToHistory: true,
      });
      await deleteDoc(activeOrderRef);
    }

    console.log(
      `✅ Logged ${totalDeliveries} deliveries (${totalEarnings}₱) for ${dateKey}, updated log, and cleaned active orders.`
    );
  } catch (err) {
    console.error('❌ Failed to log daily summary:', err);
  }
}

// ─────────────────────────────────────────────
// STATION CLOSE → ARCHIVE FLOW
// ─────────────────────────────────────────────
private async closeStationForTheDay(): Promise<void> {
  const stationId = this.myStation?.id || (this as any).myStationId;
  if (!stationId) return;

  console.log('📦 Closing station and archiving daily log...');
  const delivered = await this.fetchDeliveredForToday(stationId);
  if (!delivered.length) {
    console.log('ℹ️ No delivered orders today — skipping archive.');
    return;
  }

  await this.appendToOrderHistory(stationId, delivered);
  await this.upsertDailyLog(stationId, delivered);
  await this.removeDeliveredFromActive(stationId, delivered);

  console.log(`✅ Archived ${delivered.length} orders for ${stationId}`);
}

// ─────────────────────────────────────────────
// Fetch delivered orders for today
// ─────────────────────────────────────────────
private async fetchDeliveredForToday(stationId: string) {
  // ✅ Pull from archivedOrders instead of active orders
  const coll = collection(this.firestore, `stations/${stationId}/archivedOrders`);
  const snap = await getDocs(coll);

  const today = new Date();
  const orders: any[] = [];

  snap.forEach((d) => {
    const data: any = d.data();
    const deliveredAt = data.deliveredAt?.toDate?.() || new Date(data.deliveredAt?.seconds * 1000 || 0);
    const completedAt = data.completedAt?.toDate?.() || new Date(data.completedAt?.seconds * 1000 || 0);
    const end = deliveredAt || completedAt;
    if (
      end &&
      end.getDate() === today.getDate() &&
      end.getMonth() === today.getMonth() &&
      end.getFullYear() === today.getFullYear()
    ) {
      orders.push({ id: d.id, ...data });
    }
  });

  console.log(`📬 Found ${orders.length} delivered (archived) orders for today.`);
  return orders;
}

// ─────────────────────────────────────────────
// Append delivered orders into orderHistory
// ─────────────────────────────────────────────
private async appendToOrderHistory(stationId: string, delivered: any[]) {
  for (const o of delivered) {
    const ref = doc(this.firestore, `stations/${stationId}/archivedOrders/${o.id}`);
    await setDoc(ref, o, { merge: true });
  }
  console.log(`🗂 Added ${delivered.length} orders into orderHistory`);
}

// ─────────────────────────────────────────────
// Upsert /stations/{stationId}/dailyLogs/{YYYY-MM-DD}
// ─────────────────────────────────────────────
private async upsertDailyLog(stationId: string, delivered: any[]) {
  const todayStr = new Date().toISOString().split('T')[0];
  const logRef = doc(this.firestore, `stations/${stationId}/dailyLogs/${todayStr}`);

  // 🟩 1️⃣ If no delivered orders were passed, pull from archivedOrders
  if (!delivered || !delivered.length) {
    console.log('🔄 No delivered array passed — checking archivedOrders instead...');
    const archivedColl = collection(this.firestore, `stations/${stationId}/archivedOrders`);
    const archivedSnap = await getDocs(archivedColl);

    const today = new Date();
    delivered = archivedSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((data: any) => {
        const ts =
          data.deliveredAt?.toDate?.() ||
          data.completedAt?.toDate?.() ||
          new Date(data.deliveredAt?.seconds * 1000 || data.completedAt?.seconds * 1000 || 0);

        return (
          ts &&
          ts.getDate() === today.getDate() &&
          ts.getMonth() === today.getMonth() &&
          ts.getFullYear() === today.getFullYear()
        );
      });

    console.log(`📦 Found ${delivered.length} archived orders for today's log.`);
  }

  // 🟩 2️⃣ Compute totals safely
  const totalDeliveries = delivered.length;
  const totalEarnings = delivered.reduce(
    (sum, o) => sum + (Number(o?.charges?.total) || Number(o?.totalAmount) || 0),
    0
  );

  // 🟩 3️⃣ Compute average duration (minutes between start & delivery)
  const durations = delivered
    .map((o: any) => {
      const start = o?.deliveryStartAt?.seconds || o?.createdAt?.seconds;
      const end = o?.deliveredAt?.seconds || o?.completedAt?.seconds;
      return start && end && end > start
        ? Math.round((end - start) / 60)
        : null;
    })
    .filter((x): x is number => x !== null && x < 600);

  const averageDuration =
    durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;

  // 🟩 4️⃣ Upsert the log
  await setDoc(
    logRef,
    {
      date: todayStr,
      totalDeliveries,
      totalEarnings,
      averageDuration,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );

  console.log(
    `✅ Daily log upserted: ${totalDeliveries} deliveries, ₱${totalEarnings}, avg ${averageDuration} mins`
  );
}

// ─────────────────────────────────────────────
// Cleanup — remove delivered from active /orders
// ─────────────────────────────────────────────
private async removeDeliveredFromActive(stationId: string, delivered: any[]) {
  for (const o of delivered) {
    const ref = doc(this.firestore, `stations/${stationId}/orders/${o.id}`);
    await deleteDoc(ref);
  }
  console.log(`🧹 Removed ${delivered.length} delivered orders from active list.`);
}

  // ───────────────────────────────────────────────────────────
  // UX helpers
  // ───────────────────────────────────────────────────────────
  private async showToast(message: string, color: 'success' | 'warning' | 'danger'): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2000,
      color,
    });
    await toast.present();
  }


// ─────────────────────────────────────────────
// 📡 Auto-locate manager via device GPS & sync station coords
// ─────────────────────────────────────────────
private async tryAutoLocate(): Promise<void> {
  try {
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 15000,
    });

    const { latitude, longitude, accuracy } = pos.coords;
    console.log('📍 Manager GPS fix:', latitude, longitude, '±', accuracy, 'm');

    // ✅ Tuguegarao bounds check
    if (latitude < 17.58 || latitude > 17.67 || longitude < 121.68 || longitude > 121.79) {
      console.warn('⚠️ GPS outside Tuguegarao bounds — ignored.');
      return;
    }

    // ✅ Update station Firestore coords
    if (this.myStation?.id) {
      const ref = doc(this.firestore, `stations/${this.myStation.id}`);
      await updateDoc(ref, {
        lat: latitude,
        lng: longitude,
        lastLocationUpdate: new Date(),
      });
      this.myStation.lat = latitude;
      this.myStation.lng = longitude;
      console.log(`✅ Station ${this.myStation.stationName} updated to GPS location`);
    }

    // ✅ Re-center the map
    if (this.map) {
      this.map.setView([latitude, longitude], 15);
      setTimeout(() => this.map?.invalidateSize(), 300);
    }

    await this.showToast('✅ Station location synced via GPS', 'success');
  } catch (err) {
    console.error('❌ GPS locate failed:', err);
    await this.showToast('⚠️ Enable device location to update station.', 'warning');
  }
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
          changedAt: new Date(),
          by: this.displayName || 'Manager',
        }),
      },
      { merge: true }
    );
    console.log(`👥 Synced user order ${order.id} → ${newStatus}`);
  } catch (err) {
    console.warn('⚠️ Failed to mirror user order:', err);
  }
}

// ─────────────── Auto-Repair: sync archived orders back to users (runs once) ───────────────
private async autoRepairUserOrders(): Promise<void> {
  if (!this.myStation?.id) return;
  const stationId = this.myStation.id;
  const archivedRef = collection(this.firestore, `stations/${stationId}/archivedOrders`);
  const archivedSnap = await getDocs(archivedRef);

  for (const docSnap of archivedSnap.docs) {
    const data: any = docSnap.data();
    const userId = data?.userId;
    if (!userId) continue;

    const userOrderRef = doc(this.firestore, `users/${userId}/orders/${docSnap.id}`);
    await setDoc(
      userOrderRef,
      {
        status: 'Delivered',
        deliveredAt: data?.deliveredAt || data?.completedAt || serverTimestamp(),
        archived: true,
        stationId,
        lastSyncedAt: serverTimestamp(),
      },
      { merge: true }
    );
    console.log(`🔁 Auto-synced archived order ${docSnap.id} → user ${userId}`);
  }
}

// ─────────────── Push Notification + Firestore Mirror ───────────────
private async notifyUserOrderDelivered(order: any): Promise<void> {
  try {
    const userId = order?.userId;
    if (!userId) return;

    // Create Firestore notification
    const notifRef = collection(this.firestore, `users/${userId}/notifications`);
    await addDoc(notifRef, {
      type: 'orderUpdate',
      title: 'Order Delivered',
      message: `Your order from ${order?.stationName || 'AquaRoute Station'} has been delivered.`,
      orderId: order?.id,
      timestamp: serverTimestamp(),
      read: false,
    });

    // Optional push notification (if user has token)
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

    console.log(`📩 Notification added for user ${userId}`);
  } catch (err) {
    console.warn('⚠️ Failed to send delivery notification:', err);
  }
}


// ───────────────────────────────────────────────────────────
// 🖼️ IMAGE UPLOAD HANDLER (Reusable for Add/Edit Product)
// ───────────────────────────────────────────────────────────
async uploadImage(file: File): Promise<string> {
  const storage = getStorage(); // ✅ Firebase Storage instance
  return new Promise((resolve, reject) => {
    const filePath = `products/${Date.now()}_${file.name}`;
    const fileRef = ref(storage, filePath);
    const uploadTask = uploadBytesResumable(fileRef, file);

    uploadTask.on(
      'state_changed',
      (snapshot) => {
        this.uploadProgress = Math.round(
          (snapshot.bytesTransferred / snapshot.totalBytes) * 100
        );
      },
      (error) => {
        console.error('❌ Upload failed:', error);
        reject(error);
      },
      async () => {
        const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
        console.log('✅ Uploaded image URL:', downloadURL);
        resolve(downloadURL);
      }
    );
  });
}

// ─────────────────────────────────────────────
// 🔔 Real-time Manager Notification Badge
// ─────────────────────────────────────────────
private listenToManagerNotifications(managerId: string) {
  const notifRef = collection(this.firestore, `users/${managerId}/notifications`);
  const qUnread = query(notifRef, where('read', '==', false));

  this.notifUnsub = onSnapshot(qUnread, (snap) => {
    this.unreadNotifCount = snap.size || 0;
  });
}


// ─────────────────────────────────────────────
// 🧩 Timeline Rebuilder (safe mode access)
// ─────────────────────────────────────────────
private rebuildTimeline(order: any): string[] {
  // ✅ Safely detect mode without TS errors
  const rawMode =
    (order && (order as any)['mode']) ||
    (order?.items && (order.items[0] as any)?.mode) ||
    'delivery';

  const mode = rawMode.toString().toLowerCase().replace(/\s+/g, '');

  return mode === 'pickup'
    ? ['Pending', 'Order Confirmed', 'Preparing', 'Ready for Pickup', 'Picked Up']
    : ['Pending', 'Order Confirmed', 'Preparing', 'Out for Delivery', 'Delivered'];
}

// 🔔 Listen for Admin Disable/Enable Station Updates (fully fixed)
private listenForStationActiveChanges(): void {
  const stationId = this.myStation?.id;
  if (!stationId) return;

  const stationRef = doc(this.firestore, `stations/${stationId}`);

  const unsub = onSnapshot(stationRef, async (snap) => {
    if (!snap.exists()) return;
    const data = snap.data() as any;
    this.applyStationVerificationState(data);
    const active = data.active ?? true;

    const wasActive = (this.myStation as any)['active'] ?? true;
    (this.myStation as any)['active'] = active;

    // 🔔 Show toast once when toggled
    if (wasActive !== active) {
      const message = active
        ? '✅ Your station has been re-enabled by the admin.'
        : '⚠️ Your station has been disabled by the admin.';
      const color = active ? 'success' : 'danger';
      const toast = await this.toastCtrl.create({
        message,
        duration: 3000,
        color,
      });
      await toast.present();

      console.log(`🔔 Station ${active ? 'ENABLED' : 'DISABLED'}`);
    }

    // 🚫 Lock actions when disabled
    if (!active) {
      this.disableStationUI();
    }
  });

  this.firestoreSubs.push({ unsubscribe: unsub });
}

// 🚫 Disable manager interactions when station is inactive
private async disableStationUI(): Promise<void> {
  await this.showToast('⚠️ Station disabled — features temporarily locked.', 'danger');

  // Clear active lists and prevent actions
  this.myOrdersList = [];
  this.myCouriers = [];
  this.vehicleOptions = [];
  this.setEmptyStreams();

  // Optionally redirect to a safe page
  this.router.navigate(['/home']).catch(() => {});
}

// ─────────────────────────────────────────────
// 🤖 Retrain ML Model (SAFE)
// ─────────────────────────────────────────────
async retrainML(): Promise<void> {
  if (this.shouldBlockManagerActions) {
  await this.showToast('⚠️ Station not approved yet.', 'warning');
  return;
}
  try {
    const loading = await this.toastCtrl.create({
      message: '🤖 Training ML model...',
      duration: 1500,
      color: 'medium',
    });
    await loading.present();

    await this.mlWeightService.trainFromLogs();

    const done = await this.toastCtrl.create({
      message: '✅ ML model updated successfully',
      duration: 2000,
      color: 'success',
    });
    await done.present();

  } catch (err) {
    console.error('ML retrain error:', err);

    const errorToast = await this.toastCtrl.create({
      message: '⚠️ ML training failed',
      duration: 2000,
      color: 'danger',
    });
    await errorToast.present();
  }
}

get isStationApproved(): boolean {
  return this.stationVerificationStatus === 'approved';
}

get shouldBlockManagerActions(): boolean {
  return !this.isStationApproved;
}

private applyStationVerificationState(station: any | null): void {
  const status =
    station?.verificationStatus ||
    (station?.verified
      ? (station?.active === false ? 'disabled' : 'approved')
      : 'pending');

  this.stationVerificationStatus = status;

  switch (status) {
    case 'approved':
      this.stationStatusMessage = 'Your station is approved. You can now manage everything.';
      break;

    case 'disabled':
      this.stationStatusMessage = 'Your station has been disabled by admin.';
      break;

    case 'rejected':
      this.stationStatusMessage = 'Your station application was rejected.';
      break;

    case 'pending':
    default:
      this.stationStatusMessage = 'Waiting for admin approval.';
      break;
  }
}

}
