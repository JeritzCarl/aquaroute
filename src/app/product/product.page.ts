import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController, AlertController } from '@ionic/angular';
import { ActivatedRoute, Router } from '@angular/router';
import { CartService, CartItem } from '../services/cart.service';
import { StationService } from '../services/station.service';
import { Product } from '../models/product.model';
import { Station } from '../models/station.model';

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
  selectedAddons = new Set<string>();
  deliveryMode: 'delivery' | 'pickup' | 'scheduled' = 'delivery';
  deliveryWindow?: 'morning' | 'afternoon';
  paymentMethod: 'cod' | 'gcash' | undefined = 'cod'; // ✅ default COD

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private cartService: CartService,
    private stationService: StationService,
    private toastCtrl: ToastController,
    private alertCtrl: AlertController
  ) {}

  ngOnInit() {
    const navState: any = history.state;
    this.product = navState.product ?? null;
    this.station = navState.station ?? null;

    if (!this.product) {
      const stationId = this.route.snapshot.queryParamMap.get('stationId');
      const productId = this.route.snapshot.paramMap.get('id');

      if (stationId && productId) {
        this.stationService.getProductById(stationId, productId).subscribe((p) => {
          this.product = p;
          this.setDefaultChoices();
        });
        this.stationService.getStationById(stationId).subscribe((s) => {
          this.station = s;
        });
      }
    } else {
      this.setDefaultChoices();
    }

    this.cartService.cartCount$.subscribe((count) => (this.cartCount = count));
  }

  private setDefaultChoices() {
    this.product?.optionGroups?.forEach((group) => {
      if (group.required && group.options.length > 0) {
        this.selectedChoices[group.id] = group.options[0].id;
      }
    });
  }

  toggleAddon(id: string) {
    if (this.selectedAddons.has(id)) {
      this.selectedAddons.delete(id);
    } else {
      this.selectedAddons.add(id);
    }
  }

  increaseQty() {
    this.quantity++;
  }

  decreaseQty() {
    if (this.quantity > 1) this.quantity--;
  }

  getUnitPrice(): number {
    if (!this.product) return 0;
    let price = this.product.basePrice ?? this.product.price ?? 0;

    this.product.optionGroups?.forEach((group) => {
      const selectedId = this.selectedChoices[group.id];
      const opt = group.options.find((o) => o.id === selectedId);
      if (opt?.priceDelta) price += opt.priceDelta;
    });

    this.product.addons?.forEach((addon) => {
      if (this.selectedAddons.has(addon.id)) price += addon.price;
    });

    return price;
  }

  getLineTotal(): number {
    return this.getUnitPrice() * this.quantity;
  }

  async addToCart() {
    if (!this.product) return;

    if (this.deliveryMode === 'scheduled' && !this.deliveryWindow) {
      const alert = await this.alertCtrl.create({
        header: 'Missing Delivery Window',
        message: 'Please select a delivery window.',
        buttons: ['OK'],
      });
      await alert.present();
      return;
    }

    const unitPrice = this.getUnitPrice();

    const cartItem: CartItem = {
      lineId: crypto.randomUUID(),
      productId: this.product.id,
      stationId: this.station?.id ?? '',
      stationName: this.station?.stationName ?? 'Unknown Station',
      name: this.product.name,
      price: this.product.basePrice ?? this.product.price ?? 0,
      quantity: this.quantity,
      imageUrl: this.product.imageUrl,
      choices: this.buildChoices(),
      addons: this.buildAddons(),
      deliveryMode: this.deliveryMode,
      deliveryWindow: this.deliveryMode === 'scheduled' ? this.deliveryWindow : undefined,
      paymentMethod: this.paymentMethod,
      unitPriceComputed: unitPrice,
      lineTotal: unitPrice * this.quantity,
      selected: false,
    };

    await this.cartService.addToCart(cartItem);

    const toast = await this.toastCtrl.create({
      message: 'Item added to cart',
      duration: 1500,
      position: 'bottom',
    });
    toast.present();

    this.router.navigate(['/cart']);
  }

  private buildChoices() {
    const choices: any = {};
    this.product?.optionGroups?.forEach((group) => {
      const selectedId = this.selectedChoices[group.id];
      const opt = group.options.find((o) => o.id === selectedId);
      if (opt) {
        choices[group.id] = {
          id: opt.id,
          label: opt.label,
          priceDelta: opt.priceDelta ?? 0,
        };
      }
    });
    return choices;
  }

  private buildAddons() {
    return (
      this.product?.addons
        ?.filter((a) => this.selectedAddons.has(a.id))
        .map((a) => ({ id: a.id, label: a.label, price: a.price })) ?? []
    );
  }

  goBackToStation() {
    if (this.station?.id) {
      this.router.navigate(['/station', this.station.id]);
    } else {
      this.router.navigate(['/landing-page']);
    }
  }
}
