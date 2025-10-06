import { Component, AfterViewInit, Input, OnDestroy, OnChanges, SimpleChanges } from '@angular/core';
import * as L from 'leaflet';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-route-map',
  standalone: true,
  imports: [CommonModule, HttpClientModule],
  template: `<div class="map-container" id="map"></div>`,
  styles: [`
    .map-container {
      width: 100%;
      height: 350px;
      border-radius: 12px;
      overflow: hidden;
      background: #f2f4f7;
    }
  `]
})
export class RouteMapComponent implements AfterViewInit, OnDestroy, OnChanges {
  @Input() start: string = '';              // Station / starting point
  @Input() end: string = '';                // Optional destination
  @Input() waypoints: string[] = [];        // Delivery addresses
  @Input() courierActive: boolean = false;  // Live tracking toggle

  private map!: L.Map;
  private markers: L.Marker[] = [];
  private courierMarker: L.Marker | null = null;
  private watchId: number | null = null;
  private lastRenderSignature = '';

  constructor(private http: HttpClient) {}

  async ngAfterViewInit() {
    this.initMap();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.map) return;

    const sig = JSON.stringify({
      start: this.start,
      end: this.end,
      waypoints: this.waypoints,
      active: this.courierActive
    });

    if (sig === this.lastRenderSignature) return;
    this.lastRenderSignature = sig;

    clearTimeout((this as any)._refreshTimer);
    (this as any)._refreshTimer = setTimeout(() => this.refreshMap(), 600);
  }

  // ───────────────────────────────────────────────
  // Initialize Map
  // ───────────────────────────────────────────────
  private async initMap() {
    this.map = L.map('map').setView([17.6131, 121.7269], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(this.map);

    await this.renderAll();
  }

  private async refreshMap() {
    this.markers.forEach(m => m.remove());
    this.markers = [];
    if (this.courierMarker) {
      this.courierMarker.remove();
      this.courierMarker = null;
    }
    await this.renderAll();
  }

  // ───────────────────────────────────────────────
  // Render Station, Deliveries, and Courier
  // ───────────────────────────────────────────────
  private async renderAll() {
    const coordsList: L.LatLngExpression[] = [];

    // 🟦 Station Marker (Blue)
    if (this.start) {
      const formattedStart = this.formatAddress(this.start);
      const s = await this.geocodeCached(formattedStart);
      if (s) {
        const stationMarker = L.marker([s.lat, s.lng], {
          icon: L.icon({
            iconUrl: 'https://cdn-icons-png.flaticon.com/512/484/484167.png',
            iconSize: [30, 30],
          })
        }).addTo(this.map).bindPopup(`🏠 Station<br>${this.start}`);
        this.markers.push(stationMarker);
        coordsList.push([s.lat, s.lng]);
      } else {
        console.warn('⚠️ Could not geocode station:', this.start);
      }
    }

    // 🟧 Delivery Markers (Orange)
    for (const [i, w] of this.waypoints.entries()) {
      const formatted = this.formatAddress(w);
      const r = await this.geocodeCached(formatted);
      if (r) {
        const deliveryMarker = L.marker([r.lat, r.lng], {
          icon: L.icon({
            iconUrl: 'https://cdn-icons-png.flaticon.com/512/854/854878.png',
            iconSize: [28, 28],
          })
        }).addTo(this.map).bindPopup(`📦 Delivery ${i + 1}<br>${w}`);
        this.markers.push(deliveryMarker);
        coordsList.push([r.lat, r.lng]);
      }
    }

    // 🟩 Optional End Marker (Green)
    if (this.end && this.end.trim() && this.end !== this.start) {
      const formattedEnd = this.formatAddress(this.end);
      const e = await this.geocodeCached(formattedEnd);
      if (e) {
        const endMarker = L.marker([e.lat, e.lng], {
          icon: L.icon({
            iconUrl: 'https://cdn-icons-png.flaticon.com/512/149/149060.png',
            iconSize: [30, 30],
          })
        }).addTo(this.map).bindPopup(`🏁 Destination<br>${this.end}`);
        this.markers.push(endMarker);
        coordsList.push([e.lat, e.lng]);
      }
    }

    // 🟢 Courier Live Marker
    this.startCourierTracking();

    // Fit all markers into view
    if (coordsList.length) {
      const group = L.featureGroup(this.markers);
      this.map.fitBounds(group.getBounds().pad(0.25));
    } else {
      this.map.setView([17.6131, 121.7269], 13);
    }
  }

  // ───────────────────────────────────────────────
  // Live GPS Tracking (Courier)
  // ───────────────────────────────────────────────
  private startCourierTracking() {
    if (!('geolocation' in navigator)) return;
    if (this.watchId) navigator.geolocation.clearWatch(this.watchId);

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;

        if (!this.courierMarker) {
          this.courierMarker = L.circleMarker([lat, lng], {
            radius: 7,
            color: '#2ecc71',
            fillColor: '#27ae60',
            fillOpacity: 0.9,
          }) as unknown as L.Marker;
          this.courierMarker.addTo(this.map).bindPopup('🟢 Courier Location');
        } else {
          this.courierMarker.setLatLng([lat, lng]);
        }

        if (this.courierActive) {
          this.map.setView([lat, lng], 14);
        }
      },
      (err) => console.warn('⚠️ GPS error:', err),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
    );
  }

  // ───────────────────────────────────────────────
  // Improved Address Formatting (Tuguegarao bias)
  // ───────────────────────────────────────────────
  private formatAddress(raw: string): string {
    let base = raw.trim();

    // Always bias geocoding to Tuguegarao City
    if (!/tuguegarao/i.test(base)) {
      base += ', Tuguegarao City';
    }
    if (!/cagayan/i.test(base)) {
      base += ', Cagayan, Cagayan Valley, Philippines';
    }
    return base;
  }

  // ───────────────────────────────────────────────
  // Geocoding with Cache (Accurate Tuguegarao Fix)
  // ───────────────────────────────────────────────
  private async geocodeCached(query: string): Promise<{ lat: number; lng: number } | null> {
    const key = `geo_${query.toLowerCase().replace(/\s+/g, '_')}`;
    const cached = localStorage.getItem(key);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {}
    }

    try {
      // Bias to Tuguegarao and prioritize results near it
      const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&countrycodes=ph&q=${encodeURIComponent(query)}&viewbox=121.67,17.64,121.75,17.58&bounded=1`;
      const res = await this.http.get<any[]>(url).toPromise();
      if (res && res.length > 0) {
        const { lat, lon } = res[0];
        const coords = { lat: parseFloat(lat), lng: parseFloat(lon) };
        localStorage.setItem(key, JSON.stringify(coords));
        console.log(`📍 Geocoded "${query}" →`, coords);
        return coords;
      }
    } catch (err) {
      console.warn('⚠️ Geocode failed for', query, err);
    }
    return null;
  }

  ngOnDestroy(): void {
    if (this.map) this.map.remove();
    if (this.watchId) navigator.geolocation.clearWatch(this.watchId);
  }
}
