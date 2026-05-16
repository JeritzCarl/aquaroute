import { Injectable } from '@angular/core';
import {
  Firestore,
  doc,
  updateDoc,
  arrayUnion,
  serverTimestamp,
  getDoc,
  setDoc,
} from '@angular/fire/firestore';
import { NotificationService } from './notification.service';

interface StatusEntry {
  status: string;
  changedAt: any;
  by: 'user' | 'manager' | 'courier' | 'system';
}

@Injectable({ providedIn: 'root' })
export class OrderSyncService {
  constructor(
    private firestore: Firestore,
    private notificationService: NotificationService
  ) {}

  // ────────────────────────────────
  // UPDATE ORDER STATUS — FULL CROSS-ROLE SYNC
  // ────────────────────────────────
  async updateOrderStatus(
    orderId: string,
    stationId: string | null,
    newStatus: string,
    by: 'user' | 'manager' | 'courier' | 'system' = 'system'
  ): Promise<void> {
    if (!orderId) throw new Error('Order ID is required');

    const entry: StatusEntry = {
      status: newStatus,
      changedAt: new Date(),
      by,
    };

    const globalRef = doc(this.firestore, `orders/${orderId}`);
    const stationRef = stationId
      ? doc(this.firestore, `stations/${stationId}/orders/${orderId}`)
      : null;

    try {
      const globalSnap = await getDoc(globalRef);
      if (!globalSnap.exists()) {
        await setDoc(globalRef, { id: orderId, status: newStatus, createdAt: serverTimestamp() });
      }

      if (stationRef) {
        const stSnap = await getDoc(stationRef);
        if (!stSnap.exists()) {
          await setDoc(stationRef, { id: orderId, status: newStatus, createdAt: serverTimestamp() });
        }
      }

      const payload = {
        status: newStatus,
        updatedAt: serverTimestamp(),
        statusHistory: arrayUnion(entry),
      };

      await updateDoc(globalRef, payload);
      if (stationRef) await updateDoc(stationRef, payload);

      console.log(`✅ Synced status "${newStatus}" → global + station`);

      if (by === 'user' && newStatus.toLowerCase() === 'pending' && stationId) {
        const stationSnap = await getDoc(doc(this.firestore, `stations/${stationId}`));
        if (stationSnap.exists()) {
          const stationData = stationSnap.data();
          const managerId = stationData['ownerId'];
          const stationName = stationData['name'] || 'AquaRoute Station';
          const orderSnap = await getDoc(globalRef);
          let customerName = 'a customer';
          if (orderSnap.exists()) {
            const orderData = orderSnap.data() as any;
            customerName =
              orderData.delivery?.fullName ||
              orderData.name ||
              orderData.customerName ||
              'a customer';
          }
          if (managerId) {
            await this.notificationService.addManagerNotification(managerId, {
              type: 'new_order',
              message: `📦 New order received from ${customerName} for ${stationName}.`,
              relatedId: orderId,
              read: false,
              createdAt: serverTimestamp(),
            });
            console.log(`📩 Manager (${managerId}) notified of new order ${orderId}`);
          }
        }
      }
    } catch (err) {
      console.error('❌ Failed to sync order status:', err);
      throw err;
    }
  }

  // ────────────────────────────────
  // Mirror order status to user's orders collection
  // ────────────────────────────────
  async mirrorToUserOrders(orderId: string, newStatus: string, by: string = 'Courier') {
    try {
      const globalRef = doc(this.firestore, `orders/${orderId}`);
      const snap = await getDoc(globalRef);
      if (!snap.exists()) {
        console.warn(`[mirrorToUserOrders] Missing global order ${orderId}`);
        return;
      }

      const data = snap.data() as any;
      const userId = data.userId || data.customerId;
      if (!userId) {
        console.warn(`[mirrorToUserOrders] No userId for order ${orderId}`);
        return;
      }

      const userOrderRef = doc(this.firestore, `users/${userId}/orders/${orderId}`);
      const payload = {
        status: newStatus,
        updatedAt: serverTimestamp(),
        lastUpdatedAt: serverTimestamp(),
        statusHistory: arrayUnion({
          status: newStatus,
          changedAt: new Date(),
          by,
        }),
      };

      const snapUser = await getDoc(userOrderRef);
      if (snapUser.exists()) {
        await updateDoc(userOrderRef, payload);
      } else {
        await setDoc(userOrderRef, { ...data, ...payload }, { merge: true });
      }

      console.log(`👥 Synced user order ${orderId} → ${newStatus}`);
    } catch (err) {
      console.error('❌ mirrorToUserOrders() failed:', err);
    }
  }

  // ────────────────────────────────
  // 🔔 Notify Manager on Delivery
  // ────────────────────────────────
  async notifyManagerOfDelivery(managerId: string, courierName: string, orderId: string) {
    if (!managerId) return;
    await this.notificationService.addManagerNotification(managerId, {
      type: 'delivery_update',
      message: `🚚 Courier ${courierName} marked order #${orderId} as delivered.`,
      relatedId: orderId,
      read: false,
      createdAt: serverTimestamp(),
    });
  }
}
