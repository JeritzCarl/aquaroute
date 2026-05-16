import { Component, OnInit, OnDestroy, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ToastController } from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';
import {
  Firestore,
  collection,
  collectionData,
  query,
  where,
  doc,
  onSnapshot,
} from '@angular/fire/firestore';
import { Subscription } from 'rxjs';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';


interface StatusHistoryEntry {
  status: string;
  changedAt?: any;
  by?: string;
  note?: string | null;
}

interface ArchivedOrder {
  id?: string;
  delivery?: { fullName?: string; address?: string };
  courier?: { name?: string; vehicle?: string };
  charges?: { total?: number };
  createdAt?: any;
  completedAt?: any;
  deliveredAt?: any;
  archivedAt?: any;
  archived?: boolean;
  status?: string;
  stationId?: string;
  deliveryStartAt?: any;
  statusHistory?: StatusHistoryEntry[];
  totalAmount?: number;
  durationMinutes?: number;
  _createdAt?: Date | null;
  _completedAt?: Date | null;
  _deliveredAt?: Date | null;
  _archivedAt?: Date | null;
}

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
  selector: 'app-manager-completed',
  templateUrl: './manager-completed.page.html',
  styleUrls: ['./manager-completed.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule],
})
export class ManagerCompletedPage implements OnInit, OnDestroy {
  completedOrders: ArchivedOrder[] = [];
  todayOrders: ArchivedOrder[] = [];
  viewMode: 'today' | 'history' = 'today';

  myStationId: string | null = null;
  subs: Subscription[] = [];
  loading = true;

  totalRevenue = 0;
  averageDuration = 0;
  dailyLogs: DailyLog[] = [];

  isOpen = false;
  operatingHours = '';
  showTodaySummary = false;

  private cachedArchived: ArchivedOrder[] = [];
  private cachedOrders: ArchivedOrder[] = [];
  private cachedHistory: ArchivedOrder[] = [];

  constructor(
    private firestore: Firestore,
    private auth: Auth,
    private toastCtrl: ToastController,
    private router: Router,
    private zone: NgZone
  ) {}

  async ngOnInit(): Promise<void> {
    if (!this.auth.currentUser) {
      await new Promise<void>((resolve) => {
        const unsub = onAuthStateChanged(this.auth, () => {
          unsub();
          resolve();
        });
      });
    }

    const userId = this.auth.currentUser?.uid;
    if (!userId) {
      this.loading = false;
      return;
    }

    const stationsQ = query(
      collection(this.firestore, 'stations'),
      where('ownerId', '==', userId)
    );

    const stationSub = collectionData(stationsQ, { idField: 'id' }).subscribe(
      (stations: any[]) => {
        if (!stations?.length) {
          this.completedOrders = [];
          this.todayOrders = [];
          this.loading = false;
          return;
        }

        const station = stations[0];
        this.myStationId = station.id;

        this.isOpen = !!station.isOpen;
        this.operatingHours = station.operatingHours || 'Not specified';

        if (this.myStationId) {
          this.listenToStationStatus(this.myStationId);
          this.listenToAllOrders(this.myStationId);
          this.loadDailyLogs();
        }
      }
    );

    this.subs.push(stationSub);
  }

  private listenToStationStatus(stationId: string) {
    const stationDoc = doc(this.firestore, `stations/${stationId}`);
    const unsub = onSnapshot(stationDoc, (snap) => {
      if (snap.exists()) {
        const data = snap.data() as any;
        this.isOpen = !!data.isOpen;
        this.operatingHours = data.operatingHours || 'Not specified';
      }
    });
    this.subs.push({ unsubscribe: unsub } as any);
  }

  private listenToAllOrders(stationId: string) {
    const activeRef = collection(this.firestore, `stations/${stationId}/orders`);
    const sub1 = collectionData(activeRef, { idField: 'id' }).subscribe(
      (orders: ArchivedOrder[]) => {
        const delivered = orders.filter(
          (o) => o.status === 'Delivered' || o.status === 'completed'
        );
        this.cachedOrders = delivered;
        this.mergeAndRender();
      }
    );

    const archivedRef = collection(
      this.firestore,
      `stations/${stationId}/archivedOrders`
    );
    const sub2 = collectionData(archivedRef, { idField: 'id' }).subscribe(
      (archived: ArchivedOrder[]) => {
        this.cachedArchived = archived;
        this.mergeAndRender();
      }
    );

    const historyRef = collection(
      this.firestore,
      `stations/${stationId}/orderHistory`
    );
    const sub3 = collectionData(historyRef, { idField: 'id' }).subscribe(
      (history: ArchivedOrder[]) => {
        this.cachedHistory = history;
        this.mergeAndRender();
      }
    );

    this.subs.push(sub1, sub2, sub3);
  }

  private mergeAndRender(): void {
    const map = new Map<string, ArchivedOrder>();
    const allSets = [
      ...this.cachedOrders,
      ...this.cachedArchived,
      ...this.cachedHistory,
    ];

    for (const o of allSets) {
      if (!o?.id) continue;
      const prev = map.get(o.id) || {};
      map.set(o.id, { ...prev, ...o });
    }

    const toDate = (t: any): Date | null => {
      if (!t) return null;
      if (t instanceof Date) return t;
      if (typeof t === 'number') return new Date(t);
      if (typeof t === 'string') return new Date(t);
      if (t?.toDate) return t.toDate();
      if (t?.seconds) return new Date(t.seconds * 1000);
      return null;
    };

    const merged: ArchivedOrder[] = Array.from(map.values()).map((o) => ({
      ...o,
      _createdAt: toDate(o.createdAt),
      _completedAt: toDate(o.completedAt),
      _deliveredAt: toDate(o.deliveredAt),
    }));

    merged.sort(
      (a, b) =>
        (b._deliveredAt?.getTime?.() || 0) - (a._deliveredAt?.getTime?.() || 0)
    );

    this.completedOrders = merged;
    this.todayOrders = merged.filter((o) =>
      this.isToday(o._deliveredAt || o._completedAt)
    );

    this.computeAnalytics();
    this.loading = false;
  }

  private isToday(date?: Date | null): boolean {
    if (!date) return false;
    const now = new Date();
    return (
      date.getDate() === now.getDate() &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear()
    );
  }

  private computeAnalytics(): void {
    if (!this.todayOrders.length) {
      this.totalRevenue = 0;
      this.averageDuration = 0;
      return;
    }

    this.totalRevenue = this.todayOrders.reduce(
      (sum, o) =>
        sum + (Number(o?.charges?.total) || Number(o?.totalAmount) || 0),
      0
    );

    const durations = this.todayOrders
      .map((o) => {
        const start =
          o?.['deliveryStartAt']?.seconds || o?.['createdAt']?.seconds;
        const end =
          o?.['deliveredAt']?.seconds || o?.['completedAt']?.seconds;
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

  // ✅ Fixed version
  private async loadDailyLogs() {
    if (!this.myStationId) return;

    const logsRef = collection(
      this.firestore,
      `stations/${this.myStationId}/dailyLogs`
    );
    const q = query(logsRef);

    const unsub = onSnapshot(q, (snapshot) => {
      this.zone.run(() => {
        this.dailyLogs = snapshot.docs.map((doc) => {
          const data = doc.data() as any;
          return {
            id: doc.id,
            date: data.date || doc.id,
            totalDeliveries: Number(data.totalDeliveries ?? 0),
            totalEarnings: Number(data.totalEarnings ?? 0),
            averageDuration: Number(data.averageDuration ?? 0),
            createdAt: data.createdAt?.toDate?.() || null,
            updatedAt: data.updatedAt?.toDate?.() || null,
          } as DailyLog;
        });

        this.dailyLogs.sort((a, b) =>
          (b.date || '').localeCompare(a.date || '')
        );

        const todayKey = new Date().toISOString().split('T')[0];
        const todayLog =
          this.dailyLogs.find(
            (l) =>
              (l.date && l.date.includes(todayKey)) ||
              (l.id && l.id.includes(todayKey))
          ) || null;

        if (todayLog) {
          this.totalRevenue = todayLog.totalEarnings || 0;
          this.averageDuration = todayLog.averageDuration || 0;
          this.showTodaySummary = true;
        } else {
          this.showTodaySummary = false;
        }
      });
    });

    this.subs.push({ unsubscribe: unsub } as any);
  }

  // ✅ Segment + navigation handlers
  onSegmentChange(event: any) {
    this.viewMode = event.detail.value;
    if (this.viewMode === 'history') this.loadDailyLogs();
  }

  openDayLog(date: string) {
    if (!date) {
      console.warn('⚠️ No valid date found for day log navigation.');
      return;
    }
    const normalized = date.split('T')[0].trim();
    console.log('🔗 Opening daily log for', normalized);
    this.router.navigate(['/manager-daily-log', normalized]);
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }

  async showToast(message: string, color: 'success' | 'warning' | 'danger') {
    const toast = await this.toastCtrl.create({
      message,
      color,
      duration: 1800,
    });
    await toast.present();
  }
}
