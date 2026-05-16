import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, AlertController } from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CartService, CartItem } from '../services/cart.service';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';

@Component({
  selector: 'app-cart',
  templateUrl: './cart.page.html',
  styleUrls: ['./cart.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule, FormsModule],
})
export class CartPage implements OnInit {
  cart: CartItem[] = [];
  groupedCart: {
    stationId: string;
    stationName: string;
    items: CartItem[];
    selectedAll?: boolean;
  }[] = [];
  globalSelectedAll = false;
  availableTimes: string[] = [];

  // 💧 available water types per station
  stationWaterTypes: Record<string, string[]> = {};

  constructor(
    private cartService: CartService,
    private alertCtrl: AlertController,
    private router: Router,
    private firestore: Firestore
  ) {}

  // ────────────────────────────────
  // Lifecycle
  // ────────────────────────────────
  ngOnInit() {
    this.loadCart();
    this.generateTimes();
  }

  ionViewWillEnter() {
    this.loadCart();
  }

  // ────────────────────────────────
  // Load Cart + Station Info
  // ────────────────────────────────
  private async loadCart() {
    this.cart = await this.cartService.loadCart();
    this.groupByStation();
    await this.loadStationWaterTypes();
    this.updateGlobalSelection();
  }

  private groupByStation() {
    const grouped: { [key: string]: { stationName: string; items: CartItem[]; selectedAll: boolean } } = {};
    this.cart.forEach((item) => {
      const stationName = item.stationName || 'Unknown Station';
      if (!grouped[item.stationId]) grouped[item.stationId] = { stationName, items: [], selectedAll: false };
      item.selected = item.selected || false;
      grouped[item.stationId].items.push(item);
    });
    this.groupedCart = Object.keys(grouped).map((stationId) => ({
      stationId,
      stationName: grouped[stationId].stationName,
      items: grouped[stationId].items,
      selectedAll: grouped[stationId].items.every((i) => i.selected),
    }));
  }

  // 🔹 Load available water types from Firestore
  private async loadStationWaterTypes() {
    for (const group of this.groupedCart) {
      const ref = doc(this.firestore, `stations/${group.stationId}`);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data: any = snap.data();
        const available = data.availableTypes || {
          Purified: true,
          Alkaline: true,
          Mineral: true,
        };
        this.stationWaterTypes[group.stationId] = Object.entries(available)
          .filter(([_, isAvail]) => isAvail)
          .map(([type]) => type);
      } else {
        this.stationWaterTypes[group.stationId] = ['Purified', 'Alkaline', 'Mineral'];
      }
    }
  }

  // ────────────────────────────────
  // Selections
  // ────────────────────────────────
  toggleStationSelection(group: any) {
    group.items.forEach((item: CartItem) => (item.selected = group.selectedAll));
    this.updateGlobalSelection();
  }

  toggleGlobalSelection() {
    this.groupedCart.forEach((group) => {
      group.selectedAll = this.globalSelectedAll;
      group.items.forEach((item) => (item.selected = this.globalSelectedAll));
    });
  }

  updateGlobalSelection() {
    const allSelected =
      this.groupedCart.length > 0 &&
      this.groupedCart.every((g) => g.items.every((i) => i.selected));
    this.globalSelectedAll = allSelected;
  }

  getItemFeeRate(item: any): number {
  const mode = (item?.mode || 'delivery').toString().trim().toLowerCase();
  if (mode === 'pickup') return 0;

  const schedule = (item?.scheduledAt || '').toString().trim().toUpperCase();
  return schedule === 'ASAP' ? 10 : 5;
}

getItemDeliveryFee(item: any): number {
  const mode = (item?.mode || 'delivery').toString().trim().toLowerCase();
  if (mode === 'pickup') return 0;

  return this.getItemFeeRate(item) * Number(item?.quantity || 0);
}

  // ────────────────────────────────
  // Editable Fields
  // ────────────────────────────────
  async updateMode(item: CartItem) {
    if (item.mode === 'pickup') item.address = undefined;
    await this.cartService.updateItem(item);
    this.loadCart();
  }

  async updateSlot(item: CartItem) {
    item.scheduledAt = '';
    await this.cartService.updateItem(item);
    this.loadCart();
  }

  async updateTime(item: CartItem) {
    await this.cartService.updateItem(item);
    this.loadCart();
  }

  async updateWaterType(item: CartItem) {
    await this.cartService.updateItem(item);
  }

  // ────────────────────────────────
  // Generate 12-hour Times
  // ────────────────────────────────
  private generateTimes() {
    const times: string[] = [];
    const labels = ['AM', 'PM'];
    for (let h = 1; h <= 12; h++) {
      for (let m = 0; m < 60; m += 15) {
        const mm = m.toString().padStart(2, '0');
        const hh = h.toString().padStart(2, '0');
        for (const label of labels) times.push(`${hh}:${mm} ${label}`);
      }
    }
    this.availableTimes = times;
  }

  // ───────────── Image Error Fallback (station-like) ─────────────
onImageError(event: any, type: 'station' | 'product') {
  event.target.src =
    type === 'station'
      ? 'assets/station1.png'
      : 'assets/water-placeholder.png';
}

  // ────────────────────────────────
  // Quantity / Remove
  // ────────────────────────────────
  async increaseQty(item: CartItem) {
    await this.cartService.increaseQty(item);
    this.loadCart();
  }

  async decreaseQty(item: CartItem) {
    await this.cartService.decreaseQty(item);
    this.loadCart();
  }

async removeItem(item: CartItem) {
  if (!item.lineId) return;

  const alert = await this.alertCtrl.create({
    header: 'Remove Item',
    message: `Are you sure you want to remove "${item.name}" from your cart?`,
    buttons: [
      {
        text: 'Cancel',
        role: 'cancel'
      },
      {
        text: 'Delete',
        role: 'destructive',
        handler: async () => {
          await this.cartService.removeFromCart(item);
          this.loadCart();
        }
      }
    ]
  });

  await alert.present();
}

  // ────────────────────────────────
  // Validation & Checkout
  // ────────────────────────────────
  getSelectedCount() {
    return this.cart.filter((i) => i.selected).length;
  }

  getSelectedSubtotal(): number {
    return this.cart
      .filter((i) => i.selected)
      .reduce((sum, i) => sum + (i.unitPriceComputed ?? i.basePrice ?? i.price ?? 0) * (i.quantity || 1), 0);
  }

    isCartValid(): boolean {
      return this.cart
        .filter((i) => i.selected)
        .every((i) =>
          !!i.mode &&
          !!i.slot &&
          !!i.scheduledAt &&
          !!i.waterType
        );
    }

  async checkoutSelected() {
    const selectedItems = this.cart.filter((i) => i.selected);
    if (selectedItems.length === 0) return;

    // 🔸 Revalidate fields before checkout
    const invalidItems = selectedItems.filter(
      (i) => !i.mode || !i.slot || !i.scheduledAt || !i.waterType
    );
    if (invalidItems.length > 0) {
      const alert = await this.alertCtrl.create({
        header: 'Incomplete Details',
        message:
          'Please ensure all selected items have valid <b>mode</b>, <b>slot</b>, <b>time or ASAP selection</b>, and <b>water type</b> before checkout.',
        buttons: ['OK'],
      });
      await alert.present();
      return;
    }

    await this.cartService.setCheckoutItems(selectedItems);
    this.router.navigate(['/checkout']);
  }

  goToStation(id: string) {
    this.router.navigate(['/station', id]);
  }
}
