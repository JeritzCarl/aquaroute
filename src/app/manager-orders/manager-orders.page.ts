import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, AlertController, ToastController } from '@ionic/angular';
import { RouterModule } from '@angular/router';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  updateDoc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  arrayUnion,
  serverTimestamp,
  query,
  where,
  orderBy,
  Timestamp,
} from '@angular/fire/firestore';
import { Subscription, Observable, map } from 'rxjs';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import { Order, CourierRef } from '../models/order.model';
import { Courier } from '../models/courier.model';
import { UserService } from '../services/user.service';
import { NotificationService } from '../services/notification.service';
import { OrderSyncService } from '../services/order-sync.service';
import { Router } from '@angular/router';


// ✅ Safe local timestamp entry helper
function safeStatusEntry(status: string, by: string) {
  return {
    status,
    changedAt: new Date(),
    by,
  };
}

@Component({
  selector: 'app-manager-orders',
  templateUrl: './manager-orders.page.html',
  styleUrls: ['./manager-orders.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule],
})
export class ManagerOrdersPage implements OnInit, OnDestroy {
  myOrders$: Observable<Order[]> | null = null;
  groupedOrders: { active: Order[]; cancelled: Order[] } = { active: [], cancelled: [] };
  myStationId: string | null = null;
  displayName: string | null = null;

  private subs: Subscription[] = [];
  private ordersSub?: Subscription;

  constructor(
    private firestore: Firestore,
    private auth: Auth,
    private userService: UserService,
    private notificationService: NotificationService,
    private orderSync: OrderSyncService,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
    private router: Router  
  ) {}

private async initOrdersForManager(uid: string, displayName?: string | null) {
  const userRef = doc(this.firestore, `users/${uid}`);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) return;

  const role = userSnap.data()?.['role'];
  if (role !== 'manager') return;

  this.displayName = displayName ?? 'Manager';

  const stationSnap = await getDocs(
    query(collection(this.firestore, 'stations'), where('ownerId', '==', uid))
  );
  if (stationSnap.empty) return;

  this.myStationId = stationSnap.docs[0].id;

const ordersRef = collection(this.firestore, `stations/${this.myStationId}/orders`);

  this.myOrders$ = collectionData(ordersRef, { idField: 'id' }).pipe(
    map((rawOrders: any[]) =>
      rawOrders
        .map((data) => {
          const firstItem = data.items?.[0] || {};

          const delivery = {
            fullName:
              data.delivery?.fullName ||
              data.name ||
              data.customerName ||
              '',
            address:
              data.delivery?.address ||
              data.deliveryAddress ||
              data.address ||
              '',
            phone:
              data.delivery?.phone ||
              data.contact ||
              data.phone ||
              '',
            notes:
              data.delivery?.notes?.trim?.() ||
              data.deliveryNotes ||
              data.notes ||
              data.delivery?.deliveryNotes ||
              data.deliveryInfo?.notes ||
              firstItem.notes ||
              null,
            window:
              data.delivery?.window ||
              data.delivery?.deliveryWindow ||
              data.deliveryWindow ||
              data.window ||
              data.deliveryInfo?.window ||
              firstItem.deliveryWindow ||
              firstItem.window ||
              firstItem.slot ||
              null,
            schedule:
              data.delivery?.schedule ||
              data.delivery?.scheduledAt ||
              data.scheduledAt ||
              data.deliverySchedule ||
              data.delivery?.timeSlot ||
              firstItem.scheduledAt ||
              data.timeSlot ||
              null,
          };

          const mergedDelivery = {
            ...delivery,
            ...(data.delivery || {}),
          };

          const mode = (
            data.mode ||
            firstItem.mode ||
            firstItem.deliveryMode ||
            'delivery'
          ).toString().trim().toLowerCase();

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

            containerSwap:
              data.containerSwap === true ||
              data.containerSwap === 'true' ||
              data.containerSwap === 'Yes' ||
              data.charges?.containerSwap === true ||
              data.items?.[0]?.containerSwap === true ||
              data.items?.[0]?.charges?.containerSwap === true ||
              (Array.isArray(data.stations) && data.stations.some((st: any) => st.containerSwap === true)) ||
              false,
          };

          if (mode === 'pickup') {
            charges.deliveryFee = 0;
            charges.total = charges.subtotal;
          }

          return {
            id: data.id,
            ...data,
            mode,
            delivery: mergedDelivery,
            charges,
          } as Order;
        })
        .sort((a: any, b: any) => {
          const aTime =
            a?.createdAt?.toMillis?.() ??
            (a?.createdAt?.seconds ? a.createdAt.seconds * 1000 : new Date(a?.createdAt || 0).getTime());

          const bTime =
            b?.createdAt?.toMillis?.() ??
            (b?.createdAt?.seconds ? b.createdAt.seconds * 1000 : new Date(b?.createdAt || 0).getTime());

          const aStatus = (a?.status || '').toString();
const bStatus = (b?.status || '').toString();

if (aStatus !== bStatus) {
  return aStatus.localeCompare(bStatus);
}

return bTime - aTime;
        })
    )
  ) as Observable<Order[]>;

  if (this.ordersSub) {
    this.ordersSub.unsubscribe();
  }

  this.ordersSub = this.myOrders$
    .pipe(
      map((orders) => ({
        active: orders.filter(
          (o) => !['Cancelled', 'Archived', 'Delivered', 'Picked Up'].includes(o.status ?? '')
        ),
        cancelled: orders.filter(
          (o) =>
            o.status === 'Cancelled' ||
            o.cancelReason ||
            (o.statusHistory?.some((h: any) => h.status === 'Cancelled'))
        ),
      }))
    )
    .subscribe((groups) => {
      this.groupedOrders = groups;
    });
}

// ────────────────────────────────
// LIFECYCLE
// ────────────────────────────────
async ngOnInit() {
  const authUnsub = onAuthStateChanged(this.auth, async (firebaseUser) => {
    if (!firebaseUser) {
      this.myOrders$ = null;
      this.groupedOrders = { active: [], cancelled: [] };
      return;
    }

    await this.initOrdersForManager(
      firebaseUser.uid,
      firebaseUser.displayName
    );
  });

  this.subs.push({ unsubscribe: authUnsub } as Subscription);
}



private getOrderGallons(order: any): number {
  if (!Array.isArray(order?.items)) return 0;
  return order.items.reduce((sum: number, item: any) => {
    return sum + (Number(item?.quantity) || 0);
  }, 0);
}

private async getCourierAssignedGallons(courierId: string): Promise<number> {
  if (!this.myStationId) return 0;

  const ordersRef = collection(this.firestore, `stations/${this.myStationId}/orders`);
  const snap = await getDocs(ordersRef);

  const activeStatuses = [
    'Assigned to Courier',
    'In Transit',
    'Waiting for Courier',
    'Preparing',
    'Order Confirmed',
    'Pending'
  ];

  let total = 0;

  snap.forEach((docSnap) => {
    const data: any = docSnap.data();
    const assignedId = data?.assignedCourierId || data?.courier?.id || null;
    const status = (data?.status || '').trim();

    if (assignedId === courierId && activeStatuses.includes(status)) {
      total += this.getOrderGallons(data);
    }
  });

  return total;
}

ngOnDestroy(): void {
  this.subs.forEach((s) => s.unsubscribe());
  if (this.ordersSub) {
    this.ordersSub.unsubscribe();
  }
}

// ────────────────────────────────
// STATUS UPDATES (Delivery + Pickup) — Full Cross-Role Sync
// ────────────────────────────────
async updateOrderStatus(
  order: Order,
  nextStatus:
    | 'Order Confirmed'
    | 'Preparing'
    | 'Waiting for Courier'
    | 'Assigned to Courier'
    | 'In Transit'
    | 'Ready for Pickup'
    | 'Delivered'
    | 'Picked Up'
) {
  if (!this.myStationId || !order?.id) return;

  const stationId = this.myStationId;
  const orderRef = doc(this.firestore, `stations/${stationId}/orders/${order.id}`);
  const snap = await getDoc(orderRef);
  if (!snap.exists()) return;

  const data = snap.data() as any;
  const currentStatus: string = data['status'] || 'Pending';
  const mode =
    ((data?.mode || data?.items?.[0]?.mode) || 'delivery')
      .toString()
      .toLowerCase()
      .replace(/\s+/g, '');

  console.log(`🔹 Current → Next: ${currentStatus} → ${nextStatus} [mode: ${mode}]`);

  // ────────────────────────────────
  // Validation of proper sequence
  // ────────────────────────────────
const validFlow =
  mode === 'pickup'
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

  const currentIndex = validFlow.indexOf(currentStatus);
  const nextIndex = validFlow.indexOf(nextStatus);

  if (nextIndex - currentIndex !== 1) {
    await this.showToast(`⚠️ Invalid transition: ${currentStatus} → ${nextStatus}`, 'warning');
    return;
  }

  // ────────────────────────────────
  // Courier check for Delivery mode
  // ────────────────────────────────
if (nextStatus === 'Assigned to Courier' && !data['courier']) {
  await this.showToast('⚠️ Assign a courier first before moving to Assigned to Courier', 'warning');
  return;
}

if (nextStatus === 'In Transit' && !data['courier']) {
  await this.showToast('⚠️ Cannot start delivery without an assigned courier', 'warning');
  return;
}

  // ────────────────────────────────
  // Update both global + station docs
  // ────────────────────────────────
  await this.orderSync.updateOrderStatus(order.id!, stationId, nextStatus, 'manager');

// ────────────────────────────────
// ✅ READY FOR PICKUP — proper sync with mode
// ────────────────────────────────
if (nextStatus === 'Ready for Pickup') {
  const modeValue = 'pickup'; // 🔹 Force mode persistence

  try {
    // 🔹 Base payload for all docs
    const payload = {
      status: nextStatus,
      mode: modeValue,
      lastUpdatedAt: serverTimestamp(),
      statusHistory: arrayUnion({
        status: nextStatus,
        changedAt: new Date(),
        by: this.displayName || 'Manager',
      }),
    };

    const stationOrderRef = doc(this.firestore, `stations/${stationId}/orders/${order.id}`);
    const globalOrderRef  = doc(this.firestore, `orders/${order.id}`);
    const userOrderRef    = doc(this.firestore, `users/${order.userId}/orders/${order.id}`);

    // 🔹 Update everywhere (station, global, user)
    await Promise.allSettled([
      updateDoc(stationOrderRef, payload),
      updateDoc(globalOrderRef, payload),
      updateDoc(userOrderRef, payload),
    ]);

    // 🔹 Fire notification for user
    const notifRef = doc(collection(this.firestore, `users/${order.userId}/notifications`));
    await setDoc(notifRef, {
      type: 'order',
      title: 'Order Ready for Pickup',
      message: `Your order #${order.id} is now ready for pickup at ${order.stationName || 'the station'}.`,
      orderId: order.id,
      createdAt: serverTimestamp(),
      read: false,
    });

    console.log(`📦 Synced Ready for Pickup — mode=${modeValue}`);
    await this.showToast('✅ Order marked Ready for Pickup', 'success');
  } catch (err) {
    console.error('❌ Failed Ready for Pickup sync:', err);
    await this.showToast('⚠️ Failed Ready for Pickup sync', 'danger');
  }
}

  // ────────────────────────────────
  // 🔁 Mirror to user orders
  // ────────────────────────────────
  try {
    await this.orderSync.mirrorToUserOrders(order.id!, nextStatus);
  } catch (err) {
    console.warn('⚠️ Mirror update failed:', err);
  }

  // ────────────────────────────────
  // 🔔 Firestore notifications (User + Manager)
  // ────────────────────────────────
  if (order.userId) {
    await this.notificationService.notifyUserOrderStatus(
      order.userId,
      order.id!,
      nextStatus,
      data?.stationName
    );

    const userOrderRef = doc(this.firestore, `users/${order.userId}/orders/${order.id}`);
    await updateDoc(userOrderRef, {
      status: nextStatus,
      lastUpdatedAt: serverTimestamp(),
      statusHistory: arrayUnion({
        status: nextStatus,
        changedAt: serverTimestamp(),
        by: this.displayName || 'Manager',
      }),
    });
  }

  // 🔔 Manager audit
  if ((this as any).managerId) {
    await this.notificationService.addManagerNotification((this as any).managerId, {
      type: 'system',
      message: `Order #${order.id} updated to ${nextStatus}.`,
      read: false,
    });
  }

  // ────────────────────────────────
  // Notify Manager when Courier marks as Delivered
  // ────────────────────────────────
  if (nextStatus === 'Delivered') {
    const managerId = (this as any).managerId || this.auth.currentUser?.uid;
    if (managerId) {
      await this.notificationService.addManagerNotification(managerId, {
        type: 'delivery',
        subtype: 'courierUpdate',
        message: `🚚 Courier marked order #${order.id} as Delivered.`,
        read: false,
        createdAt: serverTimestamp(),
      });
    }
  }

  // ────────────────────────────────
  // Auto-archive once final step hit
  // ────────────────────────────────
  const isFinal =
    (mode === 'delivery' && nextStatus === 'Delivered') ||
    (mode === 'pickup' && nextStatus === 'Picked Up');

  if (isFinal) {
    console.log('📦 Archiving process started for', order.id);
    try {
      const latestSnap = await getDoc(orderRef);
      if (!latestSnap.exists()) return;

      const latest = latestSnap.data() as any;

      const createdMs =
        latest?.createdAt?.toMillis?.() ??
        (latest?.createdAt?.seconds ? latest.createdAt.seconds * 1000 : undefined);
      const completedMs =
        latest?.completedAt?.toMillis?.() ??
        (latest?.completedAt?.seconds ? latest.completedAt.seconds * 1000 : Date.now());
      const durationMinutes =
        createdMs && completedMs && completedMs > createdMs
          ? Math.round((completedMs - createdMs) / 60000)
          : null;

      const archivedRef = doc(this.firestore, `stations/${stationId}/archivedOrders/${order.id}`);
      const completedAtFinal =
        latest?.completedAt?.toMillis?.() ||
        latest?.completedAt?.seconds
          ? latest.completedAt
          : Timestamp.now();

      await setDoc(
        archivedRef,
        {
          ...latest,
          archived: true,
          status: 'archived',
          archivedAt: serverTimestamp(),
          completedAt: completedAtFinal,
          deliveredAt: completedAtFinal,
          archivedBy: this.displayName || 'Manager',
          deliveredBy: latest?.courier?.name || 'Unknown Courier',
          stationId,
          totalAmount: latest?.charges?.total ?? 0,
          durationMinutes,
        },
        { merge: true }
      );

      await deleteDoc(orderRef);
      await this.showToast(`📦 Order ${order.id} archived successfully`, 'success');
    } catch (err) {
      console.error('❌ Auto-archive failed:', err);
      await this.showToast('⚠️ Failed to archive delivered/picked-up order', 'danger');
    }
  } else {
    await this.showToast(`✅ Order set to ${nextStatus}`, 'success');
  }
}

async movePreparingOrderToCourierQueue(order: Order): Promise<void> {
  if (!this.myStationId || !order?.id) return;

  const stationId = this.myStationId;
  const stationOrderRef = doc(this.firestore, `stations/${stationId}/orders/${order.id}`);
  const globalOrderRef = doc(this.firestore, `orders/${order.id}`);
  const userOrderRef = doc(this.firestore, `users/${order.userId}/orders/${order.id}`);

  const payload = {
    status: 'Waiting for Courier',
    lastUpdatedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    statusHistory: arrayUnion({
      status: 'Waiting for Courier',
      changedAt: new Date(),
      by: this.displayName || 'Manager',
    }),
  };

  try {
    await Promise.all([
      updateDoc(stationOrderRef, payload),
      updateDoc(globalOrderRef, payload),
      updateDoc(userOrderRef, payload),
    ]);

    if (order.userId) {
      await this.notificationService.notifyUserOrderStatus(
        order.userId,
        order.id!,
        'Waiting for Courier',
        (order as any)?.stationName || stationId
      );
    }

    await this.showToast('✅ Order moved to Waiting for Courier', 'success');
  } catch (err) {
    console.error('❌ Failed to move order to Waiting for Courier:', err);
    await this.showToast('⚠️ Failed to update order queue status', 'danger');
  }
}

  // ────────────────────────────────
  // ASSIGN COURIER
  // ────────────────────────────────
  async openAssignCourier(order: Order): Promise<void> {
  if (!this.myStationId) return;

  const couriersRef = collection(this.firestore, `stations/${this.myStationId}/couriers`);
  const snapshot = await getDocs(couriersRef);
  const allCouriers = snapshot.docs.map((d: any) => ({ id: d.id, ...d.data() }));

  if (!allCouriers.length) {
    await this.showToast('⚠️ No couriers available. Add one first.', 'warning');
    return;
  }

  const orderGallons = this.getOrderGallons(order);

  const courierLoads = await Promise.all(
    allCouriers.map(async (c: any) => {
      const currentGallons = await this.getCourierAssignedGallons(c.id);
      const remainingCapacity = 10 - currentGallons;
      const canTakeOrder = remainingCapacity >= orderGallons;

      return {
        ...c,
        currentGallons,
        remainingCapacity,
        canTakeOrder,
      };
    })
  );

  const availableCouriers = courierLoads.filter((c) => c.canTakeOrder);

  if (!availableCouriers.length) {
    await this.showToast(
      `⚠️ No courier available. This order needs ${orderGallons} gallon(s), but all couriers are at full capacity.`,
      'warning'
    );
    return;
  }

  const alert = await this.alertCtrl.create({
    header: 'Assign Courier',
    inputs: availableCouriers.map((c: any) => ({
      type: 'radio',
      label: `${c.name} (${c.vehicle}) — Load: ${c.currentGallons}/10 gal`,
      value: c,
    })),
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Assign',
        handler: async (selectedCourier: Courier) => {
          if (!selectedCourier) {
            await this.showToast('⚠️ Please select a courier.', 'warning');
            return false;
          }
          await this.assignCourier(order, selectedCourier);
          return true;
        },
      },
    ],
  });

  await alert.present();
}


// ────────────────────────────────
// ASSIGN COURIER — Full Cross-Role, Non-Destructive Status
// ────────────────────────────────
async assignCourier(order: Order, courier: Courier): Promise<void> {
  if (!this.myStationId || !order?.id) return;
  if (!courier?.id) {
    await this.showToast('⚠️ Courier record missing ID.', 'danger');
    return;
  }

  const stationId = this.myStationId;
  const orderRef = doc(this.firestore, `stations/${stationId}/orders/${order.id}`);

  // 🔹 Build courier reference data
  const courierRefData: CourierRef = {
    id: courier.id!,
    name: courier.name,
    vehicle: courier.vehicle,
    eta: courier.eta || null,
    assignedAt: Timestamp.now().toDate(),
  };

// 🔹 Update station order
await updateDoc(orderRef, {
  courier: courierRefData,
  assignedCourierId: courier.id!,
  courierAssigned: true,
  status: 'Assigned to Courier',
  lastUpdatedAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  statusHistory: arrayUnion(
    safeStatusEntry('Assigned to Courier', this.displayName || 'Manager')
  ),
});

// 🔹 Update global order
const globalOrderRef = doc(this.firestore, `orders/${order.id}`);
await updateDoc(globalOrderRef, {
  courier: courierRefData,
  assignedCourierId: courier.id!,
  courierAssigned: true,
  status: 'Assigned to Courier',
  lastUpdatedAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  statusHistory: arrayUnion(
    safeStatusEntry('Assigned to Courier', this.displayName || 'Manager')
  ),
});

  // 🔹 Update courier document
  const courierDoc = doc(this.firestore, `stations/${stationId}/couriers/${courier.id!}`);
  await updateDoc(courierDoc, {
    lastAssignedOrder: order.id,
    assignedAt: serverTimestamp(),
  });

  // 🔔 Notify courier (assignment)
  await this.notificationService.sendCourierAssignment(courier.id!, order.id!);

// 🔔 Notify user + mirror assigned status
if (order.userId) {
  await this.notificationService.notifyUserOrderStatus(
    order.userId,
    order.id!,
    'Assigned to Courier',
    (order as any)?.stationName || this.myStationId || 'AquaRoute Station'
  );

  const userOrderRef = doc(this.firestore, `users/${order.userId}/orders/${order.id}`);
  await updateDoc(userOrderRef, {
    courierAssigned: true,
    status: 'Assigned to Courier',
    lastUpdatedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    statusHistory: arrayUnion({
      status: 'Assigned to Courier',
      changedAt: serverTimestamp(),
      by: this.displayName || 'Manager',
    }),
  });
}

  // 🔔 Manager self notification (for audit trail)
  if ((this as any).managerId) {
    await this.notificationService.addManagerNotification((this as any).managerId, {
      type: 'assignment',
      message: `Assigned ${courier.name} to order #${order.id}`,
      relatedId: order.id,
      read: false,
    });
  }

  // ✅ Final confirmation
  await this.showToast(`✅ Assigned ${courier.name} to order ${order.id}`, 'success');
}

async confirmPayment(order: any) {
  if (!this.myStationId || !order?.id) return;

  const stationPath = `stations/${this.myStationId}/orders/${order.id}`;
  const globalPath = `orders/${order.id}`;
  const userPath = `users/${order.userId}/orders/${order.id}`;

  try {
    await updateDoc(doc(this.firestore, stationPath), {
      'payment.status': 'Paid',
      'payment.verifiedAt': serverTimestamp(),
      'payment.verifiedBy': this.displayName || 'Manager',
      lastUpdatedAt: serverTimestamp(),
      statusHistory: arrayUnion({
        status: 'Payment Confirmed',
        changedAt: new Date(),
        by: this.displayName || 'Manager',
      }),
    }).catch(() => {});

    await updateDoc(doc(this.firestore, globalPath), {
      'payment.status': 'Paid',
      'payment.verifiedAt': serverTimestamp(),
      'payment.verifiedBy': this.displayName || 'Manager',
      lastUpdatedAt: serverTimestamp(),
      statusHistory: arrayUnion({
        status: 'Payment Confirmed',
        changedAt: new Date(),
        by: this.displayName || 'Manager',
      }),
    }).catch(() => {});

    await updateDoc(doc(this.firestore, userPath), {
      'payment.status': 'Paid',
      'payment.verifiedAt': serverTimestamp(),
      'payment.verifiedBy': this.displayName || 'Manager',
      lastUpdatedAt: serverTimestamp(),
      statusHistory: arrayUnion({
        status: 'Payment Confirmed',
        changedAt: new Date(),
        by: this.displayName || 'Manager',
      }),
    }).catch(() => {});

    await this.showToast('✅ Payment confirmed', 'success');
  } catch (err) {
    console.error('❌ Confirm payment failed:', err);
    await this.showToast('⚠️ Failed to confirm payment', 'danger');
  }
}

async rejectPayment(order: any) {
  if (!this.myStationId || !order?.id) return;

  const stationPath = `stations/${this.myStationId}/orders/${order.id}`;
  const globalPath = `orders/${order.id}`;
  const userPath = `users/${order.userId}/orders/${order.id}`;

  try {
    await updateDoc(doc(this.firestore, stationPath), {
      'payment.status': 'Rejected',
      'payment.verifiedAt': serverTimestamp(),
      'payment.verifiedBy': this.displayName || 'Manager',
      lastUpdatedAt: serverTimestamp(),
      statusHistory: arrayUnion({
        status: 'Payment Rejected',
        changedAt: new Date(),
        by: this.displayName || 'Manager',
      }),
    }).catch(() => {});

    await updateDoc(doc(this.firestore, globalPath), {
      'payment.status': 'Rejected',
      'payment.verifiedAt': serverTimestamp(),
      'payment.verifiedBy': this.displayName || 'Manager',
      lastUpdatedAt: serverTimestamp(),
      statusHistory: arrayUnion({
        status: 'Payment Rejected',
        changedAt: new Date(),
        by: this.displayName || 'Manager',
      }),
    }).catch(() => {});

    await updateDoc(doc(this.firestore, userPath), {
      'payment.status': 'Rejected',
      'payment.verifiedAt': serverTimestamp(),
      'payment.verifiedBy': this.displayName || 'Manager',
      lastUpdatedAt: serverTimestamp(),
      statusHistory: arrayUnion({
        status: 'Payment Rejected',
        changedAt: new Date(),
        by: this.displayName || 'Manager',
      }),
    }).catch(() => {});

    await this.showToast('🚫 Payment rejected', 'danger');
  } catch (err) {
    console.error('❌ Reject payment failed:', err);
    await this.showToast('⚠️ Failed to reject payment', 'warning');
  }
}

// ────────────────────────────────
// 🔹 Decline Order — Full Safe Cross-Sync
// ────────────────────────────────
async declineOrder(order: Order): Promise<void> {
  if (!this.myStationId || !order?.id) {
    await this.showToast('⚠️ Missing station or order ID', 'warning');
    return;
  }

  const alert = await this.alertCtrl.create({
    header: 'Decline Order',
    message: 'Are you sure you want to decline this order?',
    inputs: [
      { name: 'reason', type: 'text', placeholder: 'Reason (optional)' },
    ],
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Decline',
        handler: async (data) => {
          const reason = data.reason?.trim() || 'Order declined by the station';
          const stationId = this.myStationId;

          const updatePayload = {
            status: 'Declined',
            declineReason: reason,
            declinedAt: serverTimestamp(),
            lastUpdatedAt: serverTimestamp(),
            statusHistory: arrayUnion({
              status: 'Declined',
              changedAt: new Date(),
              by: this.displayName || 'Manager',
              reason,
            }),
          };

          try {
            // 🔹 Firestore paths
            const orderRef = doc(this.firestore, `stations/${stationId}/orders/${order.id}`);
            const archivedRef = doc(this.firestore, `stations/${stationId}/archivedOrders/${order.id}`);
            const globalOrderRef = doc(this.firestore, `orders/${order.id}`);
            const userOrderRef = order.userId
              ? doc(this.firestore, `users/${order.userId}/orders/${order.id}`)
              : null;

            // 🔹 Safe writes (merge existing data)
            await setDoc(archivedRef, { ...order, ...updatePayload, archived: true }, { merge: true });
            await setDoc(orderRef, { ...order, ...updatePayload }, { merge: true }).catch(() => {});
            await setDoc(globalOrderRef, { ...order, ...updatePayload }, { merge: true }).catch(() => {});
            if (userOrderRef) await setDoc(userOrderRef, { ...order, ...updatePayload }, { merge: true }).catch(() => {});

            // 🔹 Cleanup (delete active order after archiving)
            await deleteDoc(orderRef).catch(() => {});

            // 🔔 Notify user
            if (order.userId) {
              await this.notificationService.addUserNotification(order.userId, {
                type: 'order',
                subtype: 'declined',
                title: 'Order Declined',
                message: `Your order #${order.id} was declined by ${order.stationName || 'the station'}.`,
                body: reason,
                orderId: order.id,
                read: false,
                createdAt: serverTimestamp(),
                actionRoute: '/orders',
              });
            }

            // 🔔 Manager audit — safe guard (managerId may not exist)
            const managerId = (this as any).managerId || this.auth.currentUser?.uid;
            if (managerId) {
              await this.notificationService.addManagerNotification(managerId, {
                type: 'system',
                subtype: 'decline',
                message: `Order #${order.id} was declined (${reason}).`,
                read: false,
                createdAt: serverTimestamp(),
              });
            }

            await this.showToast(`🚫 Order #${order.id} declined successfully`, 'danger');
          } catch (err) {
            console.error('❌ Decline failed:', err);
            await this.showToast('⚠️ Failed to decline order', 'warning');
          }
        },
      },
    ],
  });

  await alert.present();
}

async deleteInvalidOrder(order: Order): Promise<void> {
  if (!this.myStationId || !order?.id) {
    await this.showToast('⚠️ Missing station or order ID', 'warning');
    return;
  }

  const alert = await this.alertCtrl.create({
    header: 'Delete Invalid Order',
    message: `Are you sure you want to permanently delete order #${order.id}?`,
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Delete',
        role: 'destructive',
        handler: async () => {
          try {
            const stationId = this.myStationId!;
            const stationOrderRef = doc(this.firestore, `stations/${stationId}/orders/${order.id}`);
            const globalOrderRef = doc(this.firestore, `orders/${order.id}`);
            const userOrderRef = order.userId
              ? doc(this.firestore, `users/${order.userId}/orders/${order.id}`)
              : null;

            await deleteDoc(stationOrderRef).catch(() => {});
            await deleteDoc(globalOrderRef).catch(() => {});
            if (userOrderRef) await deleteDoc(userOrderRef).catch(() => {});

            const managerId = this.auth.currentUser?.uid;
            if (managerId) {
              await this.notificationService.addManagerNotification(managerId, {
                type: 'system',
                subtype: 'delete_invalid',
                message: `Invalid order #${order.id} was permanently deleted.`,
                read: false,
                createdAt: serverTimestamp(),
              });
            }

            this.groupedOrders = {
              active: this.groupedOrders.active.filter((o) => o.id !== order.id),
              cancelled: this.groupedOrders.cancelled.filter((o) => o.id !== order.id),
            };

            await this.showToast(`🗑️ Order #${order.id} deleted`, 'success');
          } catch (err) {
            console.error('❌ Delete invalid order failed:', err);
            await this.showToast('⚠️ Failed to delete invalid order', 'danger');
          }
        },
      },
    ],
  });

  await alert.present();
}

async closePopoverAndDelete(order: Order, event: any) {
  // close the popover first
  const popover = event.target.closest('ion-popover');
  if (popover) {
    await (popover as any).dismiss();
  }

  // then run delete
  await this.deleteInvalidOrder(order);
}

  // ────────────────────────────────
// UTIL: Get mode safely (delivery/pickup)
// ────────────────────────────────
getOrderMode(order: Order): 'delivery' | 'pickup' {
  if (!order) return 'delivery';
  const itemMode =
    order.items?.[0]?.mode ||
    order.items?.[0]?.deliveryMode ||
    (order.delivery?.schedule?.toLowerCase().includes('pickup') ? 'pickup' : null);
  const topMode = order.mode;
  return (itemMode || topMode || 'delivery').toLowerCase() === 'pickup'
    ? 'pickup'
    : 'delivery';
}

// ───────────────────────────────
// Style class for order status chip
// ───────────────────────────────
statusClass(status: string): string {
  if (!status) return '';
  const key = status.toLowerCase().replace(/\s+/g, '-');
  return key; // example: "ready-for-pickup", "out-for-delivery"
}

  // ────────────────────────────────
  // UI helpers
  // ────────────────────────────────
  public chipColor(status: string): string {
    if (!status) return 'medium';
    const s = status.toLowerCase();
    if (s.includes('pending') || s.includes('new')) return 'warning';
    if (s.includes('confirm')) return 'primary';
    if (s.includes('prepar')) return 'secondary';
    if (s.includes('pickup') && !s.includes('picked')) return 'purple';
    if (s.includes('out for delivery')) return 'tertiary';
    if (s.includes('deliver') || s.includes('picked')) return 'success';
    if (s.includes('cancel')) return 'danger';
    return 'medium';
  }

  private async showToast(message: string, color: 'success' | 'warning' | 'danger') {
    const toast = await this.toastCtrl.create({ message, duration: 2000, color });
    await toast.present();
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

getWaterType(order: any): string {
  if (!order?.items?.length) return '—';
  const types = order.items
    .map((i: any) => i.waterType || i.type)
    .filter(Boolean);
  const unique = [...new Set(types)];
  return unique.length ? unique.join(', ') : '—';
}

getNotesValue(order: any): string {
  if (order?.delivery?.notes && order.delivery.notes.trim() !== '')
    return order.delivery.notes;
  if (order?.items?.length && (order.items[0] as any).notes)
    return (order.items[0] as any).notes;
  return '—';
}


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

openProof(url: string) {
  window.open(url, '_blank');
}
}
