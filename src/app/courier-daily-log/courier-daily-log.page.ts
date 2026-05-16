import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { ActivatedRoute, RouterModule } from '@angular/router';
import {
  Firestore,
  collection,
  getDocs,
  doc,
  getDoc,
  query,
  where,
} from '@angular/fire/firestore';

@Component({
  selector: 'app-courier-daily-log',
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule],
  templateUrl: './courier-daily-log.page.html',
  styleUrls: ['./courier-daily-log.page.scss'],
})
export class CourierDailyLogPage implements OnInit, OnDestroy {
  dateKey = '';
  stationId: string | null = null;
  courierId: string | null = null;

  totalDeliveries = 0;
  totalEarnings = 0;
  averageDuration = 0;
  orders: any[] = [];
  loading = true;

  displayDate: Date = new Date();


  constructor(private route: ActivatedRoute, private firestore: Firestore) {}

  async ngOnInit() {
    this.dateKey = this.route.snapshot.paramMap.get('date') || '';
    this.stationId = localStorage.getItem('stationId');
    this.courierId = localStorage.getItem('courierId');

    if (!this.stationId || !this.courierId || !this.dateKey) {
      this.loading = false;
      return;
    }

    await this.loadDailyLogData();
  }

  ngOnDestroy() {}

  private async loadDailyLogData() {
    try {
      // ─────────────── DAILY LOG SUMMARY ───────────────
      const logRef = doc(
        this.firestore,
        `stations/${this.stationId}/couriers/${this.courierId}/dailyLogs/${this.dateKey}`
      );
      const logSnap = await getDoc(logRef);
      if (logSnap.exists()) {
        const d = logSnap.data() as any;
        this.totalDeliveries = d.totalDeliveries || 0;
        this.totalEarnings = d.totalEarnings || 0;
        this.averageDuration = d.averageDuration || 0;
      }

      // ─────────────── FETCH ARCHIVED ORDERS ───────────────
      const archivedRef = collection(
        this.firestore,
        `stations/${this.stationId}/archivedOrders`
      );

      const snap = await getDocs(
        query(
          archivedRef,
          where('courier.id', '==', this.courierId),
          where('archived', '==', true)
        )
      );

      const normalizeDate = (t: any): Date | null => {
        if (!t) return null;
        if (t instanceof Date) return t;
        if (t.toDate) return t.toDate();
        if (t.seconds) return new Date(t.seconds * 1000);
        return null;
      };

      const targetKey = this.dateKey;

      // Filter orders matching the dayKey (like manager-daily-log)
      this.orders = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .filter((o) => {
          const d =
            normalizeDate(o.deliveredAt) ||
            normalizeDate(o.completedAt) ||
            normalizeDate(o.archivedAt);
          if (!d) return false;
          const key = d.toISOString().split('T')[0];
          return key === targetKey;
        })
        .sort((a, b) => {
          const at =
            a?.deliveredAt?.seconds ||
            a?.completedAt?.seconds ||
            a?.archivedAt?.seconds ||
            0;
          const bt =
            b?.deliveredAt?.seconds ||
            b?.completedAt?.seconds ||
            b?.archivedAt?.seconds ||
            0;
          return bt - at;
        });

      // ─────────────── FALLBACK SUMMARY ───────────────
      if (!logSnap.exists() && this.orders.length > 0) {
        this.totalDeliveries = this.orders.length;
        this.totalEarnings = this.orders.reduce(
          (sum, o) =>
            sum + (Number(o?.charges?.total) || Number(o?.totalAmount) || 0),
          0
        );

        const durations = this.orders
          .map((o) => {
            const start =
              o?.deliveryStartAt?.seconds || o?.createdAt?.seconds || 0;
            const end =
              o?.deliveredAt?.seconds ||
              o?.completedAt?.seconds ||
              o?.archivedAt?.seconds ||
              0;
            return start && end && end > start
              ? Math.round((end - start) / 60)
              : null;
          })
          .filter((d): d is number => d !== null);

        this.averageDuration = durations.length
          ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length)
          : 0;
      }

      this.loading = false;
      console.log(
        `📦 Courier Daily Log synced with Manager logic (${this.dateKey}) — ${this.orders.length} orders`
      );
    } catch (err) {
      console.error('❌ Failed to load courier daily log:', err);
      this.loading = false;
    }
  }
}
