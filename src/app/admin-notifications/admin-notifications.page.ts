import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ToastController } from '@ionic/angular';
import { RouterModule, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { Auth } from '@angular/fire/auth';
import { onAuthStateChanged, User } from 'firebase/auth';
import { NotificationService, UserNotification } from '../services/notification.service';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

@Component({
  selector: 'app-admin-notifications',
  standalone: true,
  templateUrl: './admin-notifications.page.html',
  styleUrls: ['./admin-notifications.page.scss'],
  imports: [CommonModule, IonicModule, RouterModule],
})
export class AdminNotificationsPage implements OnInit, OnDestroy {
  loading = true;
  notifications: UserNotification[] = [];
  private uid?: string;
  private notifSub?: Subscription;
  private authUnsub?: () => void;

  constructor(
    private auth: Auth,
    private router: Router,
    private toastCtrl: ToastController,
    private notifSvc: NotificationService
  ) {}

  ngOnInit(): void {
    this.authUnsub = onAuthStateChanged(this.auth, (u: User | null) => {
      if (!u) return;
      this.uid = u.uid;
      this.startListening(u.uid);
    });
  }

  private startListening(adminId: string) {
    this.notifSub?.unsubscribe();
    this.loading = true;
    let previousCount = 0;

    this.notifSub = this.notifSvc.listenToAdminNotifications(adminId).subscribe({
      next: async (list: UserNotification[]) => {
        this.notifications = list;
        this.loading = false;

        if (previousCount && list.length > previousCount) {
          const newNotif = list[0];
          await Haptics.impact({ style: ImpactStyle.Medium });
          const toast = await this.toastCtrl.create({
            message: newNotif.message,
            duration: 2500,
            color: 'primary',
            position: 'top',
          });
          await toast.present();
        }
        previousCount = list.length;
      },
      error: async () => {
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

  refresh(ev: any) {
    setTimeout(() => ev.target.complete(), 400);
  }

  async markAllAsRead() {
    if (!this.uid) return;
    await this.notifSvc.markAllAsRead(this.uid, 'admin');
    const toast = await this.toastCtrl.create({
      message: 'All notifications marked as read ✅',
      duration: 1800,
      color: 'success',
    });
    await toast.present();
  }

  async deleteNotification(n: UserNotification) {
    if (!this.uid || !n.id) return;
    await this.notifSvc.deleteNotification(this.uid, n.id, 'admin');
    const toast = await this.toastCtrl.create({
      message: 'Notification deleted 🗑️',
      duration: 1500,
      color: 'medium',
    });
    await toast.present();
  }

  getIcon(type?: string): string {
    switch (type) {
      case 'system': return 'information-circle-outline';
      case 'manager': return 'person-outline';
      case 'courier': return 'bicycle-outline';
      case 'order': return 'cart-outline';
      default: return 'notifications-outline';
    }
  }

  openRelated(n: UserNotification) {
    if (n.type === 'order' && n.relatedId) {
      this.router.navigate(['/admin-orders', n.relatedId]);
    }
  }

  goBack() {
    this.router.navigate(['/admin-dashboard']);
  }

  ngOnDestroy(): void {
    this.authUnsub?.();
    this.notifSub?.unsubscribe();
  }
}
