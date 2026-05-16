// src/app/services/realtime-sync.service.ts
import { Injectable } from '@angular/core';
import {
  Firestore,
  collectionGroup,
  collection,
  onSnapshot,
} from '@angular/fire/firestore';
import { BehaviorSubject } from 'rxjs';

interface RealtimeSnapshot {
  stationId: string;
  couriers: any[];
  orders: any[];
}

@Injectable({ providedIn: 'root' })
export class RealtimeSyncService {
  private _snap$ = new BehaviorSubject<RealtimeSnapshot[]>([]);
  public readonly snap$ = this._snap$.asObservable();

  constructor(private firestore: Firestore) {
    this.startSync();
  }

  private startSync() {
    const stations: Record<string, RealtimeSnapshot> = {};

    // 🔹 Listen to all couriers under every station
    const couriersRef = collectionGroup(this.firestore, 'couriers');
    onSnapshot(couriersRef, (snap) => {
      snap.docs.forEach((d) => {
        const path = d.ref.path.split('/');
        const stationId = path[1];
        if (!stations[stationId]) stations[stationId] = { stationId, couriers: [], orders: [] };

        const data = { id: d.id, ...d.data() };
        const existing = stations[stationId].couriers.findIndex((c) => c.id === d.id);
        if (existing >= 0) stations[stationId].couriers[existing] = data;
        else stations[stationId].couriers.push(data);
      });
      this._snap$.next(Object.values(stations));
    });

    // 🔹 Listen to all active orders
    const ordersRef = collectionGroup(this.firestore, 'orders');
    onSnapshot(ordersRef, (snap) => {
      snap.docs.forEach((d) => {
        const path = d.ref.path.split('/');
        const stationId = path[1];
        if (!stations[stationId]) stations[stationId] = { stationId, couriers: [], orders: [] };

        const data = { id: d.id, ...d.data() };
        const existing = stations[stationId].orders.findIndex((o) => o.id === d.id);
        if (existing >= 0) stations[stationId].orders[existing] = data;
        else stations[stationId].orders.push(data);
      });
      this._snap$.next(Object.values(stations));
    });
  }
}
