import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ToastController } from '@ionic/angular';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import {
  Firestore,
  collection,
  onSnapshot,
  query,
  where,
  getDocs,
} from '@angular/fire/firestore';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import { Subscription } from 'rxjs';

interface StatusHistoryEntry {
  status: string;
  changedAt?: any;
  by?: string;
  note?: string | null;
}

interface OrderLog {
  id?: string;
  delivery?: { fullName?: string; address?: string };
  courier?: { name?: string; vehicle?: string };
  charges?: { total?: number };
  createdAt?: any;
  deliveredAt?: any;
  completedAt?: any;
  deliveryStartAt?: any;
  status?: string;
  totalAmount?: number;
  _createdAt?: Date | null;
  _deliveredAt?: Date | null;
  _completedAt?: Date | null;
}

@Component({
  selector: 'app-manager-daily-log',
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule],
  templateUrl: './manager-daily-log.page.html',
  styleUrls: ['./manager-daily-log.page.scss'],
})
export class ManagerDailyLogPage implements OnInit, OnDestroy {
  private subs: Subscription[] = [];
  private myStationId: string | null = null;

  dateParam = '';
  orders: OrderLog[] = [];
  loading = true;
  totalDeliveries = 0;
  totalEarnings = 0;
  averageDuration = 0;

  constructor(
    private firestore: Firestore,
    private auth: Auth,
    private route: ActivatedRoute,
    private router: Router,
    private toastCtrl: ToastController
  ) {}

  async ngOnInit() {
    if (!this.auth.currentUser) {
      await new Promise<void>((resolve) => {
        const unsub = onAuthStateChanged(this.auth, () => {
          unsub();
          resolve();
        });
      });
    }

    this.dateParam =
      this.route.snapshot.paramMap.get('date') ||
      (history.state && (history.state.date as string)) ||
      '';

    if (!this.dateParam) {
      this.loading = false;
      await this.presentToast('⚠️ Missing date parameter.');
      return;
    }

    const userId = this.auth.currentUser?.uid;
    if (!userId) {
      this.loading = false;
      await this.presentToast('⚠️ No user found.');
      return;
    }

    const stationsQ = query(
      collection(this.firestore, 'stations'),
      where('ownerId', '==', userId)
    );
    const snapshot = await getDocs(stationsQ);
    if (snapshot.empty) {
      this.loading = false;
      await this.presentToast('⚠️ No station found for this manager.');
      return;
    }

    this.myStationId = snapshot.docs[0].id;
    await this.loadOrdersForDate(this.dateParam);
  }

  private async loadOrdersForDate(dateStr: string) {
    if (!this.myStationId) return;

    const collRef = collection(
      this.firestore,
      `stations/${this.myStationId}/archivedOrders`
    );

    const unsub = onSnapshot(collRef, (snapshot) => {
      const allOrders = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        _createdAt: this.toDate((doc.data() as any).createdAt),
        _deliveredAt: this.toDate((doc.data() as any).deliveredAt),
        _completedAt: this.toDate((doc.data() as any).completedAt),
      }));

      this.orders = allOrders
        .filter((o) => {
          const delivered = o._deliveredAt || o._completedAt;
          const metaDate =
            (o as any).date || (o as any).archivedDate || (o as any).logDate;
          return (
            this.isSameDate(delivered, dateStr) ||
            (metaDate && metaDate.includes(dateStr))
          );
        })
        .sort(
          (a, b) =>
            (b._deliveredAt?.getTime?.() || b._completedAt?.getTime?.() || 0) -
            (a._deliveredAt?.getTime?.() || a._completedAt?.getTime?.() || 0)
        );

      this.computeSummary();
      this.loading = false;
    });

    this.subs.push({ unsubscribe: unsub } as any);
  }

  private toDate(t: any): Date | null {
    if (!t) return null;
    if (t instanceof Date) return t;
    if (typeof t === 'number') return new Date(t);
    if (typeof t === 'string') return new Date(t);
    if (t?.seconds) return new Date(t.seconds * 1000);
    if (t?.toDate) return t.toDate();
    return null;
  }

  private isSameDate(d: Date | null, dateStr: string): boolean {
    if (!d) return false;
    const target = new Date(dateStr);
    return (
      d.getDate() === target.getDate() &&
      d.getMonth() === target.getMonth() &&
      d.getFullYear() === target.getFullYear()
    );
  }

  private computeSummary() {
    this.totalDeliveries = this.orders.length;
    this.totalEarnings = this.orders.reduce((sum, o) => {
      const total =
        (o.charges && Number(o.charges.total)) ??
        (o.totalAmount != null ? Number(o.totalAmount) : 0);
      return sum + (isNaN(total) ? 0 : total);
    }, 0);

    const durations: number[] = this.orders
      .map((o) => {
        const startSec =
          (o as any)?.deliveryStartAt?.seconds ??
          (o as any)?.createdAt?.seconds ??
          null;
        const endSec =
          (o as any)?.deliveredAt?.seconds ??
          (o as any)?.completedAt?.seconds ??
          null;
        if (startSec && endSec && endSec > startSec) {
          const mins = Math.round((endSec - startSec) / 60);
          return mins < 600 ? mins : null;
        }
        return null;
      })
      .filter((x): x is number => x !== null);

    this.averageDuration = durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;
  }

  goBack() {
    this.router.navigate(['/manager-completed']);
  }

  async presentToast(msg: string) {
    const t = await this.toastCtrl.create({
      message: msg,
      duration: 2000,
      position: 'top',
    });
    await t.present();
  }

  ngOnDestroy() {
    this.subs.forEach((s) => s.unsubscribe());
  }
}
