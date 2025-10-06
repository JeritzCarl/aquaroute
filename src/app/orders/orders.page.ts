import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import {
  Firestore,
  collection,
  query,
  orderBy,
  onSnapshot,
  getDocs,
  doc,
  updateDoc
} from '@angular/fire/firestore';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';

// Angular + Ionic
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonicModule,
  LoadingController,
  ToastController,
  AlertController
} from '@ionic/angular';

interface Order {
  id: string;
  userId: string;   // ✅ replace uid
  stations: any[];
  items: any[];
  charges: { subtotal: number; deliveryFee: number; total: number; currency: string };
  delivery: { fullName: string; address: string; notes?: string };
  payment: { method: string; status: string };
  status: string;
  createdAt: any;
}


@Component({
  selector: 'app-orders',
  standalone: true,
  templateUrl: './orders.page.html',
  styleUrls: ['./orders.page.scss'],
  imports: [IonicModule, CommonModule, FormsModule],
  providers: [DatePipe],
})
export class OrdersPage implements OnInit, OnDestroy {
  selectedTab: 'current' | 'history' = 'current';
  orders: Order[] = [];
  currentOrders: Order[] = [];
  orderHistory: Order[] = [];
  loading: boolean = true;

  private unsubscribeOrders: (() => void) | null = null;
  private fromOrderSuccess = false; // ✅ flag

  constructor(
    private router: Router,
    private firestore: Firestore,
    private auth: Auth,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController,
    private alertCtrl: AlertController
  ) {
    // ✅ Check navigation state
    const nav = this.router.getCurrentNavigation();
    if (nav?.extras?.state?.['fromOrderSuccess']) {
      this.fromOrderSuccess = true;
    }
  }

ngOnInit() {
  onAuthStateChanged(this.auth, (user) => {
    if (user) {
      this.listenToOrders(user.uid); // ✅ pass uid but treat it as userId
    } else {
      this.cleanup();
    }
  });
}

  ngOnDestroy() {
    if (this.unsubscribeOrders) this.unsubscribeOrders();
  }

  private cleanup() {
    this.orders = [];
    this.currentOrders = [];
    this.orderHistory = [];
    this.loading = false;
  }


// ===== Live Listener (with conditional toasts) =====
listenToOrders(userId: string) {
  const ordersRef = collection(this.firestore, `users/${userId}/orders`);
  const q = query(ordersRef, orderBy('createdAt', 'desc'));

  if (this.unsubscribeOrders) this.unsubscribeOrders();

  this.unsubscribeOrders = onSnapshot(q, (snapshot) => {
    snapshot.docChanges().forEach(async (change) => {
      const data: any = change.doc.data();
      const orderId = change.doc.id;

      // ✅ Only show toast if navigated from OrderSuccess
      if (this.fromOrderSuccess) {
        if (change.type === 'added') {
          await this.showToast(`🆕 Order placed successfully! (#${orderId})`, 'success');
        }
        if (change.type === 'modified') {
          await this.showToast(`📢 Order update: ${data.status}`, 'medium');
        }
      }
    });

    this.orders = snapshot.docs.map(doc => {
      const data: any = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate
          ? data.createdAt.toDate()
          : new Date(),
      } as Order;
    });

    this.splitOrders();
    this.loading = false;

    // ✅ Reset flag after first snapshot
    this.fromOrderSuccess = false;
  });
}


// ===== Manual Refresh =====
async refreshOrders() {
  const user = this.auth.currentUser;
  if (!user) return;

  const loading = await this.loadingCtrl.create({
    message: 'Refreshing orders...',
    spinner: 'crescent',
    duration: 1500,
  });
  await loading.present();

  try {
    const ordersRef = collection(this.firestore, `users/${user.uid}/orders`);
    const q = query(ordersRef, orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);

    this.orders = snap.docs.map(doc => {
      const data: any = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate
          ? data.createdAt.toDate()
          : new Date(),
      } as Order;
    });

    this.splitOrders();
  } catch (err) {
    console.error('Refresh failed:', err);
  } finally {
    loading.dismiss();
  }
}

  // ===== Split Orders =====
  splitOrders() {
    this.currentOrders = this.orders.filter(o =>
      ['Pending', 'Placed', 'Preparing', 'Out for Delivery'].includes(o.status)
    );
    this.orderHistory = this.orders.filter(o =>
      ['Delivered', 'Completed', 'Cancelled'].includes(o.status)
    );
  }

  // ===== Confirm + Cancel Order =====
  async confirmCancel(order: Order) {
    const alert = await this.alertCtrl.create({
      header: 'Cancel Order',
      message: 'Are you sure you want to cancel this order?',
      buttons: [
        { text: 'No', role: 'cancel' },
        {
          text: 'Yes, Cancel',
          role: 'destructive',
          handler: () => this.cancelOrder(order)
        }
      ]
    });

    await alert.present();
  }

// ===== Confirm + Cancel Order =====
async cancelOrder(order: Order) {
  try {
    const user = this.auth.currentUser;
    if (!user) return;

    // Update in user's subcollection
    const userOrderRef = doc(this.firestore, `users/${user.uid}/orders/${order.id}`);
    await updateDoc(userOrderRef, { status: 'Cancelled' });

    // Optional: Update in global orders collection too
    const globalOrderRef = doc(this.firestore, `orders/${order.id}`);
    await updateDoc(globalOrderRef, { status: 'Cancelled' });

    await this.showToast('Order cancelled successfully.', 'danger');
  } catch (err) {
    console.error('Cancel failed:', err);
    await this.showToast('Failed to cancel order.', 'warning');
  }
}


  // ===== Helpers =====
  getStatusColor(status: string): string {
    switch (status) {
      case 'Pending':
      case 'Placed':
      case 'Preparing':
        return 'warning';
      case 'Out for Delivery':
        return 'primary';
      case 'Delivered':
      case 'Completed':
        return 'success';
      case 'Cancelled':
        return 'danger';
      default:
        return 'medium';
    }
  }

  getStationTitle(order: Order): string {
    return order.stations?.length > 1
      ? 'Multiple Stations'
      : order.stations[0]?.stationName || 'Unknown Station';
  }

  // ✅ Navigate with queryParams (matches current routing)
  goToOrder(order: Order) {
    this.router.navigate(['/track-order'], {
      queryParams: { id: order.id }
    });
  }

  // ===== Toast helper =====
  private async showToast(message: string, color: 'success' | 'warning' | 'danger' | 'medium') {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2000,
      color,
    });
    await toast.present();
  }
}
