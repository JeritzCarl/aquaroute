import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController } from '@ionic/angular';
import { Observable, Subscription } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';
import { CartService } from '../services/cart.service';
import { StationService } from '../services/station.service';
import { FavoritesService } from '../services/favorites.service';
import { Product } from '../models/product.model';
import { Station } from '../models/station.model';
import { GeoService } from '../services/geo.service';
import { RatingService } from '../services/rating.service';
import { doc, onSnapshot, Firestore } from '@angular/fire/firestore';

@Component({
  selector: 'app-station',
  templateUrl: './station.page.html',
  styleUrls: ['./station.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule, RouterModule],
})
export class StationPage implements OnInit, OnDestroy {
  stationId: string | null = null;
  station: Station | null = null;

  products$: Observable<Product[]> = new Observable<Product[]>();
  productsSnapshot: Product[] = [];

  cartCount = 0;
  isFav = false;
  favSub?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private stationService: StationService,
    private cartService: CartService,
    private fav: FavoritesService,
    private router: Router,
    private toastCtrl: ToastController,
    private geoService: GeoService,
    private ratingService: RatingService,
    private firestore: Firestore
  ) {}

  ngOnInit() {
    this.stationId = this.route.snapshot.paramMap.get('id');
    if (!this.stationId) return;

    this.loadStation();
    this.loadProducts();

    this.cartService.cartCount$.subscribe((count) => (this.cartCount = count));
  }

  ngOnDestroy() {
    this.favSub?.unsubscribe();
  }

// ────────────────────────────────
// 🏪 Load Station Details (Real-time isOpen + Rating + Distance)
// ────────────────────────────────
private async loadStation() {
  if (!this.stationId) return;

  const stationRef = doc(this.firestore, `stations/${this.stationId}`);

  // 🔹 Real-time Firestore listener for live updates
  onSnapshot(stationRef, async (snap) => {
    if (!snap.exists()) return;
    const data = snap.data() as any;

    // 🔹 Step 1: Compute accurate distance once
    let distanceKm = null;
    if (navigator.geolocation && data.lat && data.lng) {
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject)
        );
        const userLat = pos.coords.latitude;
        const userLng = pos.coords.longitude;
        distanceKm = this.geoService.computeDistance(
          { lat: userLat, lng: userLng },
          { lat: data.lat, lng: data.lng }
        );
      } catch (err) {
        console.warn('⚠️ Geolocation failed:', err);
      }
    }

    // 🔹 Step 2: Pull ratings directly from Firestore (live reflection)
    const avgRating = data.avgRating ?? 0;
    const totalRatings = data.totalRatings ?? 0;

    // 🔹 Step 3: Build full station object with live status + ratings
    this.station = {
      id: snap.id,
      ...data,
      isOpen: data.isOpen === true || data.status === 'open',
      openingTime: data.openingTime || '7:00 AM',
      closingTime: data.closingTime || '5:00 PM',
      rating: avgRating,
      reviewCount: totalRatings,
      distanceKm: distanceKm ?? data.distanceKm ?? this.mockDistance(),
    };

    // 🔹 Step 4: Sync favorites
    this.favSub?.unsubscribe();
    this.favSub = this.fav.isFavorite$(this.station!.id).subscribe((v) => {
      if (v !== this.isFav) this.isFav = v;
    });

    // 🔹 Step 5: Optional closed notice
    if (!this.station?.['isOpen']) {
      const toast = await this.toastCtrl.create({
        message: '🚫 This station is currently closed.',
        duration: 2500,
        color: 'medium',
      });
      await toast.present();
    }
  });
}

onImageError(event: any, type: 'station' | 'product') {
  const fallback =
    type === 'station'
      ? 'assets/AquaRoute Droplet Logo.png'
      : 'assets/water-placeholder.png';
  event.target.src = fallback;
}

  // ────────────────────────────────
  // 💧 Load Products
  // ────────────────────────────────
  private loadProducts() {
    if (!this.stationId) return;

    this.products$ = this.stationService.getProducts(this.stationId).pipe(
      map((products: Product[]) =>
        products.map((p: any) => ({
          ...p,
          basePrice: p.basePrice ?? p.price ?? 0,
          inStock: true,
          waterType: p.waterType ?? 'Purified',
          containerSize: p.containerSize ?? '20L',
        }))
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.products$.subscribe((products) => {
      this.productsSnapshot = products;
    });
  }


async toggleFavorite() {
  if (!this.station) return;

  const previous = this.isFav;
  this.isFav = !previous; // instant local feedback

  try {
    const res = await this.fav.toggle(this.station.id);
    this.isFav = res.favored; // confirm exact state from Firestore

    const toast = await this.toastCtrl.create({
      message: res.favored ? 'Added to favorites ❤️' : 'Removed from favorites 💔',
      duration: 1200,
      color: 'medium',
    });
    await toast.present();
  } catch (e) {
    console.error('Favorite toggle failed:', e);
    this.isFav = previous;
  }
}



  // ────────────────────────────────
  // 🛒 Navigation
  // ────────────────────────────────
  goToCart() {
    this.router.navigate(['/cart']);
  }

  async goToProduct(product: Product) {
    if (this.station && !this.station['isOpen']) {
      const toast = await this.toastCtrl.create({
        message: '🚫 Station is closed. Ordering is disabled.',
        duration: 2000,
        color: 'medium',
      });
      await toast.present();
      return;
    }

    this.router.navigate(['/product', product.id], {
      state: { product, station: this.station },
      queryParams: { stationId: this.station?.id },
    });
  }

  goBack() {
    this.router.navigate(['/landing-page']);
  }

  private mockDistance(): number {
    return parseFloat((Math.random() * 4.5 + 0.5).toFixed(1));
  }
}
