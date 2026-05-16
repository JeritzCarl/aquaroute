import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router, ActivatedRoute, RouterModule } from '@angular/router';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { Order } from '../models/order.model';

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
    const nav = this.router.getCurrentNavigation();
    if (nav?.extras?.state?.['order']) {
      this.order = nav.extras.state['order'] as Order;
      this.loading = false;
    }
  }

async ngOnInit() {
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
          const firstItem = data.items?.[0] || {};

          // 🔹 Normalize delivery details
          const delivery = {
            fullName:
              data.delivery?.fullName ||
              data.name ||
              data.customerName ||
              '',
            address:
              data.delivery?.address ||
              data.deliveryAddress ||
              data.address ||
              '',
            phone:
              data.delivery?.phone ||
              data.contact ||
              data.phone ||
              '',
            notes:
              data.delivery?.notes?.trim?.() ||
              data.deliveryNotes ||
              data.notes ||
              data.delivery?.deliveryNotes ||
              firstItem.notes ||
              null,
            window:
              data.delivery?.window ||
              data.delivery?.deliveryWindow ||
              data.deliveryWindow ||
              data.window ||
              firstItem.deliveryWindow ||
              firstItem.slot ||
              null,
            schedule:
              data.delivery?.schedule ||
              data.delivery?.scheduledAt ||
              data.scheduledAt ||
              data.deliverySchedule ||
              firstItem.scheduledAt ||
              data.timeSlot ||
              null,
            mode:
              data.delivery?.mode ||
              data.mode ||
              firstItem.mode ||
              firstItem.deliveryMode ||
              'delivery',
          };

          // 🔹 Normalize charges
          const charges = {
            subtotal:
              data.charges?.subtotal ??
              data.subtotal ??
              0,
            deliveryFee:
              data.charges?.deliveryFee ??
              data.deliveryFee ??
              0,
            total:
              data.charges?.total ??
              data.total ??
              0,
          };

          // 🔹 Normalize mode + delivery fee logic
          const mode =
            (data.mode ||
              firstItem.mode ||
              data.delivery?.mode ||
              'delivery')
              .toString()
              .trim()
              .toLowerCase();

          if (mode === 'pickup') {
            charges.deliveryFee = 0;
            charges.total = charges.subtotal;
          } else {
            // Delivery → ensure fee present
            if (!charges.deliveryFee && charges.subtotal > 0) {
              charges.deliveryFee = 20; // base fee same as Checkout
            }
            charges.total = charges.subtotal + charges.deliveryFee;
          }

          // 🔹 Apply unified normalized structure
          this.order = {
            ...data,
            id: snap.id,
            createdAt: data.createdAt?.toDate
              ? data.createdAt.toDate().toISOString()
              : new Date().toISOString(),
            mode,
            delivery,
            charges,
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

  ngAfterViewInit() {
    if (this.order?.stations?.length) {
      this.order.stations.forEach((st: any) => {
        if (!st.mode) (st as any).mode = 'delivery';
        if (!st.slot) (st as any).slot = 'morning';
      });
    }
  }

  getMode(item: any): string {
    return item?.mode ? this.capitalize(item.mode) : 'Delivery';
  }

  getSlot(item: any): string {
    return item?.slot ? this.capitalize(item.slot) : '—';
  }

  getTime(item: any): string | null {
    return item?.scheduledAt || null;
  }

hasContainerSwap(item: any): boolean {
  // Check item level
  if (item?.containerSwap === true) return true;

  // Check parent order's stations if available
  if (this.order?.stations?.some((st: any) => st?.containerSwap === true)) {
    return true;
  }

  return false;
}

  private capitalize(text: string): string {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  }

  goHome() {
    this.router.navigateByUrl('/landing-page', { replaceUrl: true });
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

  get customerPhone(): string | null {
    const delivery: any = (this.order as any)?.delivery;
    if (!delivery) return null;
    return (
      delivery.phone ||
      delivery.phoneNumber ||
      delivery.contactNumber ||
      delivery.mobile ||
      delivery.mobileNumber ||
      delivery.tel ||
      null
    );
  }

  onImageError(event: any, type: 'station' | 'product') {
  event.target.src =
    type === 'station'
      ? 'assets/AquaRoute Droplet Logo.png'
      : 'assets/water-placeholder.png';
}

  // ─────────────── Firestore Safe Accessors ───────────────
getWindowValue(order: any): string | null {
  if (order?.delivery?.window) return order.delivery.window;
  if (order?.items?.length && (order.items[0] as any).slot)
    return (order.items[0] as any).slot;
  return null;
}

getScheduleValue(order: any): string | null {
  if (order?.delivery?.schedule) return order.delivery.schedule;
  if (order?.items?.length && (order.items[0] as any).scheduledAt)
    return (order.items[0] as any).scheduledAt;
  return null;
}

getNotesValue(order: any): string {
  if (order?.delivery?.notes && order.delivery.notes.trim() !== '')
    return order.delivery.notes;
  if (order?.items?.length && (order.items[0] as any).notes)
    return (order.items[0] as any).notes;
  return '—';
}

getWaterType(item: any): string | null {
  return item?.waterType || '—';
}

getDeliveryRate(): string {
  const schedule = this.getScheduleValue(this.order);
  return schedule === 'ASAP' ? '₱10 per gallon' : '₱5 per gallon';
}

// ─────────────── Delivery Fee & Mode Helpers ───────────────
getDeliveryFee(): number {
  if (!this.order?.charges) return 0;
  return this.order.mode === 'pickup' ? 0 : this.order.charges.deliveryFee || 0;
}

getTotal(): number {
  if (!this.order?.charges) return 0;
  // total already computed in checkout; fallback safeguard
  const subtotal = this.order.charges.subtotal || 0;
  const fee = this.getDeliveryFee();
  return subtotal + fee;
}


// ─────────────── Display Formatters ───────────────
formatWindow(window?: string | null): string {
  if (!window) return '—';
  const w = window.toLowerCase();
  if (w.includes('morning')) return 'Morning';
  if (w.includes('afternoon')) return 'Afternoon';
  if (w.includes('evening')) return 'Evening';
  return window.charAt(0).toUpperCase() + window.slice(1);
}

formatSchedule(schedule?: string | null): string {
  if (!schedule) return '—';
  const clean = schedule.trim();

  // Match HH:mm or H:mm pattern (e.g., 10:00, 9:30)
  const match = clean.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return clean.charAt(0).toUpperCase() + clean.slice(1);

  let h = parseInt(match[1], 10);
  const m = parseInt(match[2] || '0', 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m.toString().padStart(2, '0')} ${ampm}`;
}
}
