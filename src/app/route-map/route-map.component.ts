import { Component, AfterViewInit, Input, OnDestroy, OnChanges, SimpleChanges } from '@angular/core';
import * as L from 'leaflet';
import { CommonModule } from '@angular/common';
import { LatLng, GeoService } from '../services/geo.service';

@Component({
  selector: 'app-route-map',
  standalone: true,
  imports: [CommonModule],
  template: `<div class="map-container" id="map"></div>`,
  styles: [`
    .map-container {
      width: 100%;
      height: 360px;
      border-radius: 14px;
      overflow: hidden;
      background: #eef3f7;
    }
  `]
})
export class RouteMapComponent implements AfterViewInit, OnDestroy, OnChanges {
  // 🔹 Inputs
  @Input() courier?: LatLng | null;
  @Input() orders?: any[] = [];
  @Input() legs: Array<{ from: LatLng; to: LatLng }> = []; // optimized legs (blue route)

  private map!: L.Map;
  private markers: L.Marker[] = [];
  private courierMarker?: L.Marker;
  private polylines: L.Polyline[] = [];
  private lastSig = '';

  private readonly DEFAULT_CENTER: [number, number] = [17.6131, 121.7269];
  private readonly DEFAULT_ZOOM = 13;

  constructor(private geo: GeoService) {}

  ngAfterViewInit() {
    this.map = L.map('map', { zoomControl: true }).setView(this.DEFAULT_CENTER, this.DEFAULT_ZOOM);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(this.map);

    setTimeout(() => this.render(), 500);
  }

  ngOnChanges(_: SimpleChanges) {
    if (!this.map) return;
    const sig = JSON.stringify({
      c: this.courier,
      o: this.orders?.length || 0,
      l: this.legs?.length || 0,
    });
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    this.render();
  }

  private async render() {
    // 🔹 Clear previous markers/lines
    this.markers.forEach(m => m.remove());
    this.polylines.forEach(p => p.remove());
    if (this.courierMarker) this.courierMarker.remove();
    this.markers = [];
    this.polylines = [];
    this.courierMarker = undefined;

    const bounds = L.latLngBounds([]);

    // 🟢 Courier marker (live GPS)
    if (this.courier?.lat && this.courier?.lng) {
      const courierIcon = L.icon({
        iconUrl: 'assets/pins/courier-icon.png',
        iconSize: [34, 34],
        iconAnchor: [17, 34],
      });
      this.courierMarker = L.marker([this.courier.lat, this.courier.lng], { icon: courierIcon })
        .addTo(this.map)
        .bindPopup(`<b>🚴 Courier (Live GPS)</b>`);
      bounds.extend(this.courierMarker.getLatLng());
    }

    // 📦 Delivery points (from orders)
    const deliveries: LatLng[] = [];
    this.orders?.forEach((o, idx) => {
      const lat = o?.delivery?.lat ?? o?.delivery?.latLng?.lat;
      const lng = o?.delivery?.lng ?? o?.delivery?.latLng?.lng;
      if (lat && lng) {
        const pt = { lat: Number(lat), lng: Number(lng) };
        deliveries.push(pt);
        const icon = L.icon({
          iconUrl: 'assets/pins/customer-icon.png',
          iconSize: [28, 28],
          iconAnchor: [14, 28],
        });
        const m = L.marker([pt.lat, pt.lng], { icon })
          .addTo(this.map)
          .bindPopup(`<b>📦 Delivery #${idx + 1}</b>`);
        this.markers.push(m);
        bounds.extend(m.getLatLng());
      }
    });

    // 🩵 Draw both routes
    const waypoints = [this.courier, ...deliveries].filter(Boolean) as LatLng[];
    if (waypoints.length > 1) {
      // ⚫ 1. Longest (alternate) route — gray dashed
      try {
        const longRoute = await this.geo.getRoute(waypoints[0], waypoints[waypoints.length - 1]);
        const grayLine = L.polyline(longRoute.coordinates as [number, number][], {
          color: '#808080',
          weight: 4,
          dashArray: '6,6',
          opacity: 0.6
        }).addTo(this.map);
        grayLine.bindPopup(`<b>⚫ Alternate (Long Route)</b>`);
        this.polylines.push(grayLine);
        bounds.extend(grayLine.getBounds());
      } catch (err) {
        console.warn('⚠️ Long route fetch failed:', err);
      }

      // 🟦 2. Optimized (recommended) route — blue solid
      if (this.legs?.length) {
        const optCoords: [number, number][] = this.legs.map(
          l => [l.from.lat, l.from.lng] as [number, number]
        );
        const blueLine = L.polyline(optCoords as L.LatLngExpression[], {
          color: '#2F80ED',
          weight: 5,
          opacity: 0.9
        }).addTo(this.map);
        blueLine.bindPopup(`<b>🟦 Recommended (Optimized) Route</b>`);
        this.polylines.push(blueLine);
        bounds.extend(blueLine.getBounds());
      }
    }

    // 🗺️ Fit map to bounds
    if (bounds.isValid()) this.map.fitBounds(bounds.pad(0.25));
    else this.map.setView(this.DEFAULT_CENTER, this.DEFAULT_ZOOM);
  }

  ngOnDestroy() {
    if (this.map) this.map.remove();
  }
}
