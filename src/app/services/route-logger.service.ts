// src/app/services/route-logger.service.ts
import { Injectable } from '@angular/core';
import {
  Firestore,
  collection,
  addDoc,
  serverTimestamp,
} from '@angular/fire/firestore';

@Injectable({ providedIn: 'root' })
export class RouteLoggerService {
  constructor(private firestore: Firestore) {}

  async logRouteSample(sample: {
    stationId: string;
    courierId: string;
    orderId: string;
    distance: number;
    duration: number;
    eta: number;
    routeGeoJSON: any;
  }) {
    const ref = collection(this.firestore, `ml_routes/tuguegarao/samples`);
    await addDoc(ref, {
      ...sample,
      createdAt: serverTimestamp(),
    });
    console.log('🧠 Logged ML route sample:', sample);
  }
}
