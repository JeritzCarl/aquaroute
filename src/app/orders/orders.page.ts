import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import {
  Firestore,
  collection,
  query,
  orderBy,
  onSnapshot,
  getDocs,
  doc,
  updateDoc,
  setDoc,
  arrayUnion,
  serverTimestamp,
  deleteDoc,
} from '@angular/fire/firestore';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import {
  IonicModule,
  LoadingController,
  ToastController,
  AlertController,
} from '@ionic/angular';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';

interface Order {
  id: string;
  userId: string;
  stations: any[];
  items: any[];
  charges: {
    subtotal: number;
    deliveryFee: number;
    total: number;
    currency?: string;
  };
  delivery: {
    fullName: string;
    address: string;
    notes?: string;
  };
  payment: {
    method: string;
    status: string;
  };
  mode?: string;
  status: string;
  cancelReason?: string;
  declineReason?: string;
  createdAt: any;
  rated?: boolean;
}

@Component({
  selector: 'app-orders',
  standalone: true,
  templateUrl: './orders.page.html',
  styleUrls: ['./orders.page.scss'],
  imports: [IonicModule, CommonModule, FormsModule],
  providers: [DatePipe],
})
export class OrdersPage implements OnInit, OnDestroy {
  selectedTab: 'current' | 'history' = 'current';
  orders: Order[] = [];
  currentOrders: Order[] = [];
  orderHistory: Order[] = [];
  loading = true;

  private unsubscribeOrders: (() => void) | null = null;
  private fromOrderSuccess = false;

  constructor(
    private router: Router,
    private firestore: Firestore,
    private auth: Auth,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController,
    private alertCtrl: AlertController
  ) {
    const nav = this.router.getCurrentNavigation();
    if (nav?.extras?.state?.['fromOrderSuccess']) {
      this.fromOrderSuccess = true;
    }
  }

  // ────────────────────────────────
  // 🔹 Lifecycle
  // ────────────────────────────────
  ngOnInit() {
    onAuthStateChanged(this.auth, (user) => {
      if (user) {
        this.listenToOrders(user.uid);
      } else {
        this.cleanup();
      }
    });
  }

  ngOnDestroy() {
    if (this.unsubscribeOrders) this.unsubscribeOrders();
  }

  private cleanup() {
    this.orders = [];
    this.currentOrders = [];
    this.orderHistory = [];
    this.loading = false;
  }

// ────────────────────────────────
// 🔹 Live Firestore Listener (auto-sync)
// ────────────────────────────────
listenToOrders(userId: string) {
  const ordersRef = collection(this.firestore, `users/${userId}/orders`);
  const q = query(ordersRef, orderBy('createdAt', 'desc'));

  if (this.unsubscribeOrders) this.unsubscribeOrders();
  this.loading = true;
  let gotFirstSnapshot = false;

  this.unsubscribeOrders = onSnapshot(
    q,
    (snapshot) => {
      gotFirstSnapshot = true;

      this.orders = snapshot.docs.map((docSnap) => {
        const data: any = docSnap.data();

        // 🔹 Extract + normalize mode and status safely
        let rawMode =
          (data.mode ||
            data.items?.[0]?.mode ||
            data.delivery?.mode ||
            data.deliveryMode ||
            '').toLowerCase().trim();

        const rawStatus = (data.status || '').trim().toLowerCase();
        const histStatuses = Array.isArray(data.statusHistory)
          ? data.statusHistory.map((s: any) => (s?.status || '').toLowerCase().trim())
          : [];

        // 🔹 Infer pickup/delivery if mode missing
        if (!rawMode) {
          if (rawStatus.includes('pickup') || histStatuses.includes('picked up')) {
            rawMode = 'pickup';
          } else if (rawStatus.includes('delivery') || histStatuses.includes('delivered')) {
            rawMode = 'delivery';
          }
        }

        if (rawMode.includes('pickup')) {
          if (rawStatus === 'delivered' || histStatuses.includes('picked up')) {
            data.status = 'Picked Up';
          } 
          else if (
            rawStatus === 'out for delivery' ||
            rawStatus === 'ready for pickup' ||
            rawStatus === 'ready for pick up' ||
            histStatuses.includes('ready for pickup') ||
            histStatuses.includes('ready for pick up')
          ) {
            data.status = 'Ready for Pickup';
          }
        }

        const hasHistCancelled =
          histStatuses.includes('cancelled') || histStatuses.includes('canceled');

        const isDelivered =
          ['delivered', 'completed', 'picked up', 'received'].includes(
            (data.status || '').toLowerCase()
          ) ||
          histStatuses.includes('delivered') ||
          histStatuses.includes('completed') ||
          histStatuses.includes('picked up');

        let status = 'Pending';

        // 1️⃣ Declined overrides all
        if (
          data.declineReason ||
          ['declined', 'rejected', 'declined by the station'].includes(rawStatus) ||
          histStatuses.includes('declined') ||
          histStatuses.includes('rejected') ||
          histStatuses.includes('declined by the station')
        ) {
          status = 'Declined by the Station';
        }

        // 2️⃣ Cancelled next
        else if (
          data.cancelReason ||
          ['cancelled', 'canceled'].includes(rawStatus) ||
          hasHistCancelled ||
          (data.archived === true && !isDelivered)
        ) {
          status = 'Cancelled';
        }

        // 3️⃣ Delivered / Received / Picked Up logic
        else if (isDelivered) {
          if (data.status === 'Received') {
            status = 'Received';
          } else if (rawMode.includes('pickup') || histStatuses.includes('picked up')) {
            status = 'Picked Up';
          } else {
            status = 'Delivered';
          }
        }

        // 4️⃣ Active statuses
        else if (
          [
            'pending',
            'placed',
            'order confirmed',
            'preparing',
            'out for delivery',
            'ready for pickup',
            'ready for pick up',
            'ready',
          ].includes(rawStatus)
        ) {
          status = rawStatus.replace(/\b\w/g, (c: string) => c.toUpperCase());
        } else {
          status = 'Pending';
        }

        console.log('📦 ORDER SNAP:', docSnap.id, {
          mode: rawMode || 'undefined',
          rawStatus,
          histStatuses,
          finalStatus: status,
        });

return {
  id: docSnap.id,
  ...data,
  mode: rawMode,
  createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
  status,
  rated: data.rated || data.rating?.rated || false, // ✅ include rated flag
} as Order;
      });

      this.splitOrders();
      this.loading = false;

      if (this.fromOrderSuccess) {
        snapshot.docChanges().forEach(async (change) => {
          if (change.type === 'added')
            await this.showToast(`🆕 Order placed successfully! (#${change.doc.id})`, 'success');
          if (change.type === 'modified')
            await this.showToast(`📢 Order update: ${change.doc.data()['status']}`, 'medium');
        });
        this.fromOrderSuccess = false;
      }
    },
    (error) => {
      console.error('Firestore listen failed:', error);
      this.loading = false;
    }
  );

  setTimeout(() => {
    if (!gotFirstSnapshot) this.loading = false;
  }, 2500);
}

// ────────────────────────────────
// 🔹 Manual Refresh (safe version with fallback timestamps)
// ────────────────────────────────
async refreshOrders() {
  const user = this.auth.currentUser;
  if (!user) return;

  const loading = await this.loadingCtrl.create({
    message: 'Refreshing orders...',
    spinner: 'crescent',
    duration: 1500,
  });
  await loading.present();

  try {
    const ordersRef = collection(this.firestore, `users/${user.uid}/orders`);
    const q = query(ordersRef);
    const snap = await getDocs(q);

    this.orders = snap.docs
      .map((docSnap) => {
        const data: any = docSnap.data();

        const createdAt = data.createdAt?.toDate
          ? data.createdAt.toDate()
          : (data.createdAt && data.createdAt.seconds)
          ? new Date(data.createdAt.seconds * 1000)
          : new Date(0);

        const rawStatus = (data.status || '').trim().toLowerCase();
        const histStatuses = Array.isArray(data.statusHistory)
          ? data.statusHistory.map((s: any) => (s?.status || '').toLowerCase().trim())
          : [];

        const hasHistCancelled =
          histStatuses.includes('cancelled') || histStatuses.includes('canceled');

        const isDelivered =
          ['delivered', 'completed', 'picked up'].includes(rawStatus) ||
          histStatuses.includes('delivered') ||
          histStatuses.includes('completed') ||
          histStatuses.includes('picked up');

        let status = 'Pending';

        if (
          data.declineReason ||
          ['declined', 'rejected', 'declined by the station'].includes(rawStatus) ||
          histStatuses.includes('declined') ||
          histStatuses.includes('rejected') ||
          histStatuses.includes('declined by the station')
        ) {
          status = 'Declined by the Station';
        } else if (
          data.cancelReason ||
          ['cancelled', 'canceled'].includes(rawStatus) ||
          hasHistCancelled ||
          (data.archived === true && !isDelivered)
        ) {
          status = 'Cancelled';
        } else if (isDelivered) {
          const mode =
            (data.mode || data.items?.[0]?.mode || '').toLowerCase();

          if (rawStatus === 'received') {
            status = 'Received';
          } else if (mode === 'pickup' || histStatuses.includes('picked up') || rawStatus === 'picked up') {
            status = 'Picked Up';
          } else {
            status = 'Delivered';
          }
        } else if (
  [
    'pending',
    'placed',
    'order confirmed',
    'preparing',
    'waiting for courier',
    'assigned to courier',
    'in transit',
    'out for delivery',
    'ready for pickup',
    'ready for pick up',
    'ready',
  ].includes(rawStatus)
) {
          status = rawStatus.replace(/\b\w/g, (c: string) => c.toUpperCase());
        } else {
          status = 'Pending';
        }

        return {
          id: docSnap.id,
          ...data,
          createdAt,
          status,
        } as Order;
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    this.splitOrders();
  } catch (err) {
    console.error('❌ Refresh failed:', err);
  } finally {
    loading.dismiss();
  }
}

// ────────────────────────────────
// 🔹 Helper
// ────────────────────────────────
private capitalizeWords(str: string): string {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}


splitOrders() {
  const normalize = (val: string = '') =>
    val.trim().toLowerCase().replace(/\s+/g, ' ');

  // 🔹 Active = still being processed
const activeStatuses = [
  'pending',
  'placed',
  'order confirmed',
  'preparing',
  'waiting for courier',
  'assigned to courier',
  'in transit',
  'out for delivery',
  'ready for pickup',
  'ready for pick up',
  'ready',
];

  // 🔹 History = finished or cancelled
  const historyStatuses = [
    'delivered',
    'received',
    'completed',
    'picked up',
    'cancelled',
    'canceled',
    'declined',
    'declined by the station',
    'rejected',
    'archived',
  ];

  // ✅ Keep orders in proper tabs
  this.currentOrders = this.orders.filter(
    (o) => activeStatuses.includes(normalize(o.status))
  );

  this.orderHistory = this.orders.filter(
    (o) => historyStatuses.includes(normalize(o.status))
  );

  // ✅ ensure Declined/Cancelled NEVER appear in Current
  this.currentOrders = this.currentOrders.filter(
    (o) =>
      ![
        'cancelled',
        'canceled',
        'declined',
        'declined by the station',
        'rejected',
      ].includes(normalize(o.status))
  );

  // ✅ Fallback for unmatched — safely push to History if completed-type
  const unmatched = this.orders.filter(
    (o) =>
      !activeStatuses.includes(normalize(o.status)) &&
      !historyStatuses.includes(normalize(o.status))
  );
  if (unmatched.length) {
    unmatched.forEach((o) => {
      if (['ready for pickup', 'ready for pick up', 'ready'].includes(normalize(o.status))) {
        this.currentOrders.push(o);
      } else {
        this.orderHistory.push(o);
      }
    });
  }
}

  // ────────────────────────────────
  // 🔹 Confirm + Cancel Order
  // ────────────────────────────────
  async confirmCancel(order: Order) {
    const alert = await this.alertCtrl.create({
      header: 'Cancel Order',
      message: 'Are you sure you want to cancel this order?',
      buttons: [
        { text: 'No', role: 'cancel' },
        {
          text: 'Yes, Cancel',
          role: 'destructive',
          handler: () => this.cancelOrder(order),
        },
      ],
    });
    await alert.present();
  }

  // ────────────────────────────────
  // 🔹 Cancel order everywhere (User + Global + Station + History)
  // ────────────────────────────────
  async cancelOrder(order: any) {
    try {
      const user = this.auth.currentUser;
      if (!user) return;

      const orderId = order.id;
      const updatePayload = {
        status: 'Cancelled',
        cancelledAt: serverTimestamp(),
        lastUpdatedAt: serverTimestamp(),
        statusHistory: arrayUnion({
          status: 'Cancelled',
          changedAt: new Date(),
          by: user.displayName || 'User',
        }),
      };

      // update user + global docs
      const userOrderRef = doc(this.firestore, `users/${user.uid}/orders/${orderId}`);
      const globalOrderRef = doc(this.firestore, `orders/${orderId}`);
      await Promise.all([
        updateDoc(userOrderRef, updatePayload),
        updateDoc(globalOrderRef, updatePayload),
      ]);

      // move to station archived collection
      const stations = order.stations || [];
      for (const st of stations) {
        const stationId = st.stationId || st.id;
        if (!stationId) continue;

        const activeRef = doc(this.firestore, `stations/${stationId}/orders/${orderId}`);
        const archivedRef = doc(this.firestore, `stations/${stationId}/archivedOrders/${orderId}`);

        await setDoc(archivedRef, { ...order, ...updatePayload, archived: true });
        await updateDoc(activeRef, updatePayload).catch(() => {});
        await deleteDoc(activeRef).catch(() => {});
      }

      await this.presentToast('🛑 Order cancelled successfully.', 'danger');
      this.splitOrders(); // immediate UI refresh
    } catch (err) {
      console.error('❌ Cancel failed:', err);
      await this.presentToast('Failed to cancel order.', 'warning');
    }
  }

  // ────────────────────────────────
  // 🔹 Helpers
  // ────────────────────────────────
  getStatusColor(status: string): string {
    const s = (status || '').toLowerCase();

if (['pending', 'placed'].includes(s))
  return 'warning';

if (['order confirmed', 'preparing', 'waiting for courier'].includes(s))
  return 'secondary';

if (['assigned to courier', 'in transit', 'out for delivery', 'ready for pickup'].includes(s))
  return 'primary';

if (['delivered', 'completed', 'picked up', 'received'].includes(s))
  return 'success';

if (['cancelled', 'canceled', 'declined', 'rejected'].includes(s))
  return 'danger';

    return 'medium';
  }

  getItemSummary(order: any): string {
    if (!order?.items?.length) return 'No items';
    const total = order.items.reduce(
      (sum: number, i: any) => sum + (i.quantity || 1),
      0
    );
    return `${total} item${total > 1 ? 's' : ''}`;
  }

  getModeColor(mode: string): string {
    return mode?.toLowerCase().includes('pickup') ? 'tertiary' : 'primary';
  }

  getStationTitle(order: Order): string {
    return order.stations?.length > 1
      ? 'Multiple Stations'
      : order.stations[0]?.stationName || 'Unknown Station';
  }

  getDeclineReason(order: Order): string | null {
    return order.declineReason || order.cancelReason || null;
  }

  goToOrder(order: Order) {
    this.router.navigate(['/track-order'], {
      queryParams: { id: order.id },
    });
  }


// ────────────────────────────────
// 🔹 Confirm Order Received (Delivery)
// ────────────────────────────────
async confirmReceived(order: Order) {
  const alert = await this.alertCtrl.create({
    header: 'Confirm Delivery',
    message: 'Mark this order as received?',
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Yes, Confirm',
        handler: async () => {
        await this.updateOrderStatus(order, 'Received');
        await this.presentToast('✅ Order marked as received.', 'success');
        },
      },
    ],
  });
  await alert.present();
}

// ────────────────────────────────
// 🔹 Confirm Picked Up (Pickup mode)
// ────────────────────────────────
async confirmPickedUp(order: Order) {
  const alert = await this.alertCtrl.create({
    header: 'Confirm Pickup',
    message: 'Mark this order as picked up?',
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Yes, Confirm',
        handler: async () => {
          await this.updateOrderStatus(order, 'Picked Up');
          await this.presentToast('✅ Order marked as picked up.', 'success');
        },
      },
    ],
  });
  await alert.present();
}

// ────────────────────────────────
// 🔹 Shared Firestore update helper
// ────────────────────────────────
private async updateOrderStatus(order: any, newStatus: string) {
  try {
    const user = this.auth.currentUser;
    if (!user) return;

    const orderId = order.id;
    const orderRef = doc(this.firestore, `users/${user.uid}/orders/${orderId}`);
    const globalRef = doc(this.firestore, `orders/${orderId}`);

    // include rated:false so Rate button appears after confirm
    const payload = {
      status: newStatus,
      rated: false,
      lastUpdatedAt: serverTimestamp(),
      statusHistory: arrayUnion({
        status: newStatus,
        changedAt: new Date(),
        by: user.displayName || 'Customer',
      }),
    };

    await Promise.allSettled([
      updateDoc(orderRef, payload),
      updateDoc(globalRef, payload),
      ...(order.stations || []).map((st: any) => {
        const sid = st.stationId || st.id;
        if (!sid) return Promise.resolve();
        const stRef = doc(this.firestore, `stations/${sid}/orders/${orderId}`);
        return updateDoc(stRef, payload);
      }),
    ]);

    // ✅ Reflect locally
    order.status = newStatus;
    order.rated = false;
    this.splitOrders();
  } catch (err) {
    console.error('❌ Failed to update order status:', err);
    await this.presentToast('Failed to update order status.', 'warning');
  }
}

// ✅ Correct navigation
goToRatingPage(order: any) {
  if (!order?.id) return;
  const mode = (order.mode || '').toLowerCase();
  this.router.navigate(['/rating', order.id], {
    queryParams: { mode },
  });
}

// ────────────────────────────────
// 🔹 Helpers for order type checks
// ────────────────────────────────
isDelivery(order: any): boolean {
  const mode = (order.mode || order.items?.[0]?.mode || '').toLowerCase();
  return mode.includes('delivery');
}

shouldShowPickedUp(order: any): boolean {
  if (!order) return false;

  const mode = (order.mode || order.items?.[0]?.mode || '').toLowerCase();
  const normalizedStatus = this.normalizeStatus(order.status);

  // ✅ Accepts any "ready" variant
  const pickupStatuses = [
    'ready',
    'ready for pickup',
    'ready for pick up',
    'ready_pickup',
    'ready_pick_up',
    'ready_for_pickup',
    'readyforpickup',
    'ready to pick up'
  ];

  return mode.includes('pickup') && pickupStatuses.some(s => normalizedStatus.includes(s));
}

// --- Normalizers ---
private normalize(val: string | undefined | null): string {
  return (val || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

private normalizeStatus(s: string | undefined | null): string {
  const v = this.normalize(s);
  if (v === 'ready for pick up') return 'ready for pickup';
  return v;
}

private isPickup(order: any): boolean {
  const rawMode = (order?.mode ?? order?.items?.[0]?.mode ?? '').toString();
  const m = this.normalize(rawMode);
  const s = this.normalizeStatus(order?.status);
  // 🔹 Fallback: treat Ready for Pickup / Picked Up as pickup even if mode missing
  return m === 'pickup' || s.includes('ready') || s.includes('pick up');
}

// --- Button gates used by the HTML ---
canShowOrderReceived(order: any): boolean {
  // Delivery flow: show when courier marked Delivered
  return !this.isPickup(order) && this.normalizeStatus(order?.status) === 'delivered';
}

// 🔹 Show "Picked Up" button only when appropriate
canShowPickedUp(order: any): boolean {
  if (!order) return false;
  const mode = (order.mode || order.items?.[0]?.mode || '').toLowerCase().trim();
  const status = (order.status || '').toLowerCase().trim();

  // Show if pickup mode + not yet picked up
  if (mode.includes('pickup') || mode.includes('pick up')) {
    return status === 'ready for pickup' || status === 'ready for pick up';
  }
  return false;
}


canShowRate(order: any): boolean {
  // After the customer action
  const s = this.normalizeStatus(order?.status);
  // If you still have TS complaints about .rated, use !!(order as any).rated
  const rated = !!(order?.rated);
  return (s === 'received' || s === 'picked up') && !rated;
}

  // ────────────────────────────────
  // 🔹 Toast Helpers
  // ────────────────────────────────
  private async showToast(
    message: string,
    color: 'success' | 'warning' | 'danger' | 'medium'
  ) {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2000,
      color,
      position: 'top',
    });
    await toast.present();
  }

  private async presentToast(
    message: string,
    color: 'success' | 'warning' | 'danger' | 'medium' = 'medium'
  ) {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2000,
      color,
      position: 'top',
    });
    await toast.present();
  }

  // ────────────────────────────────
// 🔹 ASAP / Schedule Helpers
// ────────────────────────────────

// ✅ Extract schedule safely from order
getScheduleValue(order: any): string {
  return (
    order?.delivery?.schedule ||
    order?.delivery?.scheduledAt ||
    order?.items?.[0]?.scheduledAt ||
    ''
  );
}

// ✅ Format schedule (handles ASAP properly)
formatSchedule(value: string): string {
  if (!value) return '—';
  return value === 'ASAP' ? 'ASAP (Deliver Now)' : value;
}
}
