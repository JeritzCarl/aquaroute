// src/app/services/courier.service.ts
import { Injectable } from '@angular/core';
import {
  Firestore,
  collectionGroup,
  getDocs,
  query,
  where,
  doc,
  collection,
  collectionData,
  updateDoc,
  setDoc,
  arrayUnion,
  serverTimestamp,
  onSnapshot,
} from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { OrderSyncService } from './order-sync.service';

type LocationQueueItem = {
  stationId: string;
  courierId: string;
  userId: string;   // courier’s auth uid (for global mirror)
  lat: number;
  lng: number;
  ts: number;
};

@Injectable({ providedIn: 'root' })
export class CourierService {
  // 🔁 Local queue used when you call queueLocationUpdate
  private locationQueue: LocationQueueItem[] = [];
  private flushTimer: any = null;

  constructor(
  private db: Firestore,
  private auth: Auth,
  private orderSync: OrderSyncService
) {}

  // 🔑 1) Find courier’s station + profile
  async getCourierStationAndProfile(uid: string) {
    const cg = collectionGroup(this.db, 'couriers');
    const qByUid = query(cg, where('uid', '==', uid));
    const rs = await getDocs(qByUid);

    if (!rs.empty) {
      const d = rs.docs[0];
      const stationId = d.ref.parent.parent?.id || null;
      const courierId = d.id;
      const data = d.data() as any;

      // 🔹 Ensure photoUrl is returned
      let photoUrl = data?.photoUrl || null;
      const user = this.auth.currentUser;
      if (!photoUrl && user?.photoURL) {
        photoUrl = user.photoURL;
      }

      return {
        stationId,
        courierId,
        name: data?.name || user?.displayName || 'Courier',
        stationName: data?.stationName || 'Station',
        phone: data?.phone || null,
        email: user?.email || null,
        photoUrl,
        ...data,
      };
    }

    return null;
  }

// 📦 Load assigned orders for courier (multi-courier compatible)
getAssignedOrders(stationId: string, courierId: string): Observable<any[]> {
  const ordersRef = collection(this.db, `stations/${stationId}/orders`);

  // 🔹 Match either assignedCourierId OR couriers array (multi-courier)
  const q1 = query(ordersRef, where('assignedCourierId', '==', courierId));
  const q2 = query(ordersRef, where('couriers', 'array-contains', courierId));

  // 🔹 Merge both observables manually
  const obs1 = collectionData(q1, { idField: 'id' });
  const obs2 = collectionData(q2, { idField: 'id' });

  return new Observable<any[]>((subscriber) => {
    let sub2: any;

    const sub1 = obs1.subscribe({
      next: (a) => {
        const seen = new Set(a.map((o: any) => o.id));

        sub2 = obs2.subscribe({
          next: (b) => {
            const merged = [...a, ...b.filter((o: any) => !seen.has(o.id))];

            subscriber.next(
              merged.map((o: any) => {
                const delivery = o['delivery'] || {};
                const flatAddress = delivery['address'] || o['address'] || null;
                const customerName =
                  delivery['fullName'] || o['customerName'] || 'Customer';

                return {
                  ...o,
                  flatAddress,
                  customerName,
                };
              })
            );
          },
          error: (err) => subscriber.error(err),
        });
      },
      error: (err) => subscriber.error(err),
    });

    // 🔹 Cleanup both subscriptions when unsubscribed
    return () => {
      sub1.unsubscribe();
      if (sub2) sub2.unsubscribe();
    };
  });
}

// ✅ Load archived (delivered) orders for courier metrics
getArchivedOrders(stationId: string, courierId: string): Observable<any[]> {
  const archivedRef = collection(
    this.db,
    `stations/${stationId}/couriers/${courierId}/archivedOrders`
  );
  return collectionData(archivedRef, { idField: 'id' });
}

// 🚚 3) Update order status
async updateOrderStatus(
  stationId: string,
  orderId: string,
  courierName: string,
  nextStatus: 'Out for Delivery' | 'Delivered',
  note?: string
) {
  const ref = doc(this.db, `stations/${stationId}/orders/${orderId}`);
  await updateDoc(ref, {
    status: nextStatus,
    lastUpdatedAt: serverTimestamp(),
    statusHistory: arrayUnion({
      status: nextStatus,
      changedAt: new Date(), // ✅ FIXED — use JS Date instead
      by: courierName,
      note: note || null,
    }),
  });
  // 🔁 Mirror status to user's orders for consistency
await this.orderSync.mirrorToUserOrders(orderId, nextStatus);
}

  // 📍 4a) Direct live update (station-scoped)
  async updateCourierLocation(stationId: string, courierId: string, lat: number, lng: number) {
    const courierRef = doc(this.db, `stations/${stationId}/couriers/${courierId}`);
    await setDoc(
      courierRef,
      {
        lat,
        lng,
        updatedAt: serverTimestamp(),
        active: true,
      },
      { merge: true }
    );
  }

  // 📍 4b) **Unified flush** that ALSO mirrors to global `couriers/{userId}`
  async flushLocationUpdate(
    stationId: string,
    courierId: string,
    userId: string, // courier’s auth uid (for user-side tracking)
    lat: number,
    lng: number
  ) {
    // 1) Update station-scoped courier document
    const stationCourierRef = doc(this.db, `stations/${stationId}/couriers/${courierId}`);
    await setDoc(
      stationCourierRef,
      {
        lat,
        lng,
        updatedAt: serverTimestamp(),
        active: true,
      },
      { merge: true }
    );

    // 2) Mirror into global `couriers/{uid}` for Track-Order page (customer view)
    const globalCourierRef = doc(this.db, `couriers/${userId}`);
    await setDoc(
      globalCourierRef,
      {
        stationId,
        courierId,
        lat,
        lng,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  // 📍 4c) Queue + Throttle (use this if you want service-managed throttling)
  queueLocationUpdate(
    stationId: string,
    courierId: string,
    userId: string,
    lat: number,
    lng: number
  ) {
    this.locationQueue.push({ stationId, courierId, userId, lat, lng, ts: Date.now() });

    // Lazy start timer if not running
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flushQueuedLocation(), 10000); // flush every 10s
    }
  }

  private async flushQueuedLocation() {
    if (!this.locationQueue.length) {
      this.flushTimer = null;
      return;
    }

    // Keep only the most recent item
    const latest = this.locationQueue[this.locationQueue.length - 1];
    this.locationQueue = [];

    try {
      await this.flushLocationUpdate(
        latest.stationId,
        latest.courierId,
        latest.userId,
        latest.lat,
        latest.lng
      );
      console.log(
        `✅ Flushed courier location → Lat: ${latest.lat}, Lng: ${latest.lng} (station ${latest.stationId})`
      );
    } catch (err) {
      console.error('⚠️ Failed to flush courier location:', err);
    } finally {
      this.flushTimer = null;
    }
  }

  // 🗺️ 5) Update active orders with live courier location (inline fields)
  async updateActiveOrderLocation(stationId: string, orderId: string, lat: number, lng: number) {
    const orderRef = doc(this.db, `stations/${stationId}/orders/${orderId}`);
    await updateDoc(orderRef, {
      'courier.lat': lat,
      'courier.lng': lng,
      'courier.lastUpdated': serverTimestamp(),
    });
  }

  // 🔔 6) Listen for new assignments written to the courier doc
  listenForNewAssignments(
    stationId: string,
    courierId: string,
    callback: (orderId: string) => void
  ) {
    const courierRef = doc(this.db, `stations/${stationId}/couriers/${courierId}`);
    return onSnapshot(courierRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data() as any;
        if (data?.lastAssignedOrder) {
          callback(data.lastAssignedOrder);
        }
      }
    });
  }
}
