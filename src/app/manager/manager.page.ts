// manager.page.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, AlertController, ToastController } from '@ionic/angular';
import { RouterModule, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Auth } from '@angular/fire/auth';
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
// 🔹 Centralized models (you said these files already exist)
import { Station } from '../models/station.model';
import { Product } from '../models/product.model';
import { Courier } from '../models/courier.model';
import { Order, OrderItem, CourierRef } from '../models/order.model';
import * as L from 'leaflet';


@Component({
  selector: 'app-manager',
  templateUrl: './manager.page.html',
  styleUrls: ['./manager.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule, FormsModule],
})
export class ManagerPage implements OnInit, OnDestroy {
  // Station + data streams
  myStation: Station | null = null;
  myProducts$!: Observable<Product[]>;
  myOrders$!: Observable<Order[]>;
  otherStations: Station[] = [];
  myCouriers: Courier[] = [];

  // Dashboard data (computed)
  myOrdersList: Order[] = [];
  newOrdersCount = 0;
  preparingCount = 0;
  inTransitCount = 0;
  completedCount = 0;
  efficiencyScore = 0;

// Map & Drawing
private map!: L.Map;


  // Quick profile (header)
  profilePic: string = 'assets/profile-placeholder.png';
  displayName: string | null = null;
  email: string | null = null;
  phoneNumber: string | null = null;


  // UI
  selectedTab: string = 'dashboard';

  // Route optimization (demo)
  selectedAlgorithm = 'greedy';
  optimizedRoute: string[] = [];

  // Internals
  private subs: Subscription[] = [];

  // ✅ New-order notifications (badge on Orders tab)
  newOrdersBadge = 0;
  private unsubscribeOrdersListener?: () => void;

  // Allowed status transitions (AquaRoute order flow)
  private readonly validTransitions: Record<string, string> = {
    New: 'Preparing',
    Pending: 'Preparing',
    Preparing: 'Out for Delivery',
    'Out for Delivery': 'Delivered',
  };

  constructor(
    private firestore: Firestore,
    private userService: UserService,
    private notificationService: NotificationService,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
    private router: Router,
    private auth: Auth
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
  return; // just stop setup, no redirect
}

const role = snap.data()?.['role'];
if (role !== 'manager') {
  console.warn(`⚠️ User role is ${role}, not manager`);
  return; // stop setup, no redirect
}

    // Header profile (only runs if manager)
    this.displayName = user.displayName ?? 'Manager';
    this.email = user.email ?? null;
    this.profilePic = (user.photoURL as string) ?? this.profilePic;
    this.phoneNumber = user.phoneNumber ? user.phoneNumber.replace(/^\+63/, '0') : null;

    // Stations owned by user
    const stationsRef = collection(this.firestore, 'stations');
    const qStations = query(stationsRef, where('ownerId', '==', user.uid));
    const stationsSub = collectionData(qStations, { idField: 'id' }).subscribe((stations: any[]) => {
      this.myStation = stations?.length ? (stations[0] as Station) : null;

      // 🔹 Init map once station is loaded
      if (this.myStation?.lat && this.myStation?.lng) {
        this.initMap([this.myStation.lat, this.myStation.lng]);
      } else {
        this.initMap(); // fallback center (Tuguegarao)
      }

      // Reset & rebuild streams + listeners
      this.teardownOrdersListener();

      if (this.myStation?.id) {
        // Products stream
        const productsRef = collection(this.firestore, `stations/${this.myStation.id}/products`);
        this.myProducts$ = collectionData(productsRef, { idField: 'id' }) as Observable<Product[]>;

        // Orders stream (for lists + dashboard cards)
        const ordersRef = collection(this.firestore, `stations/${this.myStation.id}/orders`);
        this.myOrders$ = collectionData(ordersRef, { idField: 'id' }) as Observable<Order[]>;

        // Couriers stream
        const couriersRef = collection(this.firestore, `stations/${this.myStation.id}/couriers`);
        const couriersSub = collectionData(couriersRef, { idField: 'id' }).subscribe((couriers: any[]) => {
          this.myCouriers = (couriers || []) as Courier[];
        });
        this.subs.push(couriersSub);

        // Local snapshot for dashboard computation
        const ordersSub = collectionData(ordersRef, { idField: 'id' }).subscribe((orders: any[]) => {
          this.myOrdersList = (orders || []) as Order[];
          this.computeDashboardCounts();
        });
        this.subs.push(ordersSub);

        // ✅ Real-time NEW order notifications (toast + badge)
        this.listenForNewOrders();
      } else {
        // No station yet
        this.setEmptyStreams();
      }
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



ngOnDestroy(): void {
  this.teardownOrdersListener();
  this.subs.forEach((s) => s.unsubscribe());
  this.subs = [];
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
  computeDashboardCounts(): void {
    const orders = this.myOrdersList || [];
    this.newOrdersCount = orders.filter((o) => o.status === 'New' || o.status === 'Pending').length;
    this.preparingCount = orders.filter((o) => o.status === 'Preparing').length;
    this.inTransitCount = orders.filter((o) => o.status === 'Out for Delivery').length;
    this.completedCount = orders.filter((o) => o.status === 'Delivered').length;

    const total = orders.length || 1;
    this.efficiencyScore = Math.round((this.completedCount / total) * 100);
  }

  // ───────────────────────────────────────────────────────────
  // 🔔 Notifications: new orders listener + badge
  // ───────────────────────────────────────────────────────────
  private listenForNewOrders(): void {
    if (!this.myStation?.id) return;

    const ordersRef = collection(this.firestore, `stations/${this.myStation.id}/orders`);

    // Teardown previous (safety)
    this.teardownOrdersListener();

    this.unsubscribeOrdersListener = onSnapshot(ordersRef, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const orderId = change.doc.id;
          // Toast (visible ping)
          this.showToast(`📦 New order received: ${orderId}`, 'success');
          // Badge (increments for “unseen” orders)
          this.newOrdersBadge++;
        }
      });
    });
  }

  private teardownOrdersListener(): void {
    if (this.unsubscribeOrdersListener) {
      this.unsubscribeOrdersListener();
      this.unsubscribeOrdersListener = undefined;
    }
  }

  /** Call this from Orders button click to clear the badge */
public onOpenOrders(): void {
  this.resetNewOrdersBadge();
  this.router.navigate(['/manager-orders']).catch(() => {});
}

  resetNewOrdersBadge(): void {
    this.newOrdersBadge = 0;
  }

  // ───────────────────────────────────────────────────────────
  // Orders (with Courier Assignment) + Push to customer
  // ───────────────────────────────────────────────────────────
  async updateOrderStatus(
    orderId: string | undefined,
    nextStatus: 'Preparing' | 'Out for Delivery' | 'Delivered'
  ): Promise<void> {
    if (!this.myStation?.id || !orderId) return;

    const orderRef = doc(this.firestore, `stations/${this.myStation.id}/orders/${orderId}`);
    const snap = await getDoc(orderRef);
    if (!snap.exists()) return;

    const orderData = snap.data() as Order;
    const currentStatus: string = orderData.status || 'New';

    // Enforce strict flow
    if (this.validTransitions[currentStatus] !== nextStatus) {
      await this.showToast(`⚠️ Can't move ${currentStatus} → ${nextStatus}`, 'warning');
      return;
    }

    // Require courier before going Out for Delivery
    if (nextStatus === 'Out for Delivery' && !orderData?.courier) {
      await this.showToast('⚠️ Assign a courier before marking as Out for Delivery', 'warning');
      return;
    }

    // Append status history entry (server time) and update status
    await updateDoc(orderRef, {
      status: nextStatus,
      lastUpdatedAt: serverTimestamp(),
      statusHistory: arrayUnion({
        status: nextStatus,
        changedAt: serverTimestamp(),
        by: this.displayName || 'Manager',
      }),
    });

    // Deduct stock when Delivered
    if (nextStatus === 'Delivered' && Array.isArray(orderData?.items)) {
      for (const item of orderData.items) {
        const productRef = doc(this.firestore, `stations/${this.myStation.id}/products/${item.productId}`);
        const productSnap = await getDoc(productRef);
        if (productSnap.exists()) {
          const currentStock = (productSnap.data() as any)['stock'] ?? 0;
          const newStock = Math.max(currentStock - (item.quantity || 1), 0);
          await updateDoc(productRef, { stock: newStock, inStock: newStock > 0 });
        }
      }
    }

    // ✅ Push notify customer (if we have a token on their user doc)
if (orderData?.userId) {
  const userRef = doc(this.firestore, `users/${orderData.userId}`);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        const pushToken = (userSnap.data() as any).pushToken;
        if (pushToken) {
        await this.notificationService.sendPush({
          title: 'Order Update',
          body: `Order ${orderId} is now ${nextStatus}`,
          token: pushToken,
          orderId: orderId,
          stationId: this.myStation.id,
        });
        }
      }
    }

    await this.showToast(`✅ Order set to ${nextStatus}`, 'success');
  }



// ───────────────────────────────────────────────────────────
// Assign Courier to Order
// ───────────────────────────────────────────────────────────
async assignCourier(order: Order, courier?: Courier): Promise<void> {
  if (!this.myStation?.id || !order?.id) return;

  // Case 1: Courier already provided (direct call)
  if (courier?.id) {
    const orderRef = doc(this.firestore, `stations/${this.myStation.id}/orders/${order.id}`);
    await updateDoc(orderRef, {
      courier: {
        id: courier.id,
        name: courier.name,
        vehicle: courier.vehicle,
        eta: courier.eta || null,
        assignedAt: new Date(),
      } as CourierRef,
      assignedCourierId: courier.id, // 🔑 store courier UID separately
      statusHistory: arrayUnion({
        status: 'Courier Assigned',
        changedAt: serverTimestamp(),
        by: this.displayName || 'Manager',
      }),
    });
    await this.showToast(`✅ Assigned ${courier.name} to order ${order.id}`, 'success');
    return;
  }

  // Case 2: No courier passed → show popup picker
  const couriersRef = collection(this.firestore, `stations/${this.myStation.id}/couriers`);
  const snapshot = await getDocs(couriersRef);
  const couriers = snapshot.docs.map((d: any) => ({ id: d.id, ...d.data() }));

  if (!couriers.length) {
    await this.showToast('⚠️ No couriers available. Add one first.', 'warning');
    return;
  }

  const alert = await this.alertCtrl.create({
    header: 'Assign Courier',
    inputs: couriers.map((c: any) => ({
      type: 'radio',
      label: `${c.name} (${c.vehicle})`,
      value: c,
    })),
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Assign',
        handler: async (selectedCourier: any) => {
          if (!selectedCourier) {
            await this.showToast('⚠️ Please select a courier.', 'warning');
            return;
          }
          await this.assignCourier(order, selectedCourier); // reuse case 1
        },
      },
    ],
  });
  await alert.present();
}


  public async promptNewCourierAndAssign(order: Order | null): Promise<void> {
    if (order) {
      await this.assignCourier(order);
      return;
    }

    if (!this.myStation?.id) return;

    const alert = await this.alertCtrl.create({
      header: 'New Courier',
      inputs: [
        { name: 'name', type: 'text', placeholder: 'Courier Name' },
        { name: 'vehicle', type: 'text', placeholder: 'Vehicle (e.g., Motorbike)' },
        { name: 'eta', type: 'text', placeholder: 'Default ETA (optional)' },
        { name: 'email', type: 'email', placeholder: 'Courier Email (registered)' },
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Save',
          handler: async (data: any) => {
            if (!data?.name || !data?.vehicle || !data?.email) {
              await this.showToast('⚠️ Name, vehicle, and email are required', 'warning');
              return;
            }

            // 🔽 Normalize email
            const email = data.email.trim().toLowerCase();

            // 🔍 Find user by email
            const usersRef = collection(this.firestore, 'users');
            const q = query(usersRef, where('email', '==', email));
            const snap = await getDocs(q);

            if (snap.empty) {
              await this.showToast(`⚠️ No user found with email ${email}`, 'warning');
              return; // ⬅️ Stop — don’t overwrite anything
            }

            const courierUser = snap.docs[0];
            const courierUid = courierUser.id;

            // 🚫 Prevent overwriting the logged-in manager
            const currentUser = this.auth.currentUser;
            if (currentUser && courierUid === currentUser.uid) {
              await this.showToast('⚠️ That email belongs to the logged-in manager. Use a different email.', 'warning');
              return;
            }

            // Save under station-specific couriers
            const couriersRef = collection(this.firestore, `stations/${this.myStation!.id}/couriers`);
            await setDoc(doc(couriersRef, courierUid), {
              name: data.name,
              vehicle: data.vehicle,
              eta: data.eta || null,
              uid: courierUid,
              active: true,
              createdAt: new Date(),
            });

            // Mirror to global couriers collection
            const globalRef = doc(this.firestore, `couriers/${courierUid}`);
            await setDoc(globalRef, {
              stationId: this.myStation!.id,
              stationName: this.myStation!.stationName,
              name: data.name,
              vehicle: data.vehicle,
              eta: data.eta || null,
              uid: courierUid,
              active: true,
              createdAt: new Date(),
            });

            // ✅ Update the courier’s user doc, not manager’s
            const userRef = doc(this.firestore, `users/${courierUid}`);
            await setDoc(userRef, { role: 'courier' }, { merge: true });

            await this.showToast(`✅ Courier ${data.name} added via email`, 'success');
          },
        },
      ],
    });

    await alert.present();
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
    if (!this.myStation?.id || !courier?.id) return;

    const newStatus = !courier.active;
    const ref = doc(this.firestore, `stations/${this.myStation.id}/couriers/${courier.id}`);
    await updateDoc(ref, { active: newStatus });

    await this.showToast(`🚚 Courier marked as ${newStatus ? 'active' : 'inactive'}`, 'success');
  }

  async deleteCourier(courier: Courier): Promise<void> {
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

  // ───────────────────────────────────────────────────────────
  // Products
  // ───────────────────────────────────────────────────────────
  async addProduct(): Promise<void> {
    if (!this.myStation?.id) return;

    const alert = await this.alertCtrl.create({
      header: 'Add Product',
      inputs: [
        { name: 'name', placeholder: 'Product name', type: 'text' },
        { name: 'price', placeholder: 'Base price', type: 'number' },
        { name: 'description', placeholder: 'Description', type: 'text' },
        { name: 'stock', placeholder: 'Stock quantity', type: 'number' },
        { name: 'category', placeholder: 'Category (e.g. Gallon, Bottle)', type: 'text' },
        { name: 'imageUrl', placeholder: 'Image URL', type: 'url' },
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Add',
          handler: async (data: any) => {
            if (!data?.name || data?.price === undefined || data?.price === null) {
              await this.showToast('⚠️ Name and price are required', 'warning');
              return;
            }
            const productsRef = collection(this.firestore, `stations/${this.myStation!.id}/products`);
            const stockQty = Number(data.stock) || 0;
            await addDoc(productsRef, {
              name: data.name,
              basePrice: Number(data.price),
              description: data.description || '',
              stock: stockQty,
              inStock: stockQty > 0,
              category: data.category || 'General',
              imageUrl: data.imageUrl || 'assets/placeholder.png',
              createdAt: new Date(),
            } as Product);
            await this.showToast('✅ Product added', 'success');
          },
        },
      ],
    });

    await alert.present();
  }

  async editProduct(product: Product): Promise<void> {
    if (!this.myStation?.id || !product?.id) return;

    const alert = await this.alertCtrl.create({
      header: 'Edit Product',
      inputs: [
        { name: 'name', value: product.name, type: 'text' },
        { name: 'price', value: product.basePrice, type: 'number' },
        { name: 'description', value: product.description, type: 'text' },
        { name: 'stock', value: product.stock, type: 'number' },
        { name: 'category', value: product.category, type: 'text' },
        { name: 'imageUrl', value: product.imageUrl, type: 'url' },
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Save',
          handler: async (data: any) => {
            const ref = doc(this.firestore, `stations/${this.myStation!.id}/products/${product.id}`);
            const stockQty = Number(data?.stock) || 0;
            await updateDoc(ref, {
              name: data?.name,
              basePrice: Number(data?.price),
              description: data?.description || '',
              stock: stockQty,
              inStock: stockQty > 0,
              category: data?.category || 'General',
              imageUrl: data?.imageUrl || 'assets/placeholder.png',
            });
            await this.showToast('✅ Product updated', 'success');
          },
        },
      ],
    });

    await alert.present();
  }

  async deleteProduct(productId: string): Promise<void> {
    if (!this.myStation?.id) return;

    await deleteDoc(doc(this.firestore, `stations/${this.myStation.id}/products/${productId}`));
    await this.showToast('🗑️ Product deleted', 'warning');
  }

  // ───────────────────────────────────────────────────────────
  // Station
  // ───────────────────────────────────────────────────────────
  async editStation(): Promise<void> {
    if (!this.myStation?.id) return;

    const alert = await this.alertCtrl.create({
      header: 'Edit Station Info',
      inputs: [
        { name: 'stationName', type: 'text', value: this.myStation.stationName, placeholder: 'Station Name' },
        { name: 'address', type: 'text', value: this.myStation.address, placeholder: 'Address' },
        { name: 'email', type: 'email', value: this.myStation['email'], placeholder: 'Email' },
        { name: 'phone', type: 'tel', value: this.myStation.phone, placeholder: 'Phone' },
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Save',
          handler: async (data: any) => {
            const stationRef = doc(this.firestore, `stations/${this.myStation!.id}`);
            await updateDoc(stationRef, {
              stationName: data?.stationName,
              address: data?.address,
              email: data?.email,
              phone: data?.phone,
            });
            await this.showToast('✅ Station updated', 'success');
          },
        },
      ],
    });

    await alert.present();
  }

  // ───────────────────────────────────────────────────────────
  // Route Optimization (demo placeholder)
  // ───────────────────────────────────────────────────────────
  startOptimizedRoute(): void {
    if (!this.myOrdersList?.length) {
      this.optimizedRoute = [];
      return;
    }
    if (this.selectedAlgorithm === 'greedy') {
      this.optimizedRoute = this.myOrdersList.map((o) => o.address || 'Unknown address');
    } else {
      this.optimizedRoute = [...this.myOrdersList].reverse().map((o) => o.address || 'Unknown address');
    }
  }

  // ───────────────────────────────────────────────────────────
  // Nav / Header
  // ───────────────────────────────────────────────────────────
  openNotifications(): void {
    this.router.navigate(['/notifications']).catch(() => {});
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
      this.router.navigate(['/home']);
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

// Track markers + routes so we can clear them when orders update
private customerMarkers: L.Marker[] = [];
private routeLines: L.Polyline[] = [];
private courierMarkers: Record<string, L.Marker> = {};


private clearCustomerLayers(): void {
  if (!this.map) return;
  this.customerMarkers.forEach(m => this.map!.removeLayer(m));
  this.routeLines.forEach(l => this.map!.removeLayer(l));
  this.customerMarkers = [];
  this.routeLines = [];
}



private async initMap(center: L.LatLngExpression = [17.6131, 121.727]) {
  if (this.map) return; // prevent re-initialization

  this.map = L.map('manager-map', {
    center,
    zoom: 14,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
  }).addTo(this.map);

  // 🔹 Always show station marker (green)
  let stationMarker: L.Marker | null = null;
  if (this.myStation?.lat && this.myStation?.lng) {
    stationMarker = L.marker([this.myStation.lat, this.myStation.lng], {
      icon: L.icon({
        iconUrl: 'assets/icons/station-marker.png',
        iconSize: [30, 40],
        iconAnchor: [15, 40],
      }),
    }).addTo(this.map!);
    stationMarker.bindPopup(`<b>${this.myStation.stationName}</b><br>${this.myStation.address}`);
  }

  // 🔹 Orders → customer markers + routes
  if (this.myStation?.id) {
    const ordersRef = collection(this.firestore, `stations/${this.myStation.id}/orders`);
    collectionData(ordersRef, { idField: 'id' }).subscribe((orders: any[]) => {
      this.clearCustomerLayers();

      const markers: L.Marker[] = [];
      if (stationMarker) markers.push(stationMarker);

      orders.forEach((order: any) => {
        const lat = order?.delivery?.latLng?.lat;
        const lng = order?.delivery?.latLng?.lng;
        if (!lat || !lng) return;

        const marker = L.marker([lat, lng]).addTo(this.map!);
        marker.bindPopup(`🧑 Customer<br>${order.delivery.address || ''}`);
        this.customerMarkers.push(marker);
        markers.push(marker);

        // OSRM route station → customer
        if (this.myStation?.lat && this.myStation?.lng) {
          const osrmUrl =
            `https://router.project-osrm.org/route/v1/driving/` +
            `${this.myStation.lng},${this.myStation.lat};${lng},${lat}` +
            `?overview=full&geometries=geojson`;

          fetch(osrmUrl)
            .then((res) => res.json())
            .then((data) => {
              const route = data.routes?.[0];
              if (route) {
                const coords = route.geometry.coordinates.map((c: any) => [c[1], c[0]]);
                const polyline = L.polyline(coords, { color: 'blue', weight: 4 }).addTo(this.map!);
                this.routeLines.push(polyline);
              }
            })
            .catch((err) => console.error('OSRM error', err));
        }
      });

      if (markers.length > 0) {
        const group = L.featureGroup(markers);
        this.map!.fitBounds(group.getBounds(), { padding: [40, 40] });
      }
    });
  }

  // 🔹 Couriers → live tracking with green/red markers
  if (this.myStation?.id) {
    const couriersRef = collection(this.firestore, `stations/${this.myStation.id}/couriers`);
    collectionData(couriersRef, { idField: 'id' }).subscribe((couriers: any[]) => {
      const activeCourierIds = new Set<string>();

      couriers.forEach(courier => {
        if (!courier?.lastLat || !courier?.lastLng) return;

        activeCourierIds.add(courier.id);

        const iconUrl = courier.active
          ? 'assets/icons/courier-marker-green.png'
          : 'assets/icons/courier-marker-red.png';

        if (this.courierMarkers[courier.id]) {
          this.courierMarkers[courier.id]
            .setLatLng([courier.lastLat, courier.lastLng])
            .setIcon(L.icon({
              iconUrl,
              iconSize: [28, 38],
              iconAnchor: [14, 38],
            }));
        } else {
          const marker = L.marker([courier.lastLat, courier.lastLng], {
            icon: L.icon({
              iconUrl,
              iconSize: [28, 38],
              iconAnchor: [14, 38],
            }),
          }).addTo(this.map!);
          marker.bindPopup(
            `🚚 Courier: ${courier.name || 'Unnamed'}<br>Status: ${courier.active ? '🟢 Active' : '🔴 Inactive'}`
          );
          this.courierMarkers[courier.id] = marker;
        }
      });

      // Cleanup removed couriers
      Object.keys(this.courierMarkers).forEach(id => {
        if (!activeCourierIds.has(id)) {
          this.map!.removeLayer(this.courierMarkers[id]);
          delete this.courierMarkers[id];
        }
      });
    });
  }
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

  
}
