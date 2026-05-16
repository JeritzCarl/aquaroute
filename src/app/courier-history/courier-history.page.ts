import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { RouterModule, Router } from '@angular/router';
import {
  Firestore,
  collection,
  query,
  onSnapshot,
  getDocs,
  doc,
  Timestamp,
} from '@angular/fire/firestore';
import { Auth, onAuthStateChanged, User } from '@angular/fire/auth';

interface DailyLog {
  id: string;
  date?: string;
  totalDeliveries?: number;
  totalEarnings?: number;
  averageDuration?: number;
  createdAt?: any;
  updatedAt?: any;
}

@Component({
  selector: 'app-courier-history',
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule],
  templateUrl: './courier-history.page.html',
  styleUrls: ['./courier-history.page.scss'],
})
export class CourierHistoryPage implements OnInit, OnDestroy {
  uid: string | null = null;
  stationId: string | null = null;
  courierId: string | null = null;

  viewMode: 'today' | 'logs' = 'today';
  todayOrders: any[] = [];
  history: any[] = [];
  dailyLogs: DailyLog[] = [];

  totalEarnings = 0;
  averageDuration = 0;
  totalDeliveries = 0;
  loading = true;

  private unsubs: Array<() => void> = [];

  constructor(private firestore: Firestore, private auth: Auth, private router: Router) {}

  async ngOnInit() {
    const user = await this.waitForUser();
    if (!user) {
      this.loading = false;
      return;
    }

    this.uid = user.uid;
    this.stationId = localStorage.getItem('stationId');
    this.courierId = localStorage.getItem('courierId');

    if (!this.stationId || !this.courierId) {
      const stationsSnap = await getDocs(collection(this.firestore, 'stations'));
      for (const s of stationsSnap.docs) {
        const couriersCol = collection(this.firestore, `stations/${s.id}/couriers`);
        const couriersSnap = await getDocs(couriersCol);
        const found = couriersSnap.docs.find(
          (d) => (d.data() as any)?.uid === this.uid
        );
        if (found) {
          this.stationId = s.id;
          this.courierId = found.id;
          break;
        }
      }
    }

    if (!this.stationId || !this.courierId) {
      this.loading = false;
      return;
    }

    this.loadTodayHistory();
    this.loadDailyLogs();
  }

  ngOnDestroy() {
    this.unsubs.forEach((u) => {
      try {
        u();
      } catch {}
    });
  }

  private async waitForUser(): Promise<User | null> {
    if (this.auth.currentUser) return this.auth.currentUser;
    return new Promise((resolve) => onAuthStateChanged(this.auth, (u) => resolve(u)));
  }

  // ─────────────────────────────────────────────
  // ✅ Load both Courier personal + Archived Orders for TODAY
  // ─────────────────────────────────────────────
  private loadTodayHistory() {
    if (!this.stationId || !this.courierId) return;

    const todayKey = new Date().toISOString().split('T')[0];

    const personalRef = collection(
      this.firestore,
      `stations/${this.stationId}/couriers/${this.courierId}/deliveryHistory`
    );
    const archivedRef = collection(
      this.firestore,
      `stations/${this.stationId}/archivedOrders`
    );

    const unsubA = onSnapshot(personalRef, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      this.mergeTodayOrders(list, 'personal', todayKey);
    });

    const unsubB = onSnapshot(archivedRef, (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .filter(
          (o) =>
            o?.courier?.id === this.courierId ||
            o?.assignedCourierId === this.courierId
        );
      this.mergeTodayOrders(list, 'archived', todayKey);
    });

    this.unsubs.push(unsubA, unsubB);
  }

  // ─────────────────────────────────────────────
  private personalCache: Record<string, any> = {};
  private archivedCache: Record<string, any> = {};

  private mergeTodayOrders(list: any[], source: 'personal' | 'archived', todayKey: string) {
    const target = source === 'personal' ? this.personalCache : this.archivedCache;
    Object.keys(target).forEach((k) => delete target[k]);
    list.forEach((item) => (target[item.id] = item));

    const map = new Map<string, any>();
    Object.values(this.personalCache).forEach((v: any) => map.set(v.id, v));
    Object.values(this.archivedCache).forEach((v: any) =>
      map.set(v.id, { ...(map.get(v.id) || {}), ...v })
    );

    const merged = Array.from(map.values());

    const normalizeDate = (t: any): Date | null => {
      if (!t) return null;
      if (t instanceof Date) return t;
      if (t instanceof Timestamp) return t.toDate();
      if (typeof t === 'number') return new Date(t * 1000);
      if (typeof t === 'string') return new Date(t);
      if (t?.seconds) return new Date(t.seconds * 1000);
      return null;
    };

    this.todayOrders = merged.filter((o: any) => {
      const d =
        normalizeDate(o.deliveredAt) ||
        normalizeDate(o.completedAt) ||
        normalizeDate(o.archivedAt);
      if (!d) return false;
      const key = d.toISOString().split('T')[0];
      return key === todayKey;
    });

    this.history = this.todayOrders;
    this.computeTodayStats();
    this.loading = false;
  }

  // ─────────────────────────────────────────────
  private computeTodayStats() {
    if (!this.todayOrders.length) {
      this.totalDeliveries = 0;
      this.totalEarnings = 0;
      this.averageDuration = 0;
      return;
    }

    this.totalDeliveries = this.todayOrders.length;
    this.totalEarnings = this.todayOrders.reduce(
      (sum, o) =>
        sum + (Number(o?.charges?.total) || Number(o?.totalAmount) || 0),
      0
    );

    const durations = this.todayOrders
      .map((o) => {
        const start =
          o?.['deliveryStartAt']?.seconds || o?.['createdAt']?.seconds;
        const end =
          o?.['deliveredAt']?.seconds ||
          o?.['completedAt']?.seconds ||
          o?.['archivedAt']?.seconds;
        if (start && end && end > start) {
          const mins = Math.round((end - start) / 60);
          return mins < 600 ? mins : null;
        }
        return null;
      })
      .filter((d: number | null): d is number => d !== null);

    this.averageDuration = durations.length
      ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length)
      : 0;
  }

  // ─────────────────────────────────────────────
  private loadDailyLogs() {
    if (!this.stationId || !this.courierId) return;

    const logsRef = collection(
      this.firestore,
      `stations/${this.stationId}/couriers/${this.courierId}/dailyLogs`
    );
    const q = query(logsRef);

    const unsub = onSnapshot(q, (snap) => {
      this.dailyLogs = snap.docs
        .map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            date: data.date || d.id,
            totalDeliveries: Number(data.totalDeliveries) || 0,
            totalEarnings: Number(data.totalEarnings) || 0,
            averageDuration: Number(data.averageDuration) || 0,
            createdAt: data.createdAt?.toDate?.() || null,
            updatedAt: data.updatedAt?.toDate?.() || null,
          };
        })
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    });

    this.unsubs.push(unsub);
  }

  // ─────────────────────────────────────────────
  onSegmentChange(event: any) {
    this.viewMode = event.detail.value;
  }

openDayLog(date?: string) {
  if (!date) return;
  this.router.navigate(['/courier-daily-log', date]);
}
}
