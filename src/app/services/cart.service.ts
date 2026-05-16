import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import {
  Firestore,
  collection,
  doc,
  setDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  DocumentData,
  QueryDocumentSnapshot,
  SnapshotOptions
} from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';

// ────────────────────────────────
// 🧩 Updated CartItem Interface (Fixed Type)
// ────────────────────────────────
export interface CartItem {
  lineId: string;
  productId: string;
  stationId: string;
  stationName: string;
  name: string;
  basePrice?: number;
  price?: number;
  quantity: number;
  imageUrl?: string;
  choices?: any;
  addons?: any[];

  // ✅ Unified fields for mode handling
  mode?: 'delivery' | 'pickup' | 'scheduled';
  slot?: 'morning' | 'afternoon';
  scheduledAt?: string;
  address?: string;

  // 💧 New field (fixed type)
  waterType?: string;

  unitPriceComputed?: number;
  lineTotal?: number;
  selected?: boolean;
}

// ────────────────────────────────
// 🔄 Firestore Converter
// ────────────────────────────────
const cartItemConverter = {
  toFirestore(item: CartItem): DocumentData {
    const { selected, ...rest } = item;
    return rest;
  },
  fromFirestore(snapshot: QueryDocumentSnapshot, options: SnapshotOptions): CartItem {
    const data = snapshot.data(options) as CartItem;
    const normalizedPrice = data.unitPriceComputed ?? data.basePrice ?? data.price ?? 0;

    return {
      ...data,
      basePrice: data.basePrice ?? data.price ?? 0,
      price: data.price ?? data.basePrice ?? 0,
      unitPriceComputed: normalizedPrice,
      lineTotal: normalizedPrice * (data.quantity || 1),

      // ✅ Defaults
      mode: data.mode ?? 'delivery',
      slot: data.slot ?? 'morning',
      scheduledAt: data.scheduledAt ?? '',
      waterType: data.waterType ?? undefined,
      selected: false,
    };
  },
};

// ────────────────────────────────
// 🛒 Cart Service
// ────────────────────────────────
@Injectable({ providedIn: 'root' })
export class CartService {
  private cart: CartItem[] = [];
  private cartCount = new BehaviorSubject<number>(0);
  private checkoutItems: CartItem[] = [];

  cartCount$ = this.cartCount.asObservable();

  constructor(private db: Firestore, private auth: Auth) {
    this.loadFromLocalStorage();
  }

  // ===== Local Storage =====
  private saveToLocalStorage() {
    localStorage.setItem('cart', JSON.stringify(this.cart));
    localStorage.setItem('checkoutItems', JSON.stringify(this.checkoutItems));
  }

  private loadFromLocalStorage() {
    const cartData = localStorage.getItem('cart');
    this.cart = cartData ? JSON.parse(cartData) : [];

    const checkoutData = localStorage.getItem('checkoutItems');
    this.checkoutItems = checkoutData ? JSON.parse(checkoutData) : [];

    this.updateCartCount();
  }

  // ===== Load Cart =====
  async loadCart() {
    if (!this.auth.currentUser) {
      this.cart = [];
      this.updateCartCount();
      this.saveToLocalStorage();
      return [];
    }
    const uid = this.auth.currentUser.uid;
    const ref = collection(this.db, `users/${uid}/cart`).withConverter(cartItemConverter);
    const snap = await getDocs(ref);
    this.cart = snap.docs.map((d) => d.data());
    this.updateCartCount();
    this.saveToLocalStorage();
    return this.cart;
  }

  getCart(): CartItem[] {
    if (this.cart.length === 0) this.loadFromLocalStorage();
    return this.cart;
  }

  // ===== Add or Merge =====
  async addToCart(item: CartItem) {
    if (!this.auth.currentUser) return;
    const uid = this.auth.currentUser.uid;

    if (!item.lineId) item.lineId = crypto.randomUUID();
    if (!item.mode) item.mode = 'delivery';
    if (!item.slot) item.slot = 'morning';
    if (!item.waterType) item.waterType = undefined;

    const unitPrice = item.unitPriceComputed ?? item.basePrice ?? item.price ?? 0;
    item.unitPriceComputed = unitPrice;
    item.lineTotal = unitPrice * (item.quantity || 1);

    const idx = this.cart.findIndex((i) => i.lineId === item.lineId);
    if (idx > -1) {
      this.cart[idx].quantity += item.quantity;
      this.cart[idx].lineTotal =
        (this.cart[idx].unitPriceComputed ?? this.cart[idx].basePrice ?? this.cart[idx].price ?? 0) *
        this.cart[idx].quantity;

      await updateDoc(
        doc(this.db, `users/${uid}/cart/${item.lineId}`),
        cartItemConverter.toFirestore(this.cart[idx])
      );
    } else {
      this.cart.push(item);
      await setDoc(
        doc(this.db, `users/${uid}/cart/${item.lineId}`),
        cartItemConverter.toFirestore(item),
        { merge: true }
      );
    }
    this.updateCartCount();
    this.saveToLocalStorage();
  }

  // ===== Update Item =====
  async updateItem(item: CartItem) {
    if (!this.auth.currentUser) return;
    const uid = this.auth.currentUser.uid;

    const unitPrice = item.unitPriceComputed ?? item.basePrice ?? item.price ?? 0;
    item.unitPriceComputed = unitPrice;
    item.lineTotal = unitPrice * (item.quantity || 1);

    await updateDoc(
      doc(this.db, `users/${uid}/cart/${item.lineId}`),
      cartItemConverter.toFirestore(item)
    );

    const idx = this.cart.findIndex((i) => i.lineId === item.lineId);
    if (idx > -1) this.cart[idx] = { ...item };
    this.updateCartCount();
    this.saveToLocalStorage();
  }

  // ===== Quantity =====
  async increaseQty(item: CartItem) {
    item.quantity++;
    item.lineTotal =
      (item.unitPriceComputed ?? item.basePrice ?? item.price ?? 0) * item.quantity;
    await this.updateItem(item);
  }

  async decreaseQty(item: CartItem) {
    if (item.quantity > 1) {
      item.quantity--;
      item.lineTotal =
        (item.unitPriceComputed ?? item.basePrice ?? item.price ?? 0) * item.quantity;
      await this.updateItem(item);
    } else {
      await this.removeFromCart(item);
    }
  }

  // ===== Remove =====
  async removeFromCart(item: CartItem) {
    if (!this.auth.currentUser) return;
    const uid = this.auth.currentUser.uid;
    this.cart = this.cart.filter((i) => i.lineId !== item.lineId);
    await deleteDoc(doc(this.db, `users/${uid}/cart/${item.lineId}`));
    this.updateCartCount();
    this.saveToLocalStorage();
  }

  async clearCart() {
    const uid = this.auth.currentUser?.uid;

    if (uid && this.cart.length > 0) {
      try {
        const deletes = this.cart.map((item) =>
          deleteDoc(doc(this.db, `users/${uid}/cart/${item.lineId}`))
        );
        await Promise.all(deletes);
      } catch (e) {
        console.warn('Failed to delete some cart items:', e);
      }
    }

    this.cart = [];
    this.checkoutItems = [];
    this.updateCartCount();
    localStorage.removeItem('cart');
    localStorage.removeItem('checkoutItems');
    this.saveToLocalStorage();
  }

  // ===== Checkout Items =====
  async setCheckoutItems(items: CartItem[]) {
    this.checkoutItems = items;
    this.saveToLocalStorage();
  }

  getCheckoutItems(): CartItem[] {
    if (this.checkoutItems.length === 0) this.loadFromLocalStorage();
    return this.checkoutItems;
  }

  // ===== Count =====
  private updateCartCount() {
    const count = this.cart.reduce((sum, i) => sum + (i.quantity || 0), 0);
    this.cartCount.next(count);
  }
}
