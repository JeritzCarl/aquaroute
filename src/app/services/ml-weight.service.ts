import { Injectable } from '@angular/core';
import {
  Firestore,
  collection,
  getDocs,
  doc,
  setDoc
} from '@angular/fire/firestore';

@Injectable({ providedIn: 'root' })
export class MLWeightService {
  constructor(private firestore: Firestore) {}

  // ================================
  // KEEP EXISTING (NO BREAK)
  // ================================
  async getWeights(): Promise<Record<string, number>> {
    const statsRef = collection(this.firestore, 'ml_stats');
    const snap = await getDocs(statsRef);
    const weights: Record<string, number> = {};

    snap.forEach((docSnap) => {
      const d = docSnap.data() as any;
      if (d.avgMinutes && d.totalTrips) {
        weights[docSnap.id] = Math.max(1, d.avgMinutes / 30);
      }
    });

    return weights;
  }

  // ================================
  // GET RAW DELIVERY LOGS
  // ================================
  async getLogs(): Promise<any[]> {
    const logsRef = collection(this.firestore, 'ml_delivery_logs');
    const snap = await getDocs(logsRef);
    return snap.docs.map((d) => d.data());
  }

  // ================================
  // HELPERS
  // ================================
  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  private getTimeFactorFromBucket(stat: any, hourBucket?: string): number {
    if (hourBucket === 'morning') return Number(stat.morningFactor || 1);
    if (hourBucket === 'afternoon') return Number(stat.afternoonFactor || 1);
    if (hourBucket === 'evening') return Number(stat.eveningFactor || 1);
    return 1;
  }

  private getSafeDateValue(value: any): number {
    if (!value) return 0;

    if (typeof value === 'string' || typeof value === 'number') {
      const t = new Date(value).getTime();
      return Number.isFinite(t) ? t : 0;
    }

    if (typeof value?.toDate === 'function') {
      const t = value.toDate().getTime();
      return Number.isFinite(t) ? t : 0;
    }

    return 0;
  }

  // ================================
  // TRAIN FROM LOGS (UPGRADED)
  // ================================
  async trainFromLogs(): Promise<void> {
    const logs = await this.getLogs();

    const grouped: Record<string, any[]> = {};

    for (const log of logs) {
      const brgy = log.barangay || 'Unknown';

      if (!grouped[brgy]) {
        grouped[brgy] = [];
      }

      grouped[brgy].push(log);
    }

    for (const barangay of Object.keys(grouped)) {
      const entries = grouped[barangay];

      const validEntries = entries.filter((e) => {
        const mins = Number(e.durationMinutes || 0);
        return mins > 0 && mins <= 180;
      });

      const totalTrips = validEntries.length;

      const totalMinutes = validEntries.reduce(
        (sum, e) => sum + (Number(e.durationMinutes) || 0),
        0
      );

      const avgMinutes = totalTrips > 0 ? totalMinutes / totalTrips : 20;

      // Learn distance factor from actual minutes per km
      const distanceEntries = validEntries.filter(
        (e) => Number(e.distanceKm || 0) > 0
      );

      let distanceFactor = 3;
      if (distanceEntries.length > 0) {
        const avgDistanceRatio =
          distanceEntries.reduce((sum, e) => {
            const mins = Number(e.durationMinutes) || 0;
            const dist = Number(e.distanceKm) || 1;
            return sum + mins / dist;
          }, 0) / distanceEntries.length;

        distanceFactor = this.clamp(avgDistanceRatio * 0.35, 1, 8);
      }

      // Learn item factor from actual minutes per item count
      const itemEntries = validEntries.filter(
        (e) => Number(e.itemCount || 0) > 0
      );

      let itemFactor = 1;
      if (itemEntries.length > 0) {
        const avgItemRatio =
          itemEntries.reduce((sum, e) => {
            const mins = Number(e.durationMinutes) || 0;
            const items = Number(e.itemCount) || 1;
            return sum + mins / items;
          }, 0) / itemEntries.length;

        itemFactor = this.clamp(avgItemRatio * 0.08, 0.5, 3);
      }

      // Learn time bucket factors relative to the barangay baseline
      const bucketAverage = (bucket: string): number => {
        const bucketEntries = validEntries.filter((e) => e.hourBucket === bucket);
        if (!bucketEntries.length) return 1;

        const bucketAvg =
          bucketEntries.reduce((sum, e) => {
            return sum + (Number(e.durationMinutes) || 0);
          }, 0) / bucketEntries.length;

        return this.clamp(bucketAvg / (avgMinutes || 1), 0.8, 1.3);
      };

      const morningFactor = bucketAverage('morning');
      const afternoonFactor = bucketAverage('afternoon');
      const eveningFactor = bucketAverage('evening');

      const statRef = doc(this.firestore, 'ml_stats', barangay);

      await setDoc(statRef, {
        barangay,
        avgMinutes: Math.round(avgMinutes),
        totalTrips,
        distanceFactor: Number(distanceFactor.toFixed(2)),
        itemFactor: Number(itemFactor.toFixed(2)),
        morningFactor: Number(morningFactor.toFixed(2)),
        afternoonFactor: Number(afternoonFactor.toFixed(2)),
        eveningFactor: Number(eveningFactor.toFixed(2)),
        updatedAt: new Date()
      });
    }
  }

  // ================================
  // GET ONE AREA STAT
  // ================================
  async getAreaStat(barangay?: string): Promise<any> {
    const statsRef = collection(this.firestore, 'ml_stats');
    const snap = await getDocs(statsRef);

    let result: any = null;

    snap.forEach((docSnap) => {
      if (docSnap.id === (barangay || 'Unknown')) {
        result = docSnap.data();
      }
    });

    if (!result) {
      return {
        avgMinutes: 20,
        totalTrips: 0,
        distanceFactor: 3,
        itemFactor: 1,
        morningFactor: 1,
        afternoonFactor: 1,
        eveningFactor: 1
      };
    }

    return result;
  }

  // ================================
  // PREDICT DELIVERY TIME (UPGRADED)
  // ================================
  async predictDeliveryMinutes(input: {
    barangay?: string;
    distanceKm?: number;
    itemCount?: number;
    hourBucket?: 'morning' | 'afternoon' | 'evening';
  }): Promise<{
    predictedMinutes: number;
    confidence: string;
  }> {
    const stat = await this.getAreaStat(input.barangay);

    const base = Number(stat.avgMinutes || 20);
    const distance = Number(input.distanceKm || 0);
    const items = Number(input.itemCount || 1);

    const distanceFactor = Number(stat.distanceFactor || 3);
    const itemFactor = Number(stat.itemFactor || 1);
    const timeFactor = this.getTimeFactorFromBucket(stat, input.hourBucket);

    const rawPrediction =
      (base + distance * distanceFactor + items * itemFactor) * timeFactor;

    let confidence = 'low';
    if (Number(stat.totalTrips || 0) >= 15) confidence = 'high';
    else if (Number(stat.totalTrips || 0) >= 5) confidence = 'medium';

    return {
      predictedMinutes: Math.max(5, Math.round(rawPrediction)),
      confidence
    };
  }

  // ================================
  // ACTUAL VS PREDICTED DATA
  // ================================
  async getActualVsPredicted(limitCount: number = 10): Promise<{
    labels: string[];
    actual: number[];
    predicted: number[];
  }> {
    const logs = await this.getLogs();

    const cleaned = logs
      .filter((log) => {
        const actual = Number(log.durationMinutes || 0);
        const predicted = Number(log.predictedMinutes || 0);
        return actual > 0 && actual <= 180 && predicted > 0 && predicted <= 180;
      })
      .sort((a, b) => {
        const aTime =
          this.getSafeDateValue(a.deliveredAt) ||
          this.getSafeDateValue(a.createdAt);
        const bTime =
          this.getSafeDateValue(b.deliveredAt) ||
          this.getSafeDateValue(b.createdAt);
        return bTime - aTime;
      })
      .slice(0, limitCount)
      .reverse();

    return {
      labels: cleaned.map((log, index) => {
        const shortId = log.orderId ? String(log.orderId).slice(-4) : `${index + 1}`;
        return `Order ${shortId}`;
      }),
      actual: cleaned.map((log) => Math.round(Number(log.durationMinutes || 0))),
      predicted: cleaned.map((log) => Math.round(Number(log.predictedMinutes || 0))),
    };
  }

  // ================================
  // FEATURE IMPORTANCE
  // ================================
  async getFeatureImportance(): Promise<{
    labels: string[];
    values: number[];
  }> {
    const statsRef = collection(this.firestore, 'ml_stats');
    const snap = await getDocs(statsRef);

    const rows = snap.docs.map((d) => d.data() as any);
    const validRows = rows.filter((r) => Number(r.totalTrips || 0) > 0);

    if (!validRows.length) {
      return {
        labels: ['Distance', 'Item Count', 'Morning', 'Afternoon', 'Evening'],
        values: [0, 0, 0, 0, 0],
      };
    }

    const avg = (key: string, fallback = 0) =>
      validRows.reduce((sum, row) => sum + Number(row[key] || fallback), 0) / validRows.length;

    const distance = avg('distanceFactor', 0);
    const items = avg('itemFactor', 0);
    const morning = Math.abs(avg('morningFactor', 1) - 1);
    const afternoon = Math.abs(avg('afternoonFactor', 1) - 1);
    const evening = Math.abs(avg('eveningFactor', 1) - 1);

    return {
      labels: ['Distance', 'Item Count', 'Morning', 'Afternoon', 'Evening'],
      values: [
      Number(distance.toFixed(2)),
      Number(items.toFixed(2)),
      Number(morning.toFixed(2)),
      Number(afternoon.toFixed(2)),
      Number(evening.toFixed(2)),
    ],
    };
  }
}