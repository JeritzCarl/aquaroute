import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { RouterModule } from '@angular/router';
import { StationService } from '../services/station.service';
import { CartService } from '../services/cart.service';
import { HttpClient, HttpClientModule } from '@angular/common/http';

@Component({
  selector: 'app-landing-page',
  templateUrl: './landing-page.page.html',
  styleUrls: ['./landing-page.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule, HttpClientModule],
})
export class LandingPage implements OnInit {
  stations: any[] = [];
  filteredStations: any[] = [];
  searchQuery = '';
  cartCount = 0;
  userLocation: { lat: number; lng: number } | null = null;

  private googleApiKey = 'YOUR_GOOGLE_MAPS_API_KEY'; // 🔑 Replace with your real key
  private cacheExpiry = 10 * 60 * 1000; // 10 minutes

  constructor(
    private stationService: StationService,
    private cartService: CartService,
    private http: HttpClient
  ) {}

  async ngOnInit() {
    this.getUserLocation();

    this.stationService.getStations().subscribe((data) => {
      // ✅ Only keep Tuguegarao-based stations
      this.stations = data
        .filter(
          (s: any) =>
            s.stationName !== 'AquaClear Refilling Station' &&
            s.stationName !== 'CrystalDrop Water Station' &&
            s.address?.toLowerCase().includes('tuguegarao')
        )
        .map((station: any) => ({
          ...station,
          distanceKm: null,
          deliveryEstimate: 'Calculating...',
          containers: station.containers ?? [],
          waterTypes: station.waterTypes ?? [],
          minPrice: station.minPrice ?? null,
        }));

      this.filteredStations = [...this.stations];

      if (this.userLocation) {
        this.loadCachedDistances();
      }
    });

    this.cartService.cartCount$.subscribe((count) => (this.cartCount = count));
  }

  // ===== Check cache before calling API =====
  private loadCachedDistances() {
    const cached = localStorage.getItem('stationDistances');
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < this.cacheExpiry) {
        // ✅ Use cached values
        this.stations.forEach((station) => {
          const cachedStation = data.find((s: any) => s.id === station.id);
          if (cachedStation) {
            station.distanceKm = cachedStation.distanceKm;
            station.deliveryEstimate = cachedStation.deliveryEstimate;
          }
        });
        this.filteredStations = [...this.stations];
        return;
      }
    }
    // Cache missing/expired → fetch fresh data
    this.updateDistancesFromGoogle();
  }

  // ===== Google Distance Matrix API =====
  private updateDistancesFromGoogle() {
    if (!this.userLocation || !this.stations.length) return;

    const origins = `${this.userLocation.lat},${this.userLocation.lng}`;
    const destinations = this.stations.map((s) => `${s.lat},${s.lng}`).join('|');

    const url =
      `https://maps.googleapis.com/maps/api/distancematrix/json?units=metric` +
      `&origins=${origins}&destinations=${destinations}&key=${this.googleApiKey}`;

    this.http.get<any>(url).subscribe({
      next: (res) => {
        if (res?.status !== 'OK') {
          console.warn('⚠️ Distance Matrix error:', res);
          this.useFallbackDistances();
          return;
        }

        const elements = res.rows?.[0]?.elements || [];
        this.stations.forEach((station, i) => {
          const el = elements[i];
          if (el?.status === 'OK') {
            station.distanceKm = el.distance.value / 1000;
            station.deliveryEstimate = el.duration.text;
          } else {
            station.distanceKm = this.getDistance(
              this.userLocation!.lat,
              this.userLocation!.lng,
              station.lat,
              station.lng
            );
            station.deliveryEstimate = '30–45 mins';
          }
        });

        // ✅ Save to cache
        localStorage.setItem(
          'stationDistances',
          JSON.stringify({
            data: this.stations.map((s) => ({
              id: s.id,
              distanceKm: s.distanceKm,
              deliveryEstimate: s.deliveryEstimate,
            })),
            timestamp: Date.now(),
          })
        );

        this.filteredStations = [...this.stations];
      },
      error: (err) => {
        console.error('❌ Distance Matrix API blocked:', err);
        this.useFallbackDistances();
      },
    });
  }

  // ===== fallback to haversine if Google API fails =====
  private useFallbackDistances() {
    if (!this.userLocation) return;

    this.stations.forEach((station) => {
      station.distanceKm = this.getDistance(
        this.userLocation!.lat,
        this.userLocation!.lng,
        station.lat,
        station.lng
      );
      station.deliveryEstimate = '30–45 mins';
    });

    this.filteredStations = [...this.stations];
  }

  // ===== Haversine formula =====
  getDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  toRad(value: number): number {
    return (value * Math.PI) / 180;
  }

  async getUserLocation() {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => {
        this.userLocation = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        this.loadCachedDistances();
      });
    } else {
      console.warn('Geolocation not supported.');
    }
  }

  // ===== Filters =====
  filterStations(event: any) {
    this.searchQuery = event.target.value?.toLowerCase().trim() || '';
    if (!this.searchQuery) {
      this.filteredStations = [...this.stations];
      return;
    }
    this.filteredStations = this.stations.filter((station) => {
      const matchesStation =
        station.stationName.toLowerCase().includes(this.searchQuery) ||
        station.address.toLowerCase().includes(this.searchQuery) ||
        station.ownerName?.toLowerCase().includes(this.searchQuery);
      const matchesProducts = station.products?.some((p: any) =>
        p.name?.toLowerCase().includes(this.searchQuery)
      );
      return matchesStation || matchesProducts;
    });
  }

  resetSearch() {
    this.searchQuery = '';
    this.filteredStations = [...this.stations];
  }

  applyFilter(type: string) {
    switch (type) {
      case 'nearest':
        this.filteredStations = [...this.stations].sort(
          (a, b) => (a.distanceKm || Infinity) - (b.distanceKm || Infinity)
        );
        break;
      case 'rating':
        this.filteredStations = [...this.stations].sort((a, b) => b.rating - a.rating);
        break;
      default:
        this.filteredStations = [...this.stations];
    }
  }
}
