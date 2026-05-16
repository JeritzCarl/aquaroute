import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ToastController, AlertController } from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';
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
} from '@angular/fire/firestore';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-notifications',
  standalone: true,
  templateUrl: './notifications.page.html',
  styleUrls: ['./notifications.page.scss'],
  imports: [CommonModule, IonicModule, RouterModule],
})
export class NotificationsPage implements OnInit, OnDestroy {
  loading = true;
  notifications: UserNotification[] = [];
  unreadCount = 0;

  private authUnsub?: () => void;
  private notifUnsub?: () => void;
  private uid?: string;
  private unreadSub?: Subscription;

  constructor(
    private auth: Auth,
    private router: Router,
    private toast: ToastController,
    private alertCtrl: AlertController,
    private firestore: Firestore,
    private notifSvc: NotificationService
  ) {}

  // ─────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────
  ngOnInit(): void {
    this.authUnsub = onAuthStateChanged(this.auth, (u: User | null) => {
      if (!u) {
        this.notifications = [];
        this.unreadCount = 0;
        this.loading = false;
        return;
      }
      this.uid = u.uid;
      this.startRealtimeListener(u.uid);
      this.unreadSub = this.notifSvc.getUnreadCount$().subscribe((count) => {
        this.unreadCount = count;
      });
    });
  }

  // ─────────────────────────────────────────────
  // Realtime Firestore Listener (with Declined handling)
  // ─────────────────────────────────────────────
  private startRealtimeListener(userId: string) {
    this.notifUnsub?.();
    this.loading = true;
    let prevCount = 0;

    const notifRef = collection(this.firestore, `users/${userId}/notifications`);
    const q = query(notifRef, orderBy('createdAt', 'desc'));

    this.notifUnsub = onSnapshot(q, async (snapshot) => {
      const list: UserNotification[] = snapshot.docs.map((d) => {
        const data = d.data() as any;

        let title = data.title || '';
        let message = data.message || '';

        // ✅ Normalize Declined orders
        if (data.subtype === 'declined' || data.status === 'Declined') {
          title = 'Order Declined';
          message = data.body || data.message || 'Your order was declined by the station.';
        }

        return {
          id: d.id,
          ...data,
          title,
          message,
          createdAt: data.createdAt || data.timestamp || serverTimestamp(),
        };
      });

      // sort latest first
      list.sort((a, b) => {
        const tA = a.createdAt?.toMillis?.() || a.createdAt?.seconds || 0;
        const tB = b.createdAt?.toMillis?.() || b.createdAt?.seconds || 0;
        return tB - tA;
      });

      this.notifications = list;
      this.loading = false;

      // 🔔 Trigger haptic + toast for new notif
      if (prevCount && list.length > prevCount) {
        const newNotif = list[0];
        await Haptics.impact({ style: ImpactStyle.Medium });
        try {
          const audio = new Audio('assets/sounds/notify.mp3');
          audio.volume = 0.5;
          await audio.play();
        } catch {}

        const toast = await this.toast.create({
          message: newNotif.message || 'New notification received',
          duration: 2500,
          color:
            newNotif.subtype === 'declined' || newNotif.status === 'Cancelled'
              ? 'danger'
              : 'primary',
          position: 'top',
          buttons: [{ text: 'View', handler: () => this.openRelated(newNotif) }],
        });
        await toast.present();
      }

      prevCount = list.length;
    });
  }

  // ─────────────────────────────────────────────
  // UI Actions
  // ─────────────────────────────────────────────
  refresh(ev: any) {
    setTimeout(() => ev.target.complete(), 400);
  }

  getIcon(type?: string): string {
    switch (type) {
      case 'order': return 'cube-outline';
      case 'delivery': return 'bicycle-outline';
      case 'completed': return 'checkmark-done-outline';
      case 'payment': return 'cash-outline';
      case 'reminder': return 'time-outline';
      case 'message': return 'chatbubble-outline';
      case 'system': return 'information-circle-outline';
      default: return 'notifications-outline';
    }
  }

  async openRelated(n: UserNotification) {
    if (!this.uid || !n.id) return;
    if (!n.read) await this.markAsRead(n.id);

    if (n.actionRoute) {
      this.router.navigateByUrl(n.actionRoute);
    } else if (n.orderId || n.relatedId) {
      this.router.navigate(['/track-order'], {
        queryParams: { id: n.orderId || n.relatedId },
      });
    }
  }

  async markAllRead() {
    if (!this.uid) return;
    await this.notifSvc.markAllAsRead(this.uid);
    const t = await this.toast.create({
      message: '✅ All notifications marked as read',
      duration: 1500,
      color: 'primary',
      position: 'bottom',
    });
    t.present();
  }

  async markAsRead(id: string) {
    if (!this.uid) return;
    await this.notifSvc.markAsRead(this.uid, id);
  }

  async confirmDelete(n: UserNotification) {
    const alert = await this.alertCtrl.create({
      header: 'Delete Notification',
      message: 'Are you sure you want to delete this notification?',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: () => this.deleteNotification(n.id!),
        },
      ],
    });
    await alert.present();
  }

  async deleteNotification(id: string) {
    if (!this.uid || !id) return;
    await this.notifSvc.deleteUserNotification(this.uid, id);
    const t = await this.toast.create({
      message: '🗑️ Notification deleted',
      duration: 1500,
      color: 'medium',
      position: 'bottom',
    });
    t.present();
  }

  ngOnDestroy(): void {
    this.authUnsub?.();
    this.notifUnsub?.();
    this.unreadSub?.unsubscribe();
  }
}
