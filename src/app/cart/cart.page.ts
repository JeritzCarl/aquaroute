import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, AlertController } from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CartService, CartItem } from '../services/cart.service';

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

  constructor(
    private cartService: CartService,
    private alertCtrl: AlertController,
    private router: Router
  ) {}

  ngOnInit() {
    this.loadCart();
  }

  ionViewWillEnter() {
    this.loadCart();
  }

  private async loadCart() {
    this.cart = await this.cartService.loadCart();
    this.groupByStation();
    this.updateGlobalSelection();
  }

  private groupByStation() {
    const grouped: {
      [key: string]: { stationName: string; items: CartItem[]; selectedAll: boolean };
    } = {};

    this.cart.forEach((item) => {
      const stationName = item.stationName || 'Unknown Station';
      if (!grouped[item.stationId]) {
        grouped[item.stationId] = { stationName, items: [], selectedAll: false };
      }
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
      this.groupedCart.every((group) => group.items.every((item) => item.selected));
    this.globalSelectedAll = allSelected;
  }

  // ===== Delivery Mode & Window =====
  async updateDeliveryMode(item: CartItem) {
    if (item.deliveryMode !== 'scheduled') {
      item.deliveryWindow = undefined;
    }
    await this.cartService.updateItem(item);
    this.loadCart();
  }

  async updateDeliveryWindow(item: CartItem) {
    await this.cartService.updateItem(item);
    this.loadCart();
  }

  // ===== Payment Method =====
  async updatePaymentMethod(item: CartItem) {
    if (item.paymentMethod !== 'cod' && item.paymentMethod !== 'gcash') {
      item.paymentMethod = 'cod'; // fallback
    }
    await this.cartService.updateItem(item);
    this.loadCart();
  }

  // ===== Quantity Controls =====
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
    await this.cartService.removeFromCart(item);
    this.loadCart();
  }

  // ===== Totals =====
  getSelectedCount() {
    return this.cart.filter((item) => item.selected).length;
  }

  hasSelectedItems() {
    return this.getSelectedCount() > 0;
  }

  getSelectedSubtotal(): number {
    return this.cart
      .filter(i => i.selected)
      .reduce((sum, i) =>
        sum + (i.unitPriceComputed ?? i.basePrice ?? i.price ?? 0) * (i.quantity || 1), 0
      );
  }

  // ===== Checkout =====
  async checkoutSelected() {
    const selectedItems = this.cart.filter((item) => item.selected);
    if (selectedItems.length === 0) return;

    await this.cartService.setCheckoutItems(selectedItems);
    this.router.navigate(['/checkout']);
  }

  // ===== Navigation =====
  goToStation(stationId: string) {
    this.router.navigate(['/station', stationId]);
  }
}
