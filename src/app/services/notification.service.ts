import { Injectable } from '@angular/core';
import {
  PushNotifications,
  Token,
  PushNotificationSchema,
  ActionPerformed,
} from '@capacitor/push-notifications';
import { Firestore, doc, setDoc, serverTimestamp, updateDoc, getDoc } from '@angular/fire/firestore';

@Injectable({
  providedIn: 'root',
})
export class NotificationService {
  private enabled = true;
  private pushToken: string | null = null;

  constructor(private firestore: Firestore) {
    const saved = localStorage.getItem('pushNotifications');
    this.enabled = saved !== null ? saved === 'true' : true;
  }

  // ─────────────────────────────────────────────
  // Enable / Disable toggle (persisted)
  // ─────────────────────────────────────────────
  setEnabled(value: boolean) {
    this.enabled = value;
    localStorage.setItem('pushNotifications', String(value));
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  // ─────────────────────────────────────────────
  // Init push notifications
  // ─────────────────────────────────────────────
  async initPush(): Promise<void> {
    if (!this.enabled) {
      console.log('🚫 Push notifications disabled by user');
      return;
    }

    try {
      const permStatus = await PushNotifications.requestPermissions();
      if (permStatus.receive !== 'granted') {
        console.warn('⚠️ Push permission not granted');
        return;
      }

      await PushNotifications.register();

      PushNotifications.addListener('registration', async (token: Token) => {
        this.pushToken = token.value;
        console.log('📱 Registered push token:', token.value);
      });

      PushNotifications.addListener('registrationError', (err) => {
        console.error('❌ Push registration error:', err);
      });

      PushNotifications.addListener(
        'pushNotificationReceived',
        (notification: PushNotificationSchema) => {
          console.log('📩 Push received:', notification);
          alert(`${notification.title ?? 'Notification'}: ${notification.body ?? ''}`);
        }
      );

      PushNotifications.addListener(
        'pushNotificationActionPerformed',
        (action: ActionPerformed) => {
          console.log('📲 Push action performed:', action.notification);
        }
      );

      console.log('✅ Push notifications initialized');
    } catch (err) {
      console.error('⚠️ Push init failed:', err);
    }
  }

  // ─────────────────────────────────────────────
  // Generic Push Sender (to backend/Cloud Function)
  // ─────────────────────────────────────────────
  async sendPush(payload: {
    title: string;
    body: string;
    token?: string;
    topic?: string;
    orderId?: string;
    stationId?: string;
  }): Promise<void> {
    if (!this.enabled) {
      console.log('🚫 Push notifications disabled by user');
      return;
    }

    try {
      const pushPayload: any = {
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: {
          orderId: payload.orderId ?? '',
          stationId: payload.stationId ?? '',
        },
      };

      if (payload.token) pushPayload.token = payload.token;
      if (payload.topic) pushPayload.topic = payload.topic;

      console.log('📤 Sending push payload:', pushPayload);
      // TODO: Hook Cloud Function here
    } catch (err) {
      console.error('❌ Failed to send push:', err);
    }
  }

  // ─────────────────────────────────────────────
  // HIGH-LEVEL HELPERS
  // ─────────────────────────────────────────────

  /** Notify courier of a new assignment */
  async sendCourierAssignment(courierId: string, orderId: string): Promise<void> {
    const notifRef = doc(this.firestore, `couriers/${courierId}/notifications/${orderId}`);
    await setDoc(notifRef, {
      type: 'assignment',
      orderId,
      createdAt: serverTimestamp(),
      read: false,
    });

    await this.sendPush({
      title: '📦 New Delivery Assigned',
      body: `You have been assigned order #${orderId}`,
      topic: `courier_${courierId}`,
      orderId,
    });
  }

  /** Notify customer of order status update + mirror it to their orders */
  async sendCustomerUpdate(customerId: string, orderId: string, status: string): Promise<void> {
    // 🔹 Step 1: Write notification entry
    const notifRef = doc(this.firestore, `users/${customerId}/notifications/${orderId}`);
    await setDoc(notifRef, {
      type: 'status',
      status,
      orderId,
      createdAt: serverTimestamp(),
      read: false,
    });

    // 🔹 Step 2: Mirror update to user’s active order document
    const userOrderRef = doc(this.firestore, `users/${customerId}/orders/${orderId}`);
    const snap = await getDoc(userOrderRef);
    if (snap.exists()) {
      await updateDoc(userOrderRef, {
        status,
        lastUpdatedAt: serverTimestamp(),
      });
      console.log(`✅ Mirrored order status '${status}' → users/${customerId}/orders/${orderId}`);
    } else {
      console.warn(`⚠️ No user order found to mirror (${customerId}/${orderId})`);
    }

    // 🔹 Step 3: Optional push notification
    await this.sendPush({
      title: '🚚 Order Update',
      body: `Your order #${orderId} is now ${status}`,
      topic: `user_${customerId}`,
      orderId,
    });
  }

  // ─────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────
  getToken(): string | null {
    return this.pushToken;
  }
}
