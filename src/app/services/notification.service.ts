import { Injectable } from '@angular/core';
import {
  PushNotifications,
  Token,
  PushNotificationSchema,
  ActionPerformed,
} from '@capacitor/push-notifications';

import {
  Firestore,
  collection,
  collectionData,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  serverTimestamp,
  query,
  where,
  orderBy,
  writeBatch,
  addDoc,
  onSnapshot 
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import { BehaviorSubject } from 'rxjs';


export interface UserNotification {
  id?: string;
  type?: string;
  subtype?: string;
  title?: string;
  message?: string;
  body?: string;
  read?: boolean;
  timestamp?: any;
  createdAt?: any;
  status?: string;

  orderId?: string;
  relatedId?: string;
  actionRoute?: string;
  stationId?: string;

  proofImageUrl?: string;
}



type Role = 'user' | 'courier' | 'manager' | 'station' | 'admin';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private enabled = true;
  private pushToken: string | null = null;
  private unreadCountSubject = new BehaviorSubject<number>(0);
  readonly unreadCount$ = this.unreadCountSubject.asObservable();
  private unreadUnsub?: () => void;


constructor(private firestore: Firestore, private auth: Auth) {
  const saved = localStorage.getItem('pushNotifications');
  this.enabled = saved !== null ? saved === 'true' : true;

  onAuthStateChanged(this.auth, (user) => {
    this.unreadUnsub?.();

    if (!user) {
      this.unreadCountSubject.next(0);
      return;
    }

    this.listenToUnread(user.uid);
  });
}


  /* ─────────────────────────────
   * ENABLE / DISABLE (persisted)
   * ────────────────────────────*/
  setEnabled(value: boolean) {
    this.enabled = value;
    localStorage.setItem('pushNotifications', String(value));
  }
  isEnabled(): boolean {
    return this.enabled;
  }

  /* ─────────────────────────────
   * PUSH INITIALIZATION
   * ────────────────────────────*/
  async initPush(): Promise<void> {
    if (!this.enabled) return;
    try {
      const perm = await PushNotifications.requestPermissions();
      if (perm.receive !== 'granted') return;

      await PushNotifications.register();

      PushNotifications.addListener('registration', (t: Token) => {
        this.pushToken = t.value;
      });
      PushNotifications.addListener('registrationError', (e) =>
        console.error('❌ Push registration error', e)
      );
      PushNotifications.addListener('pushNotificationReceived', (n: PushNotificationSchema) =>
        console.log('📩 Push received:', n)
      );
      PushNotifications.addListener('pushNotificationActionPerformed', (a: ActionPerformed) =>
        console.log('📲 Push action performed:', a)
      );
    } catch (e) {
      console.error('⚠️ Push init failed:', e);
    }
  }

  /* ─────────────────────────────
   * USER NOTIFICATIONS
   * ────────────────────────────*/
  listenToUserNotifications(userId: string): Observable<UserNotification[]> {
    const ref = collection(this.firestore, `users/${userId}/notifications`);
    const qy = query(ref, orderBy('createdAt', 'desc'));
    return collectionData(qy, { idField: 'id' }) as Observable<UserNotification[]>;
  }

  async addUserNotification(
    userId: string,
    data: Omit<UserNotification, 'id' | 'timestamp' | 'read'> & { read?: boolean }
  ): Promise<void> {
    const notifRef = doc(collection(this.firestore, `users/${userId}/notifications`));
    await setDoc(notifRef, {
      ...data,
      read: data.read ?? false,
      createdAt: serverTimestamp(),
    });
  }

  async markAsRead(userId: string, notifId: string): Promise<void> {
    const ref = doc(this.firestore, `users/${userId}/notifications/${notifId}`);
    await updateDoc(ref, { read: true });
  }

  async deleteUserNotification(userId: string, notifId: string): Promise<void> {
    await deleteDoc(doc(this.firestore, `users/${userId}/notifications/${notifId}`));
    console.log(`🗑️ Notification ${notifId} deleted for user ${userId}`);
  }

  /* ─────────────────────────────
   * COURIER NOTIFICATIONS
   * ────────────────────────────*/
  listenToCourierNotifications(courierId: string): Observable<UserNotification[]> {
    const ref = collection(this.firestore, `couriers/${courierId}/notifications`);
    const qy = query(ref, orderBy('createdAt', 'desc'));
    return collectionData(qy, { idField: 'id' }) as Observable<UserNotification[]>;
  }

  async sendCourierAssignment(courierId: string, orderId: string): Promise<void> {
    const notifRef = doc(this.firestore, `couriers/${courierId}/notifications/${orderId}`);
    await setDoc(notifRef, {
      type: 'assignment',
      message: `You have been assigned order #${orderId}`,
      relatedId: orderId,
      createdAt: serverTimestamp(),
      read: false,
    });

    await this.sendPush({
      title: '🚚 New Delivery Assigned',
      body: `You have been assigned order #${orderId}`,
      topic: `courier_${courierId}`,
      orderId,
    });
  }

/* ─────────────────────────────
 * MANAGER NOTIFICATIONS (STATION-SCOPED)
 * ────────────────────────────*/
listenToManagerNotifications(stationId: string): Observable<UserNotification[]> {
  const ref = collection(this.firestore, `stations/${stationId}/notifications`);
  const qy = query(ref, orderBy('createdAt', 'desc'));
  return collectionData(qy, { idField: 'id' }) as Observable<UserNotification[]>;
}

async addManagerNotification(
  stationId: string,
  data: Omit<UserNotification, 'id'> & { createdAt?: any }
) {
  const notifRef = doc(collection(this.firestore, `stations/${stationId}/notifications`));
  await setDoc(notifRef, {
    ...data,
    read: data.read ?? false,
    createdAt: serverTimestamp(),
  });
}

async notifyManagerNewOrder(
  stationId: string,
  orderId: string,
  customerName: string
): Promise<void> {
  const notifRef = doc(collection(this.firestore, `stations/${stationId}/notifications`));
  await setDoc(notifRef, {
    type: 'new_order',
    message: `🆕 New order #${orderId} placed by ${customerName}`,
    relatedId: orderId,
    createdAt: serverTimestamp(),
    read: false,
  });

  await this.sendPush({
    title: '🧾 New Order Received',
    body: `Order #${orderId} placed by ${customerName}`,
    topic: `station_${stationId}`,
    orderId,
  });
}

async notifyManagerUserMessage(
  stationId: string,
  userName: string,
  message: string
): Promise<void> {
  const notifRef = doc(collection(this.firestore, `stations/${stationId}/notifications`));
  await setDoc(notifRef, {
    type: 'message',
    message: `💬 ${userName}: "${message}"`,
    createdAt: serverTimestamp(),
    read: false,
  });

  await this.sendPush({
    title: '💬 New Message from Customer',
    body: `${userName}: ${message}`,
    topic: `station_${stationId}`,
  });
}

  /* ─────────────────────────────
   * STATION NOTIFICATIONS
   * ────────────────────────────*/
  listenToStationNotifications(stationId: string): Observable<UserNotification[]> {
    const ref = collection(this.firestore, `stations/${stationId}/notifications`);
    const qy = query(ref, orderBy('createdAt', 'desc'));
    return collectionData(qy, { idField: 'id' }) as Observable<UserNotification[]>;
  }

  async addStationNotification(stationId: string, data: Omit<UserNotification, 'id' | 'createdAt'>) {
    const notifRef = doc(collection(this.firestore, `stations/${stationId}/notifications`));
    await setDoc(notifRef, {
      ...data,
      read: data.read ?? false,
      createdAt: serverTimestamp(),
    });
  }

  async notifyStationOrderUpdate(stationId: string, orderId: string, status: string): Promise<void> {
    const notifRef = doc(collection(this.firestore, `stations/${stationId}/notifications`));
    await setDoc(notifRef, {
      type: 'order_update',
      message: `📦 Order #${orderId} is now ${status}`,
      relatedId: orderId,
      createdAt: serverTimestamp(),
      read: false,
    });

    await this.sendPush({
      title: '📦 Order Update',
      body: `Order #${orderId} is now ${status}`,
      topic: `station_${stationId}`,
      orderId,
    });
  }

  /* ─────────────────────────────
   * ADMIN NOTIFICATIONS
   * ────────────────────────────*/
  listenToAdminNotifications(adminId: string): Observable<UserNotification[]> {
    const ref = collection(this.firestore, `admins/${adminId}/notifications`);
    const qy = query(ref, orderBy('createdAt', 'desc'));
    return collectionData(qy, { idField: 'id' }) as Observable<UserNotification[]>;
  }

  async addAdminNotification(adminId: string, data: Omit<UserNotification, 'id' | 'createdAt'>): Promise<void> {
    const notifRef = doc(collection(this.firestore, `admins/${adminId}/notifications`));
    await setDoc(notifRef, {
      ...data,
      read: data.read ?? false,
      createdAt: serverTimestamp(),
    });
  }

  async notifyAdminSystemAlert(adminId: string, message: string): Promise<void> {
    const notifRef = doc(collection(this.firestore, `admins/${adminId}/notifications`));
    await setDoc(notifRef, {
      type: 'system',
      message: `⚙️ ${message}`,
      createdAt: serverTimestamp(),
      read: false,
    });

    await this.sendPush({
      title: '⚙️ System Notification',
      body: message,
      topic: `admin_${adminId}`,
    });
  }

  /* ─────────────────────────────
   * BULK + DELETE HELPERS (All Roles)
   * ────────────────────────────*/
  private basePath(uid: string, role: Role): string {
    switch (role) {
      case 'courier': return `couriers/${uid}/notifications`;
      case 'manager': return `managers/${uid}/notifications`;
      case 'station': return `stations/${uid}/notifications`;
      case 'admin':   return `admins/${uid}/notifications`;
      default:        return `users/${uid}/notifications`;
    }
  }

  async markAllAsRead(uid: string, role: Role = 'user'): Promise<void> {
    const ref = collection(this.firestore, this.basePath(uid, role));
    const snap = await getDocs(ref);
    if (snap.empty) return;

    const batch = writeBatch(this.firestore);
    snap.forEach((d) => batch.update(d.ref, { read: true }));
    await batch.commit();
  }

  async deleteNotification(uid: string, notifId: string, role: Role = 'user'): Promise<void> {
    await deleteDoc(doc(this.firestore, `${this.basePath(uid, role)}/${notifId}`));
  }

  /* ─────────────────────────────
   * CUSTOMER ORDER UPDATES (User)
   * ────────────────────────────*/
  async sendCustomerUpdate(customerId: string, orderId: string, status: string): Promise<void> {
    await this.addUserNotification(customerId, {
      type:
        status === 'delivered'
          ? 'completed'
          : status === 'confirmed'
          ? 'confirmation'
          : 'delivery',
      message: `Your order #${orderId} is now ${status}.`,
      relatedId: orderId,
      actionRoute: `/track-order/${orderId}`,
    });

    const userOrderRef = doc(this.firestore, `users/${customerId}/orders/${orderId}`);
    const snap = await getDoc(userOrderRef);
    if (snap.exists()) {
      await updateDoc(userOrderRef, { status, lastUpdatedAt: serverTimestamp() });
    }

    await this.sendPush({
      title: '🚚 Order Update',
      body: `Your order #${orderId} is now ${status}`,
      topic: `user_${customerId}`,
      orderId,
    });
  }

  /* ─────────────────────────────
   * GENERIC TO USER
   * ────────────────────────────*/
  async sendToUser(
    userId: string,
    payload: { title?: string; message: string; relatedId?: string; route?: string; type?: string }
  ) {
    await this.addUserNotification(userId, {
      type: payload.type ?? 'message',
      message: payload.title ? `${payload.title}: ${payload.message}` : payload.message,
      relatedId: payload.relatedId,
      actionRoute: payload.route,
    });

    await this.sendPush({
      title: payload.title ?? 'Notification',
      body: payload.message,
      topic: `user_${userId}`,
    });
  }


// ─────────────────────────────
// CUSTOMER ORDER STATUS NOTIFY (Unified + New Orders)
// ─────────────────────────────
async notifyUserOrderStatus(
  userId: string,
  orderId: string,
  status: string,
  stationName?: string
): Promise<void> {
  if (!userId || !orderId) return;

  // 🔹 Normalize readable labels
  const prettyStatusMap: Record<string, string> = {
    preparing: 'Preparing',
    'courier assigned': 'Courier Assigned',
    'out for delivery': 'Out for Delivery',
    delivered: 'Delivered',
    placed: 'Placed',
    new: 'New Order',
  };

  const normalized = status.toLowerCase();
  const prettyStatus = prettyStatusMap[normalized] || status;

  const title =
    normalized === 'delivered'
      ? 'Order Delivered'
      : normalized === 'placed' || normalized === 'new'
      ? 'New Order Placed'
      : `Order ${prettyStatus}`;

  const message =
    normalized === 'delivered'
      ? `Your order from ${stationName || 'AquaRoute Station'} has been delivered.`
      : normalized === 'placed' || normalized === 'new'
      ? `Your order from ${stationName || 'AquaRoute Station'} has been placed successfully.`
      : `Your order #${orderId} is now ${prettyStatus}.`;

  try {
    // ✅ Firestore notification
    const notifRef = collection(this.firestore, `users/${userId}/notifications`);
    await addDoc(notifRef, {
      type: 'orderUpdate',
      title,
      message,
      orderId,
      status: prettyStatus,
      stationName: stationName || null,
      createdAt: serverTimestamp(),
      read: false,
    });


    // ✅ Optional push
    const userRef = doc(this.firestore, `users/${userId}`);
    const userSnap = await getDoc(userRef);
    const token = userSnap.exists() ? (userSnap.data() as any).pushToken : null;

    if (token) {
      await this.sendPush({
        title,
        body: message,
        token,
        orderId,
      });
    }

    console.log(`📩 User notified: ${title} (${status}) → ${userId}`);
  } catch (err) {
    console.warn('⚠️ Failed to send user order status notification:', err);
  }
}


// ───────────── Manager → User Notification ─────────────
async notifyUserOrderUpdateFromManager(
  userId: string,
  orderId: string,
  status: string,
  stationName?: string
): Promise<void> {
  try {
    const message = `Your order #${orderId} is now ${status}.`;
    const title = `Order ${status}`;
    const notifRef = collection(this.firestore, `users/${userId}/notifications`);
    await addDoc(notifRef, {
      type: 'orderUpdate',
      title,
      message,
      orderId,
      status,
      createdAt: serverTimestamp(),
      read: false,
    });

    await this.sendPush({
      title,
      body: message,
      topic: `user_${userId}`,
      orderId,
    });
  } catch (err) {
    console.warn('⚠️ Manager→User notification failed:', err);
  }
}

// ───────────── Manager → Courier Notification ─────────────
async notifyCourierAssignmentFromManager(
  courierId: string,
  orderId: string,
  status: string = 'Assigned'
): Promise<void> {
  try {
    const message = `You have been assigned to order #${orderId}.`;
    const notifRef = collection(this.firestore, `couriers/${courierId}/notifications`);
    await addDoc(notifRef, {
      type: 'assignment',
      title: 'New Delivery Assigned',
      message,
      orderId,
      status,
      createdAt: serverTimestamp(),
      read: false,
    });

    await this.sendPush({
      title: '🚚 New Delivery Assigned',
      body: message,
      topic: `courier_${courierId}`,
      orderId,
    });
  } catch (err) {
    console.warn('⚠️ Manager→Courier notification failed:', err);
  }
}

// ────────────── Timestamp Normalizer (Optional helper) ──────────────
private normalizeTimestamp(data: any) {
  return {
    ...data,
    createdAt: data.createdAt || data.timestamp || serverTimestamp(),
  };
}

private listenToUnread(uid: string) {
  const colRef = collection(this.firestore, `users/${uid}/notifications`);
  const q = query(colRef, where('read', '==', false));

this.unreadUnsub = onSnapshot(q, (snap: any) => {
  this.unreadCountSubject.next(snap.size || 0);
});
}

getUnreadCount$(): Observable<number> {
  return this.unreadCount$;
}


  /* ─────────────────────────────
   * PUSH STUB
   * ────────────────────────────*/
  async sendPush(payload: {
    title: string;
    body: string;
    token?: string;
    topic?: string;
    orderId?: string;
    stationId?: string;
  }): Promise<void> {
    if (!this.enabled) return;
    console.log('📡 Push (stub):', payload, 'token:', this.pushToken);
  }

  getToken(): string | null {
    return this.pushToken;
  }
}
