import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController, AlertController } from '@ionic/angular';
import { ActivatedRoute, Router } from '@angular/router';
import { CartService, CartItem } from '../services/cart.service';
import { StationService } from '../services/station.service';
import { Product } from '../models/product.model';
import { Station } from '../models/station.model';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';

@Component({
  selector: 'app-product',
  templateUrl: './product.page.html',
  styleUrls: ['./product.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule],
})
export class ProductPage implements OnInit {
  product: Product | null = null;
  station: Station | null = null;
  cartCount = 0;

  quantity = 1;
  selectedChoices: Record<string, string> = {};

  // 🕐 Scheduling
  mode: 'delivery' | 'pickup' = 'delivery';
  slot: 'morning' | 'afternoon' | '' = '';
  selectedTime = '';
  availableTimes: string[] = [];

  // 💧 Water types
  availableWaterTypes: string[] = [];
  selectedWaterType: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private cartService: CartService,
    private stationService: StationService,
    private toastCtrl: ToastController,
    private alertCtrl: AlertController,
    private firestore: Firestore
  ) {}

  async ngOnInit() {
    const navState: any = history.state;
    this.product = navState.product ?? null;
    this.station = navState.station ?? null;

    if (!this.product && this.route.snapshot.paramMap.get('id')) {
      const stationId = this.route.snapshot.queryParamMap.get('stationId');
      const productId = this.route.snapshot.paramMap.get('id');

      if (stationId && productId) {
        this.stationService.getProductById(stationId, productId).subscribe((p) => {
          this.product = p;
          this.setDefaultChoices();
        });

        this.stationService.getStationById(stationId).subscribe(async (s) => {
          this.station = s;
          await this.loadAvailableWaterTypes(s.id);
        });
      }
    } else {
      this.setDefaultChoices();
      if (this.station?.id) await this.loadAvailableWaterTypes(this.station.id);
    }

    this.cartService.cartCount$.subscribe((count) => (this.cartCount = count));
  }

  // ──────────────────────────────────────────────
  // 💧 Load available water types dynamically
  // ──────────────────────────────────────────────
  private async loadAvailableWaterTypes(stationId: string) {
    try {
      const ref = doc(this.firestore, `stations/${stationId}`);
      const snap = await getDoc(ref);

      if (snap.exists()) {
        const data: any = snap.data();
        const available = data.availableTypes || {
          Purified: true,
          Alkaline: true,
          Mineral: true,
        };

        // ✅ Only show enabled types
        this.availableWaterTypes = Object.entries(available)
          .filter(([_, isAvail]) => isAvail)
          .map(([type]) => type);

        // ⚠️ Handle if none are available
        if (this.availableWaterTypes.length === 0) {
          const alert = await this.alertCtrl.create({
            header: 'Unavailable',
            message:
              'No water types are currently available for this station. Please try again later.',
            buttons: ['OK'],
          });
          await alert.present();
          this.router.navigate(['/landing-page']);
        }
      } else {
        // fallback if no data found
        this.availableWaterTypes = ['Purified', 'Alkaline', 'Mineral'];
      }
    } catch (err) {
      console.error('Error loading water types:', err);
      this.availableWaterTypes = ['Purified', 'Alkaline', 'Mineral'];
    }
  }

  private setDefaultChoices() {
    this.product?.optionGroups?.forEach((group) => {
      if (group.required && group.options.length > 0) {
        this.selectedChoices[group.id] = group.options[0].id;
      }
    });
  }

  // ──────────────────────────────────────────────
  // ⏰ Mode & Time logic
  // ──────────────────────────────────────────────
  onModeChange() {
    this.slot = '';
    this.selectedTime = '';
  }

  filterAvailableTimes() {
    const open = this.station?.['operatingHours']?.open || '08:00 AM';
    const close = this.station?.['operatingHours']?.close || '06:00 PM';

    const parseTime = (t: string): number => {
      const [hm, period] = t.split(' ');
      const [h, m] = hm.split(':').map(Number);
      return (period === 'PM' && h !== 12 ? h + 12 : h === 12 && period === 'AM' ? 0 : h) * 60 + m;
    };

    const openMins = parseTime(open);
    const closeMins = parseTime(close);
    const times: string[] = [];

    for (let mins = openMins; mins <= closeMins; mins += 30) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      const period = h < 12 ? 'AM' : 'PM';
      const displayH = h % 12 === 0 ? 12 : h % 12;
      const label = `${displayH.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} ${period}`;
      if (this.slot === 'morning' && h < 12) times.push(label);
      if (this.slot === 'afternoon' && h >= 12) times.push(label);
    }

    this.availableTimes = times;
  }

  // ──────────────────────────────────────────────
  // ➕ Quantity
  // ──────────────────────────────────────────────
  increaseQty() { this.quantity++; }
  decreaseQty() { if (this.quantity > 1) this.quantity--; }

  // ──────────────────────────────────────────────
  // 💰 Pricing
  // ──────────────────────────────────────────────
  getUnitPrice(): number {
    if (!this.product) return 0;
    let price = this.product.basePrice ?? this.product.price ?? 0;

    this.product.optionGroups?.forEach((group) => {
      const selectedId = this.selectedChoices[group.id];
      const opt = group.options.find((o) => o.id === selectedId);
      if (opt?.priceDelta) price += opt.priceDelta;
    });

    return price;
  }

  getLineTotal(): number {
    return this.getUnitPrice() * this.quantity;
  }

  // ──────────────────────────────────────────────
  // 🛒 Add to Cart (Full Validation)
  // ──────────────────────────────────────────────
  async addToCart() {
    if (!this.product) return;

    // 🔹 Validate Water Type
    if (!this.selectedWaterType) {
      const alert = await this.alertCtrl.create({
        header: 'Missing Water Type',
        message: 'Please select a water type before adding to cart.',
        buttons: ['OK'],
      });
      await alert.present();
      return;
    }

    // 🔹 Validate Mode
    if (!this.mode) {
      const alert = await this.alertCtrl.create({
        header: 'Missing Order Mode',
        message: 'Please choose whether this is for Delivery or Pick Up.',
        buttons: ['OK'],
      });
      await alert.present();
      return;
    }

    // 🔹 Validate Slot
    if (!this.slot) {
      const alert = await this.alertCtrl.create({
        header: 'Missing Time Slot',
        message: 'Please select a delivery/pickup slot (Morning or Afternoon).',
        buttons: ['OK'],
      });
      await alert.present();
      return;
    }

if (!this.selectedTime) {
  const alert = await this.alertCtrl.create({
    header: 'Missing Delivery Time',
    message: 'Please choose either ASAP (Deliver Now) or a scheduled time.',
    buttons: ['OK'],
  });
  await alert.present();
  return;
}

    // ✅ Compute total pricing
    const unitPrice = this.getUnitPrice();

    const cartItem: CartItem & {
      mode: string;
      slot: string;
      scheduledAt: string;
      waterType: string;
    } = {
      lineId: crypto.randomUUID(),
      productId: this.product.id,
      stationId: this.station?.id ?? '',
      stationName: this.station?.stationName ?? 'Unknown Station',
      name: this.product.name,
      price: this.product.basePrice ?? this.product.price ?? 0,
      quantity: this.quantity,
      imageUrl: this.product.imageUrl,
      choices: this.buildChoices(),
      unitPriceComputed: unitPrice,
      lineTotal: unitPrice * this.quantity,
      selected: false,
      mode: this.mode,
      slot: this.slot,
      scheduledAt: this.selectedTime,
      waterType: this.selectedWaterType!,
    };

    try {
      await this.cartService.addToCart(cartItem);

      const toast = await this.toastCtrl.create({
        message: '✅ Item added to cart successfully!',
        duration: 1600,
        position: 'bottom',
      });
      toast.present();

      this.router.navigate(['/cart']);
    } catch (error) {
      console.error('Add to cart failed:', error);
      const alert = await this.alertCtrl.create({
        header: 'Error',
        message: 'There was an issue adding this item to your cart. Please try again.',
        buttons: ['OK'],
      });
      await alert.present();
    }
  }

  onImageError(event: any) {
  event.target.src = 'assets/water-placeholder.png';
}

  private buildChoices() {
    const choices: any = {};
    this.product?.optionGroups?.forEach((group) => {
      const selectedId = this.selectedChoices[group.id];
      const opt = group.options.find((o) => o.id === selectedId);
      if (opt)
        choices[group.id] = { id: opt.id, label: opt.label, priceDelta: opt.priceDelta ?? 0 };
    });
    return choices;
  }

  goBackToStation() {
    if (this.station?.id) this.router.navigate(['/station', this.station.id]);
    else this.router.navigate(['/landing-page']);
  }
}
