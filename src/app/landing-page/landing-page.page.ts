import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ToastController } from '@ionic/angular';
import { RouterModule } from '@angular/router';
import { StationService } from '../services/station.service';
import { CartService } from '../services/cart.service';
import { Firestore } from '@angular/fire/firestore';
import { GeoService } from '../services/geo.service';
import { RatingService } from '../services/rating.service';
import { FavoritesService } from '../services/favorites.service';
import { Subscription } from 'rxjs';
import { NotificationService } from '../services/notification.service';
import { collection, onSnapshot } from '@angular/fire/firestore';
import { doc, getDoc } from '@angular/fire/firestore';
import { query, where } from '@angular/fire/firestore';

@Component({
  selector: 'app-landing-page',
  templateUrl: './landing-page.page.html',
  styleUrls: ['./landing-page.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule],
})
export class LandingPage implements OnInit, OnDestroy {
  stations: any[] = [];
  filteredStations: any[] = [];
  searchQuery = '';
  cartCount = 0;
  unreadCount = 0;
  private notifSub?: Subscription;
  userLocation: { lat: number; lng: number } | null = null;
  favSubs: Subscription[] = [];
  favMainSub?: Subscription;

  constructor(
    private stationService: StationService,
    private cartService: CartService,
    private firestore: Firestore,
    private geoService: GeoService,
    private ratingService: RatingService,
    private fav: FavoritesService,
    private toast: ToastController,
    private notifSvc: NotificationService
  ) {}

  async ngOnInit() {
    await this.getUserLocation();

// ✅ Real-time Firestore listener (only active stations)
const stationsRef = collection(this.firestore, 'stations');
const q = query(stationsRef, where('active', '==', true));

onSnapshot(q, async (snapshot) => {
  this.stations = []; // clear current list

  snapshot.forEach((docSnap) => {
    const data: any = { id: docSnap.id, ...docSnap.data() };
    this.stations.push({
      ...data,
      distanceKm: null,
      containers: data.containers ?? [],
      waterTypes: Object.keys(data.availableTypes || {}).filter((t) => data.availableTypes[t]),
      minPrice: data.minPrice ?? null,
      rating: 0,
      reviewCount: 0,
      isFav: false,
    });
  });

  // Sort + update
  this.filteredStations = [...this.stations].sort(
    (a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity)
  );

  if (this.userLocation) {
    await this.computeAllDistances();
    await this.loadRatings();
  }

  this.observeFavorites();
});

    this.cartService.cartCount$.subscribe((count) => (this.cartCount = count));
    // 🔴 Subscribe to unread notifications count
this.notifSub = this.notifSvc.getUnreadCount$().subscribe((count) => {
  this.unreadCount = count;
});

  }

  private observeFavorites() {
    this.favSubs.forEach((s) => s.unsubscribe());
    this.favSubs = [];

    this.favMainSub?.unsubscribe();
    this.favMainSub = this.fav.favoritesList$().subscribe((ids) => {
      this.stations.forEach((station) => {
        station.isFav = ids.includes(station.id);
      });
      this.filteredStations = [...this.stations];
    });

    this.stations.forEach((station) => {
      const sub = this.fav.isFavorite$(station.id).subscribe((isFav) => {
        station.isFav = isFav;
      });
      this.favSubs.push(sub);
    });
  }

    async toggleFavorite(stationId: string) {
    try {
      const res = await this.fav.toggle(stationId);
      const msg = res.favored ? 'Added to favorites ❤️' : 'Removed from favorites 💔';
      const toast = await this.toast.create({
        message: msg,
        duration: 1300,
        color: 'medium',
      });
      await toast.present();
    } catch (err) {
      console.error('Favorite toggle failed:', err);
    }
  }

  // 📍 Get user location
  async getUserLocation() {
    if (navigator.geolocation) {
      return new Promise<void>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            this.userLocation = {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
            };
            this.computeAllDistances();
            this.loadRatings();
            resolve();
          },
          () => {
            this.userLocation = { lat: 17.6131, lng: 121.7270 };
            this.computeAllDistances();
            this.loadRatings();
            resolve();
          }
        );
      });
    } else {
      this.userLocation = { lat: 17.6131, lng: 121.7270 };
      this.computeAllDistances();
      this.loadRatings();
    }
  }

  // 📏 Compute distances
  private async computeAllDistances() {
    if (!this.userLocation) return;
    for (const s of this.stations) {
      try {
        s.distanceKm = this.geoService.computeDistance(
          { lat: this.userLocation.lat, lng: this.userLocation.lng },
          { lat: s.lat, lng: s.lng }
        );
      } catch {
        s.distanceKm = 0;
      }
    }
    this.filteredStations = [...this.stations].sort(
      (a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0)
    );
  }

// ⭐ Load ratings directly from Firestore station doc
private async loadRatings() {
  for (const s of this.stations) {
    try {
      const ref = doc(this.firestore, `stations/${s.id}`);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data() as any;
        s.avgRating = data['avgRating'] ?? 0;
        s.totalRatings = data['totalRatings'] ?? 0;
      } else {
        s.avgRating = 0;
        s.totalRatings = 0;
      }
    } catch (err) {
      console.error(`⚠️ Failed to load rating for ${s.id}:`, err);
      s.avgRating = 0;
      s.totalRatings = 0;
    }
  }

  // Re-render list
  this.filteredStations = [...this.stations];
}

  // 🔍 Search
  filterStations(event: any) {
    this.searchQuery = event.target.value?.toLowerCase().trim() || '';
    if (!this.searchQuery) {
      this.filteredStations = [...this.stations];
      return;
    }
    this.filteredStations = this.stations.filter((s) => {
      const match =
        s.stationName.toLowerCase().includes(this.searchQuery) ||
        s.address.toLowerCase().includes(this.searchQuery) ||
        s.ownerName?.toLowerCase().includes(this.searchQuery);
      const matchProd = s.products?.some((p: any) =>
        p.name?.toLowerCase().includes(this.searchQuery)
      );
      return match || matchProd;
    });
  }

  resetSearch() {
    this.searchQuery = '';
    this.filteredStations = [...this.stations];
  }

  // 🔹 Filter buttons
  applyFilter(type: string) {
    switch (type) {
      case 'nearest':
        this.filteredStations = [...this.stations].sort(
          (a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity)
        );
        break;
      case 'rating':
        this.filteredStations = [...this.stations].sort(
          (a, b) => (b.rating ?? 0) - (a.rating ?? 0)
        );
        break;
      default:
        this.filteredStations = [...this.stations];
    }
  }

  // ─────────────── Fallback image handler ───────────────
onImageError(event: any) {
  event.target.src = 'assets/AquaRoute Droplet Logo.png';
}

getFullAddress(station: any): string {
  const base = station.address?.trim() || '';

  // If address already includes Tuguegarao or zip, return it directly
  const lower = base.toLowerCase();
  if (lower.includes('tuguegarao') || lower.includes('3500')) {
    return base;
  }

  const parts = [
    base,
    station.barangay || '',
    station.city || '',
    station.zipCode || ''
  ].filter((p) => p && p.trim() !== '');

  return parts.join(', ');
}


  ngOnDestroy() {
    this.favSubs.forEach((s) => s.unsubscribe());
    this.favMainSub?.unsubscribe();
    this.notifSub?.unsubscribe();
  }
}
