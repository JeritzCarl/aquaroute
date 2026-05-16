import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ToastController, AlertController } from '@ionic/angular';
import { RouterModule, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { Auth } from '@angular/fire/auth';
import { onAuthStateChanged, User } from 'firebase/auth';
import { NotificationService, UserNotification } from '../services/notification.service';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

@Component({
  selector: 'app-courier-notifications',
  standalone: true,
  templateUrl: './courier-notifications.page.html',
  styleUrls: ['./courier-notifications.page.scss'],
  imports: [CommonModule, IonicModule, RouterModule],
})
export class CourierNotificationsPage implements OnInit, OnDestroy {
  loading = true;
  notifications: UserNotification[] = [];
  private uid?: string;
  private notifSub?: Subscription;
  private authUnsub?: () => void;

  constructor(
    private auth: Auth,
    private router: Router,
    private toastCtrl: ToastController,
    private alertCtrl: AlertController,
    private notifSvc: NotificationService
  ) {}

  // ───────────────────────────────────────────────
  // 🧭 Initialize — watch auth and start listening
  // ───────────────────────────────────────────────
  ngOnInit(): void {
    this.authUnsub = onAuthStateChanged(this.auth, (u: User | null) => {
      if (!u) return;
      this.uid = u.uid;
      this.startListening(u.uid);
    });
  }

  // ───────────────────────────────────────────────
  // 🔔 Real-time listener for courier notifications
  // ───────────────────────────────────────────────
  private startListening(courierId: string) {
    this.notifSub?.unsubscribe();
    this.loading = true;
    let previousCount = 0;

    // ✅ Correct Firestore path for couriers
    this.notifSub = this.notifSvc.listenToCourierNotifications(courierId).subscribe({
      next: async (list: UserNotification[]) => {
        this.notifications = list;
        this.loading = false;

        // 🔔 Show toast + haptic if new notification arrives
        if (previousCount && list.length > previousCount) {
          const newNotif = list[0];
          await Haptics.impact({ style: ImpactStyle.Medium });
          const toast = await this.toastCtrl.create({
            message: newNotif.message || 'New notification received.',
            duration: 2500,
            color: 'primary',
            position: 'top',
          });
          await toast.present();
        }
        previousCount = list.length;
      },
      error: async (err) => {
        console.error('❌ Failed to listen to courier notifications:', err);
        const t = await this.toastCtrl.create({
          message: 'Failed to load notifications.',
          duration: 2000,
          color: 'danger',
        });
        t.present();
        this.loading = false;
      },
    });
  }

  // ───────────────────────────────────────────────
  // ↻ Pull-to-refresh
  // ───────────────────────────────────────────────
  refresh(ev: any) {
    setTimeout(() => ev.target.complete(), 400);
  }

  // ───────────────────────────────────────────────
  // ✅ Mark all as read (Courier path)
  // ───────────────────────────────────────────────
  async markAllAsRead() {
    if (!this.uid) return;
    try {
      await this.notifSvc.markAllAsRead(this.uid, 'courier');
      await Haptics.impact({ style: ImpactStyle.Light });
      const toast = await this.toastCtrl.create({
        message: 'All notifications marked as read ✅',
        duration: 1800,
        color: 'success',
      });
      await toast.present();
    } catch (err) {
      console.error('❌ Failed to mark all as read:', err);
      const t = await this.toastCtrl.create({
        message: 'Failed to mark all as read.',
        duration: 2000,
        color: 'danger',
      });
      t.present();
    }
  }

  // ───────────────────────────────────────────────
  // 🗑 Delete notification (Courier path)
  // ───────────────────────────────────────────────
  async deleteNotification(n: UserNotification) {
    if (!this.uid || !n.id) return;

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
              await this.notifSvc.deleteNotification(this.uid!, n.id!, 'courier');
              const toast = await this.toastCtrl.create({
                message: 'Notification deleted 🗑️',
                duration: 1500,
                color: 'medium',
              });
              toast.present();
            } catch (err) {
              console.error('❌ Failed to delete notification:', err);
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

  // ───────────────────────────────────────────────
  // 🧭 Icons per notification type
  // ───────────────────────────────────────────────
  getIcon(type?: string): string {
    switch ((type || '').toLowerCase()) {
      case 'assignment':
      case 'assigned':
        return 'bicycle-outline';
      case 'delivery_update':
      case 'orderupdate':
        return 'cube-outline';
      case 'message':
        return 'chatbubble-ellipses-outline';
      case 'system':
        return 'information-circle-outline';
      default:
        return 'notifications-outline';
    }
  }

  // ───────────────────────────────────────────────
  // 📦 Open related record (order, etc.)
  // ───────────────────────────────────────────────
  openRelated(n: UserNotification) {
    if (!n) return;
    if (n.type === 'assignment' && n.relatedId) {
      this.router.navigate(['/courier', n.relatedId]);
    } else if (n.type?.toLowerCase().includes('order') && n.relatedId) {
      this.router.navigate(['/courier-history', n.relatedId]);
    }
  }

  // ───────────────────────────────────────────────
  // ♻ Cleanup
  // ───────────────────────────────────────────────
  ngOnDestroy(): void {
    this.authUnsub?.();
    this.notifSub?.unsubscribe();
  }
}
