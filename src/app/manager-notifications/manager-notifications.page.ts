import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ToastController, AlertController } from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { Auth } from '@angular/fire/auth';
import { onAuthStateChanged, User } from 'firebase/auth';
import { NotificationService, UserNotification } from '../services/notification.service';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import {
  Firestore,
  collection,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  doc,
  getDocs,
  deleteDoc
} from '@angular/fire/firestore';

@Component({
  selector: 'app-manager-notifications',
  standalone: true,
  templateUrl: './manager-notifications.page.html',
  styleUrls: ['./manager-notifications.page.scss'],
  imports: [CommonModule, IonicModule, RouterModule],
})
export class ManagerNotificationsPage implements OnInit, OnDestroy {
  loading = true;
  notifications: UserNotification[] = [];
  unreadCount = 0;

  private managerId?: string;
  private notifUnsub?: () => void;
  private authUnsub?: () => void;

  constructor(
    private auth: Auth,
    private router: Router,
    private toastCtrl: ToastController,
    private alertCtrl: AlertController,
    private firestore: Firestore,
    private notifSvc: NotificationService
  ) {}

  // ─────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────
  ngOnInit(): void {
    this.authUnsub = onAuthStateChanged(this.auth, async (u: User | null) => {
      if (!u) {
        this.notifications = [];
        this.unreadCount = 0;
        this.loading = false;
        return;
      }
      this.managerId = u.uid;

      // ✅ Immediately mark all unread as "viewed" (for badge sync)
      await this.notifSvc.markAllAsRead(this.managerId);

      // ✅ Start listening for notifications in real-time
      this.startRealtimeListener(u.uid);
    });
  }

private startRealtimeListener(managerId: string) {
  this.notifUnsub?.();
  this.loading = true;
  let prevCount = 0;

  // ✅ Correct source: notifications for the manager’s STATION, not user
  const stationId = localStorage.getItem('stationId');
  if (!stationId) {
    console.warn('⚠️ No stationId found in localStorage, cannot load notifications.');
    this.loading = false;
    return;
  }

  const notifRef = collection(this.firestore, `stations/${stationId}/notifications`);
  const q = query(notifRef, orderBy('createdAt', 'desc'));

  this.notifUnsub = onSnapshot(q, async (snapshot) => {
    const list: UserNotification[] = snapshot.docs.map((d) => {
      const data = d.data() as any;
      return {
        id: d.id,
        ...data,
        createdAt: data.createdAt || data.timestamp || serverTimestamp(),
      };
    });

    list.sort((a, b) => {
      const tA = a.createdAt?.toMillis?.() || a.createdAt?.seconds || 0;
      const tB = b.createdAt?.toMillis?.() || b.createdAt?.seconds || 0;
      return tB - tA;
    });

    this.notifications = list.filter((n) => !!n.message);
    this.unreadCount = list.filter((n) => !n.read).length;
    this.loading = false;

    // 🔔 New notification feedback
    if (prevCount && list.length > prevCount) {
      const newNotif = list[0];
      await Haptics.impact({ style: ImpactStyle.Medium });
      try {
        const audio = new Audio('assets/sounds/notify.mp3');
        audio.volume = 0.5;
        await audio.play();
      } catch {}
      const toast = await this.toastCtrl.create({
        message: newNotif.message || 'New notification received',
        duration: 3000,
        color: newNotif.type === 'new_order' ? 'success' : 'primary',
        position: 'top',
        buttons: [
          { text: 'View', handler: () => this.openRelated(newNotif) },
        ],
      });
      await toast.present();
    }

    prevCount = list.length;
  });
}

async markAllAsRead() {
  const stationId = localStorage.getItem('stationId');
  if (!stationId) return;

  const notifRef = collection(this.firestore, `stations/${stationId}/notifications`);
  const snap = await getDocs(notifRef);

  for (const d of snap.docs) {
    const data = d.data() as any;
    if (!data.read) {
      await updateDoc(d.ref, { read: true });
    }
  }

  this.notifications = this.notifications.map((n) => ({ ...n, read: true }));
  this.unreadCount = 0;

  await Haptics.impact({ style: ImpactStyle.Light });
  const toast = await this.toastCtrl.create({
    message: 'All notifications marked as read ✅',
    duration: 2000,
    color: 'success',
  });
  toast.present();
}

  async deleteNotification(n: UserNotification) {
    if (!this.managerId || !n.id) return;

    const alert = await this.alertCtrl.create({
      header: 'Delete Notification',
      message: 'Are you sure you want to delete this notification?',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: async () => {
            try {
              const stationId = localStorage.getItem('stationId');
if (!stationId) return;
await deleteDoc(doc(this.firestore, `stations/${stationId}/notifications/${n.id}`));
              this.notifications = this.notifications.filter((x) => x.id !== n.id);

              const toast = await this.toastCtrl.create({
                message: '🗑️ Notification deleted',
                duration: 1500,
                color: 'medium',
              });
              toast.present();
            } catch (err) {
              console.error('❌ Failed to delete notification', err);
              const t = await this.toastCtrl.create({
                message: 'Failed to delete notification.',
                duration: 1500,
                color: 'danger',
              });
              t.present();
            }
          },
        },
      ],
    });
    await alert.present();
  }

  refresh(ev: any) {
    setTimeout(() => ev.target.complete(), 400);
  }

  // ─────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────
  getIcon(type?: string): string {
    switch (type) {
      case 'new_order': return 'cart-outline';
      case 'courier': return 'bicycle-outline';
      case 'delivery': return 'checkmark-circle-outline';
      case 'message': return 'chatbubble-outline';
      case 'system': return 'information-circle-outline';
      default: return 'notifications-outline';
    }
  }

async openRelated(n: UserNotification) {
  // ✅ Mark notification as read when opened
  const stationId = localStorage.getItem('stationId');
  if (stationId && n.id && !n.read) {
    const notifRef = doc(this.firestore, `stations/${stationId}/notifications/${n.id}`);
    await updateDoc(notifRef, { read: true });
    n.read = true;
    this.unreadCount = this.notifications.filter((x) => !x.read).length;
  }

  if (n.relatedId && n.type === 'new_order') {
    this.router.navigate(['/manager-orders'], { queryParams: { id: n.relatedId } });
  } else if (n.type === 'courier') {
    this.router.navigate(['/courier-details'], { queryParams: { id: n.relatedId } });
  }
}

  // ─────────────────────────────────────────────
  // Cleanup
  // ─────────────────────────────────────────────
  ngOnDestroy(): void {
    this.authUnsub?.();
    this.notifUnsub?.();
  }
}
