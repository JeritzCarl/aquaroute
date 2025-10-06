// src/app/models/product.model.ts

export interface ProductOption {
  id: string;             // unique ID for the option
  label: string;          // display name (e.g. "Purified", "Alkaline")
  price: number;          // base or total price for this option
  priceDelta?: number;    // ✅ extra price relative to product.basePrice
  required?: boolean;     // whether user must choose it
}

export interface ProductOptionGroup {
  id: string;             // unique ID for the group
  name: string;           // group name (e.g. "Water Type", "Container Size")
  required?: boolean;     // must pick at least one
  multiple?: boolean;     // allow multiple selections
  options: ProductOption[];
}

export interface ProductAddon {
  id: string;
  label: string;          // display name (e.g. "Extra Bottle")
  price: number;          // cost of the addon
}

export interface Product {
  id: string;
  name: string;
  basePrice: number;      // ✅ always used in UI
  price?: number;         // ✅ fallback from Firestore
  description?: string;
  stock: number;
  inStock: boolean;
  category?: string;
  imageUrl?: string;
  addons?: ProductAddon[];
  optionGroups?: ProductOptionGroup[];
  createdAt?: any;

  // ⭐ New fields (survey-driven)
  waterType?: string;       // e.g. Purified, Alkaline
  containerSize?: string;   // e.g. 20L, 10L, 5L
}
