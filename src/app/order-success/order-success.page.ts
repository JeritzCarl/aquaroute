import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router, ActivatedRoute, RouterModule } from '@angular/router';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';

import { Order } from '../models/order.model'; // ✅ Use shared model

@Component({
  selector: 'app-order-success',
  standalone: true,
  imports: [IonicModule, CommonModule, RouterModule],
  templateUrl: './order-success.page.html',
  styleUrls: ['./order-success.page.scss'],
})
export class OrderSuccessPage implements OnInit {
  order: Order | null = null;
  loading = true;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private firestore: Firestore
  ) {
    // ✅ First check navigation state (from CheckoutPage)
    const nav = this.router.getCurrentNavigation();
    if (nav?.extras?.state?.['order']) {
      this.order = nav.extras.state['order'] as Order;
      this.loading = false;
    }
  }

  async ngOnInit() {
    // 🔹 Fallback: fetch by ID from Firestore if not passed in state
    if (!this.order) {
      this.route.queryParams.subscribe(async (params) => {
        const orderId = params['id'];
        if (!orderId) {
          this.loading = false;
          return;
        }

        try {
          const ref = doc(this.firestore, 'orders', orderId);
          const snap = await getDoc(ref);

          if (snap.exists()) {
            const data: any = snap.data();

            this.order = {
              ...data,
              id: snap.id,
              createdAt: data.createdAt?.toDate
                ? data.createdAt.toDate().toISOString()
                : new Date().toISOString(),
            } as Order;
          } else {
            console.warn('⚠️ Order not found:', orderId);
          }
        } catch (err) {
          console.error('🔥 Error fetching order:', err);
        } finally {
          this.loading = false;
        }
      });
    }
  }

  // ===== Helpers for expected delivery =====
  getExpectedTime(station: { deliveryWindow?: string }): string {
    switch (station.deliveryWindow?.toLowerCase()) {
      case 'morning':
        return '20–30 mins';
      case 'afternoon':
        return '40–60 mins';
      default:
        return '30–45 mins';
    }
  }

  getExpectedColor(station: { deliveryWindow?: string }): string {
    switch (station.deliveryWindow?.toLowerCase()) {
      case 'morning':
        return 'success';
      case 'afternoon':
        return 'warning';
      default:
        return 'medium';
    }
  }

  // ===== Navigation =====
  goHome() {
    this.router.navigateByUrl('/landing', { replaceUrl: true });
  }

  viewOrders() {
    this.router.navigate(['/orders'], {
      state: { fromOrderSuccess: true },
    });
  }

  trackOrder() {
    if (this.order?.id) {
      this.router.navigate(['/track-order'], {
        queryParams: { id: this.order.id },
      });
    } else {
      this.router.navigate(['/orders']);
    }
  }
}
