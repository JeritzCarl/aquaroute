import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, AlertController, ToastController } from '@ionic/angular';
import { RouterModule } from '@angular/router';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  updateDoc,
  getDoc,
  getDocs,
  arrayUnion,
  serverTimestamp,
  query,
  where,
  Timestamp,
} from '@angular/fire/firestore';
import { Subscription, Observable } from 'rxjs';
import { Auth } from '@angular/fire/auth';

import { Order, CourierRef } from '../models/order.model';
import { Courier } from '../models/courier.model';
import { UserService } from '../services/user.service';
import { NotificationService } from '../services/notification.service';

@Component({
  selector: 'app-manager-orders',
  templateUrl: './manager-orders.page.html',
  styleUrls: ['./manager-orders.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule],
})
export class ManagerOrdersPage implements OnInit, OnDestroy {
  myOrders$: Observable<Order[]> | null = null;
  myStationId: string | null = null;
  displayName: string | null = null;
  private subs: Subscription[] = [];

  private readonly validTransitions: Record<string, string> = {
    New: 'Preparing',
    Pending: 'Preparing',
    Preparing: 'Out for Delivery',
    'Out for Delivery': 'Delivered',
  };

  constructor(
    private firestore: Firestore,
    private auth: Auth,
    private userService: UserService,
    private notificationService: NotificationService,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController
  ) {}

  async ngOnInit() {
    const sub = this.userService.user$.subscribe(async (user) => {
      if (!user) {
        this.myOrders$ = null;
        return;
      }

      const snap = await getDoc(doc(this.firestore, `users/${user.uid}`));
      if (!snap.exists()) return;

      const role = snap.data()?.['role'];
      if (role !== 'manager') return;

      this.displayName = user.displayName ?? 'Manager';

      const stSnap = await getDocs(
        query(collection(this.firestore, 'stations'), where('ownerId', '==', user.uid))
      );

      if (!stSnap.empty) {
        this.myStationId = stSnap.docs[0].id;
        const ordersRef = collection(this.firestore, `stations/${this.myStationId}/orders`);
        this.myOrders$ = collectionData(ordersRef, { idField: 'id' }) as Observable<Order[]>;
      }
    });

    this.subs.push(sub);
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }

  // ─────────────── STATUS UPDATES ───────────────
  async updateOrderStatus(order: Order, nextStatus: 'Preparing' | 'Out for Delivery' | 'Delivered') {
    if (!this.myStationId || !order?.id) return;

    const orderRef = doc(this.firestore, `stations/${this.myStationId}/orders/${order.id}`);
    const snap = await getDoc(orderRef);
    if (!snap.exists()) return;

    const currentStatus: string = (snap.data() as Order).status || 'New';
    if (this.validTransitions[currentStatus] !== nextStatus) {
      await this.showToast(`⚠️ Can't move ${currentStatus} → ${nextStatus}`, 'warning');
      return;
    }

    await updateDoc(orderRef, {
      status: nextStatus,
      lastUpdatedAt: serverTimestamp(),
      statusHistory: arrayUnion({
        status: nextStatus,
        changedAt: serverTimestamp(),
        by: this.displayName || 'Manager',
      }),
    });

    if (order.userId) {
      await this.notificationService.sendCustomerUpdate(order.userId, order.id!, nextStatus);
    }

    await this.showToast(`✅ Order set to ${nextStatus}`, 'success');
  }

  // ─────────────── ASSIGN COURIER (UI + LOGIC) ───────────────
  async openAssignCourier(order: Order): Promise<void> {
    if (!this.myStationId) return;

    const couriersRef = collection(this.firestore, `stations/${this.myStationId}/couriers`);
    const snapshot = await getDocs(couriersRef);
    const couriers = snapshot.docs.map((d: any) => ({ id: d.id, ...d.data() }));

    if (!couriers.length) {
      await this.showToast('⚠️ No couriers available. Add one first.', 'warning');
      return;
    }

    const alert = await this.alertCtrl.create({
      header: 'Assign Courier',
      inputs: couriers.map((c: any) => ({
        type: 'radio',
        label: `${c.name} (${c.vehicle})`,
        value: c,
      })),
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Assign',
          handler: async (selectedCourier: Courier) => {
            if (!selectedCourier) {
              await this.showToast('⚠️ Please select a courier.', 'warning');
              return false;
            }
            await this.assignCourier(order, selectedCourier);
            return true;
          },
        },
      ],
    });

    await alert.present();
  }

  async assignCourier(order: Order, courier: Courier): Promise<void> {
    if (!this.myStationId || !order?.id) return;

    if (!courier?.id) {
      await this.showToast('⚠️ Courier record missing ID.', 'danger');
      return;
    }

    const orderRef = doc(this.firestore, `stations/${this.myStationId}/orders/${order.id}`);

    const courierRefData: CourierRef = {
      id: courier.id!, // non-null assertion for safety
      name: courier.name,
      vehicle: courier.vehicle,
      eta: courier.eta || null,
      assignedAt: Timestamp.now().toDate(),
    };

    await updateDoc(orderRef, {
      courier: courierRefData,
      assignedCourierId: courier.id!,
      status: 'Preparing',
      lastUpdatedAt: serverTimestamp(),
      statusHistory: arrayUnion({
        status: 'Courier Assigned',
        changedAt: serverTimestamp(),
        by: this.displayName || 'Manager',
      }),
    });

    const courierDoc = doc(this.firestore, `stations/${this.myStationId}/couriers/${courier.id!}`);
    await updateDoc(courierDoc, {
      lastAssignedOrder: order.id,
      assignedAt: serverTimestamp(),
    });

    await this.notificationService.sendCourierAssignment(courier.id!, order.id!);

    if (order.userId) {
      await this.notificationService.sendCustomerUpdate(order.userId, order.id!, 'Courier Assigned');
    }

    await this.showToast(`✅ Assigned ${courier.name} to order ${order.id}`, 'success');
  }

  // ─────────────── CHIP COLOR ───────────────
  public chipColor(status: string): string {
    if (!status) return 'medium';
    const s = status.toLowerCase();
    if (s.includes('new') || s.includes('pending')) return 'warning';
    if (s.includes('prepar')) return 'secondary';
    if (s.includes('out for delivery')) return 'tertiary';
    if (s.includes('delivered')) return 'success';
    return 'medium';
  }

  // ─────────────── TOAST ───────────────
  private async showToast(message: string, color: 'success' | 'warning' | 'danger') {
    const toast = await this.toastCtrl.create({ message, duration: 2000, color });
    await toast.present();
  }
}
