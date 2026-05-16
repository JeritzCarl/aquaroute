import { Component, OnInit, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { IonicModule, ToastController } from '@ionic/angular';
import { Router } from '@angular/router';
import { AlertController } from '@ionic/angular';

import { CartService, CartItem } from '../services/cart.service';
import { StationService } from '../services/station.service';
import { NotificationService } from '../services/notification.service';

import { Firestore, collection, doc, setDoc, serverTimestamp, getDoc, collectionData } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';

import { HttpClient, HttpClientModule } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Station } from '../models/station.model';
import { Order } from '../models/order.model';
import * as L from 'leaflet';
import { Geolocation } from '@capacitor/geolocation';
import { LatLng, GeoService } from '../services/geo.service';

interface UserContact {
  fullName: string;
  address: string;
  notes?: string;
  lat?: number;
  lng?: number;
  phone?: string;
  isDefault?: boolean;
}

type PaymentMethod = 'COD' | 'GCASH';

type StationGroup = Pick<Station, 'id' | 'stationName' | 'address'> & {
  items: CartItem[];
  mode?: 'delivery' | 'pickup';
  lat?: number;
  lng?: number;
  logoUrl?: string;
  containerSwap?: boolean;
  deliveryFee?: number;
  eta?: { distance: string; duration: string };
  isOpen?: boolean;
  operatingHours?: string;
  gcashName?: string;
  gcashNumber?: string;
};


@Component({
  selector: 'app-checkout',
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, HttpClientModule],
  templateUrl: './checkout.page.html',
  styleUrls: ['./checkout.page.scss'],
})
export class CheckoutPage implements OnInit, AfterViewInit {
  // ─────────────── Core State ───────────────
  stations: StationGroup[] = [];
  addresses: any[] = [];
  selectedAddressId: string | null = null;
  contact: UserContact = { fullName: '', address: '', notes: '', lat: undefined, lng: undefined };
  payment: PaymentMethod = 'COD';
  deliveryNotes: string = '';

gcashReferenceNumber: string = '';
proofFile: File | null = null;
proofPreviewUrl: string = '';
isUploadingProof: boolean = false;

// Cloudinary config
private readonly cloudinaryCloudName = 'ddmbxblmz';
private readonly cloudinaryUploadPreset = 'aquaroute_unsigned';

  // ─────────────── Map + Location ───────────────
  mapCenter = { lat: 17.6131, lng: 121.7270 };
  approximateLocation = false;

  private map!: L.Map;
  private customerMarker?: L.Marker;
  private stationMarkers: L.Marker[] = [];
  private routeLines: L.Polyline[] = [];

  private isInTuguegarao(lat: number, lng: number): boolean {
    return lat >= 17.58 && lat <= 17.68 && lng >= 121.69 && lng <= 121.75;
  }

  eta: { distance: string; duration: string } | null = null;

  constructor(
    private cartService: CartService,
    private stationService: StationService,
    private router: Router,
    private toastCtrl: ToastController,
    private firestore: Firestore,
    private auth: Auth,
    private http: HttpClient,
    private notifications: NotificationService,
    private alertCtrl: AlertController
  ) {
    // Apply address passed from Addresses/Add Address page (handles refresh & back nav)
    const navState = (this.router.getCurrentNavigation()?.extras?.state as any) ?? (history.state || {});
    const selectedFromState = navState['selectedAddress'];
    if (selectedFromState) {
      // Wipe any stale persisted contact (e.g., that Route 242 address)
      localStorage.removeItem('checkoutContact');
      this.applyAddress(selectedFromState);
      this.selectedAddressId = selectedFromState.id ?? null;
    }
  }


  // ─────────────── Lifecycle ───────────────
async ngOnInit() {
  this.groupOrders();

  // Load saved addresses
  const currentUser = this.auth.currentUser;
  if (currentUser) {
    const ref = collection(this.firestore, `users/${currentUser.uid}/addresses`);
    collectionData(ref, { idField: 'id' }).subscribe((data: any[]) => {
      this.addresses = data;

      // ✅ Auto-select default only if no address has already been chosen
      const alreadySelected = (history.state && history.state.selectedAddress);
      if (!alreadySelected) {
        const def = data.find(d => d.isDefault);
        if (def && !this.selectedAddressId) {
          this.applyAddress(def);
          this.selectedAddressId = def.id;
        }
      }
    });
  }

  // Optional guard
  const user = this.auth.currentUser;
  if (user) {
    const ref = doc(this.firestore, `users/${user.uid}`);
    const snap = await getDoc(ref);
    const data = snap.data() as any;
    const role = data?.role || 'user';

    if (role === 'user' && !data?.locationSetupDone) {
      await this.presentToast('⚠️ Please set up your delivery location before checkout.');
      this.router.navigateByUrl('/location-setup', { replaceUrl: true });
      return;
    }
  }

  // Restore saved state
  const savedStations = localStorage.getItem('checkoutStations');
  if (savedStations) this.stations = JSON.parse(savedStations);

  const savedContact = localStorage.getItem('checkoutContact');
  if (savedContact) this.contact = JSON.parse(savedContact);

  const savedPayment = localStorage.getItem('checkoutPayment');
  if (savedPayment) this.payment = savedPayment as PaymentMethod;

  // If no known coords yet, try GPS
  if (!this.contact.lat || !this.contact.lng) {
    await this.tryAutoLocate();
  }
}


// Runs whenever the view becomes active (returning from /addresses)
async ionViewWillEnter() {
  const navState = (this.router.getCurrentNavigation()?.extras?.state as any) ?? (history.state || {});
  const selectedFromState = navState['selectedAddress'];

  if (selectedFromState) {
    // Overwrite previous contact so old addresses don't display
    localStorage.removeItem('checkoutContact');

    this.applyAddress(selectedFromState);
    this.selectedAddressId = selectedFromState.id ?? null;

    if (this.contact.lat && this.contact.lng) {
      this.setCustomerMarker([this.contact.lat, this.contact.lng]);
      this.map?.setView([this.contact.lat, this.contact.lng], 16);
      this.updateETA();
    }
  }
}


async ngAfterViewInit(): Promise<void> {
  this.initMap();
  setTimeout(() => this.map?.invalidateSize(), 300);

  // ✅ If an address was explicitly selected, prioritize it
  if (this.selectedAddressId) {
    const selected = this.addresses.find(a => a.id === this.selectedAddressId);
    if (selected?.lat && selected?.lng) {
      this.setCustomerMarker([selected.lat, selected.lng]);
      this.map?.setView([selected.lat, selected.lng], 16);
      this.updateETA();
      return; // 🚨 stop here, no need to override with GPS
    }
  }

await this.tryAutoLocate();

setTimeout(() => {
  if (!this.contact.lat || !this.contact.lng) {
    console.warn('⚠️ Retrying GPS after live reload...');
    this.tryAutoLocate();
  }
}, 4000);

  // ✅ If still no coords, notify user
  if (!this.contact.lat || !this.contact.lng) {
    await this.presentToast('📍 Please pin your delivery location on the map.');
  }
}

  onAddressChange(event: CustomEvent) {
    const selectedId = event.detail?.value as string;
    const selected = this.addresses.find(a => a.id === selectedId);
    if (selected) {
      this.applyAddress(selected);
      this.selectedAddressId = selected.id;
    }
  }

  // ─────────────── Map (Leaflet + OSM) ───────────────
  private initMap() {
    if (this.map) return;

    this.map = L.map('checkout-map').setView([this.mapCenter.lat, this.mapCenter.lng], 15);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
    }).addTo(this.map);

    setTimeout(() => this.map.invalidateSize(), 300);

    if (this.contact.lat && this.contact.lng) {
      this.setCustomerMarker([this.contact.lat, this.contact.lng]);
    }

    this.stations.forEach((s) => {
      if (s.lat && s.lng) {
        const m = L.marker([s.lat, s.lng]).addTo(this.map);
        m.bindPopup(`<b>${s.stationName}</b><br>${s.address}`);
        this.stationMarkers.push(m);
      }
    });

    this.map.on('click', (e: L.LeafletMouseEvent) => {
      this.contact.lat = e.latlng.lat;
      this.contact.lng = e.latlng.lng;
      this.approximateLocation = false;
      this.setCustomerMarker(e.latlng);
      localStorage.setItem('checkoutContact', JSON.stringify(this.contact));
      this.updateETA();
    });

    if (this.contact.lat && this.contact.lng && this.stations.length) {
      this.updateETA();
    }
  }


private setCustomerMarker(latlng: L.LatLngExpression) {
  if (!this.map) return;

  const coords: [number, number] = Array.isArray(latlng)
    ? [latlng[0], latlng[1]]
    : [(latlng as any).lat, (latlng as any).lng];

  // ✅ validate Tuguegarao bounds before saving
  if (!this.isInTuguegarao(coords[0], coords[1])) {
    console.warn(`⚠️ Ignored customer coords outside Tuguegarao: ${coords}`);
    this.presentToast('⚠️ Location must be inside Tuguegarao City.');
    return;
  }

  if (!this.customerMarker) {
    const customerIcon = L.icon({
      iconUrl: 'assets/pins/customer-icon.png',
      iconSize: [36, 36],
      iconAnchor: [18, 36],
      popupAnchor: [0, -36],
    });

    this.customerMarker = L.marker(coords, {
      draggable: true,
      icon: customerIcon,
    }).addTo(this.map);

    this.customerMarker.on('dragend', async (e: any) => {
      const pos = e.target.getLatLng();
      if (!this.isInTuguegarao(pos.lat, pos.lng)) {
        this.presentToast('⚠️ Location must be inside Tuguegarao City.');
        return;
      }
      this.contact.lat = pos.lat;
      this.contact.lng = pos.lng;
      await this.reverseGeocodeAndValidate(pos.lat, pos.lng);
      localStorage.setItem('checkoutContact', JSON.stringify(this.contact));
      this.updateETA();
      setTimeout(() => this.map?.invalidateSize(), 200);
    });

    this.map.setView(coords, 16);
  } else {
    this.customerMarker.setLatLng(coords);
  }

  this.contact.lat = coords[0];
  this.contact.lng = coords[1];
  localStorage.setItem('checkoutContact', JSON.stringify(this.contact));

  this.reverseGeocodeAndValidate(coords[0], coords[1]);
  this.updateETA();
}

// ───────────── Image Fallback Handler ─────────────
onImageError(event: any, type: 'station' | 'product') {
  event.target.src =
    type === 'station'
      ? 'assets/AquaRoute Droplet Logo.png'
      : 'assets/water-placeholder.png';
}

private async tryAutoLocate(): Promise<void> {
  try {
    this.presentToast('📡 Getting precise GPS location...');
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 20000,   // wait up to 20 s for GPS lock
      maximumAge: 0,    // ignore cached results
    });

    const { latitude, longitude, accuracy } = pos.coords;
    console.log('📍 Device GPS fix:', latitude, longitude, '±', accuracy, 'm');

    if (accuracy > 50) {
      this.approximateLocation = true;
      await this.presentToast('⚠️ GPS accuracy is low (>' + Math.round(accuracy) + ' m). Move outdoors and retry.');
    } else {
      this.approximateLocation = false;
    }

    this.contact.lat = latitude;
    this.contact.lng = longitude;

    this.setCustomerMarker([latitude, longitude]);
    await this.reverseGeocodeAndValidate(latitude, longitude);

    localStorage.setItem('checkoutContact', JSON.stringify(this.contact));
    this.updateETA();
    setTimeout(() => this.map?.invalidateSize(), 200);

    await this.presentToast('✅ Location pinned accurately!');
  } catch (err) {
    console.error('❌ GPS locate failed', err);
    await this.presentToast('Failed to get precise location. Please enable GPS or try again.');
  }
}

// async useMyLocation() {
//   await this.tryAutoLocate();
//   if (!this.contact.lat || !this.contact.lng) {
//     await this.presentToast('📍 Unable to detect location. Please enable GPS and retry.');
//   }
// }

  private async reverseGeocodeAndValidate(lat: number, lng: number) {
    try {
      const url =
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`;
      const res: any = await firstValueFrom(this.http.get(url));

      const addressText: string =
        res?.display_name ||
        [res?.address?.road, res?.address?.suburb, res?.address?.city].filter(Boolean).join(', ');

      if (addressText) this.contact.address = addressText;

      const city = res?.address?.city || res?.address?.town || res?.address?.municipality || '';
      const isTuguegarao = (city || '').toLowerCase().includes('tuguegarao');

      if (!isTuguegarao) {
        await this.presentToast('⚠️ We currently deliver only within Tuguegarao City.');
      }
    } catch (e) {
      console.warn('Reverse geocode failed', e);
    }
  }

  // ─────────────── Geocode typed address + draw routes ───────────────
  async geocodeFromAddress() {
    if (!this.contact.address) {
      await this.presentToast('⚠️ Please enter a delivery address.');
      return;
    }

    try {
      const url =
        `https://nominatim.openstreetmap.org/search?format=json` +
        `&q=${encodeURIComponent(this.contact.address)}` +
        `&viewbox=121.693,17.605,121.750,17.660&bounded=1&limit=1&addressdetails=1`;

      const results: any = await firstValueFrom(this.http.get(url));

      if (results && results.length > 0) {
        const { lat, lon, display_name, address } = results[0];
        const city = address?.city || address?.town || address?.municipality || '';
        const isTuguegarao = (city || '').toLowerCase().includes('tuguegarao');
        if (!isTuguegarao) {
          await this.presentToast('⚠️ We currently deliver only within Tuguegarao City.');
          return;
        }

        this.contact.lat = parseFloat(lat);
        this.contact.lng = parseFloat(lon);
        this.approximateLocation = false;
        this.contact.address = display_name || this.contact.address;

        this.setCustomerMarker([this.contact.lat, this.contact.lng]);
        localStorage.setItem('checkoutContact', JSON.stringify(this.contact));

        this.routeLines.forEach(line => this.map.removeLayer(line));
        this.routeLines = [];

        for (const station of this.stations) {
          if (!station.lat || !station.lng) continue;

          const osrmUrl =
            `https://router.project-osrm.org/route/v1/driving/` +
            `${station.lng},${station.lat};${this.contact.lng},${this.contact.lat}` +
            `?overview=full&geometries=geojson`;

          this.http.get<any>(osrmUrl).subscribe({
            next: (res) => {
              const route = res?.routes?.[0];
              if (route) {
                const distanceKm = (route.distance / 1000).toFixed(2);
                const durationMin = Math.round(route.duration / 60);

                (station as any).eta = {
                  distance: `${distanceKm} km`,
                  duration: `${durationMin} min`,
                };

                const newLine = L.polyline(
                  route.geometry.coordinates.map((c: any) => [c[1], c[0]]),
                  { color: 'blue', weight: 4 }
                ).addTo(this.map);

                this.routeLines.push(newLine);
                this.map.fitBounds(newLine.getBounds(), { padding: [20, 20] });
                setTimeout(() => this.map?.invalidateSize(), 100);
              }
            },
            error: () => this.presentToast(`⚠️ Route failed for ${station.stationName}`),
          });
        }

        await this.presentToast(`📍 Found: ${display_name}. Routes updated.`);
      } else {
        await this.presentToast('⚠️ No results found in Tuguegarao. Try a more detailed address.');
      }
    } catch (err) {
      console.error(err);
      await this.presentToast('❌ Failed to fetch location. Please try again.');
    }
  }

async onSelectAddress() {
  if (!this.addresses || this.addresses.length === 0) {
    const alert = await this.alertCtrl.create({
      header: 'No Address Found',
      message: 'You don’t have any saved address. Do you want to add one now?',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Add Address',
          handler: () => {
            this.router.navigate(['/add-address']);
          },
        },
      ],
    });
    await alert.present();
  } else {
    // ✅ Navigate to addresses page and pass a marker we are expecting an address
    this.router.navigate(['/addresses'], {
      state: { fromCheckout: true }
    });
  }
}



  
  // ─────────────── ETA (OSRM) ───────────────
  private updateETA() {
    if (!this.contact.lat || !this.contact.lng || this.stations.length === 0) return;

    this.routeLines.forEach(line => this.map.removeLayer(line));
    this.routeLines = [];

    for (const station of this.stations) {
      if (!station.lat || !station.lng) continue;

      const url =
        `https://router.project-osrm.org/route/v1/driving/` +
        `${station.lng},${station.lat};${this.contact.lng},${this.contact.lat}` +
        `?overview=full&geometries=geojson`;

      this.http.get<any>(url).subscribe({
        next: (res) => {
          const route = res?.routes?.[0];
          if (route) {
            const distanceKm = (route.distance / 1000).toFixed(2);
            const durationMin = Math.round(route.duration / 60);

            (station as any).eta = {
              distance: `${distanceKm} km`,
              duration: `${durationMin} min`,
            };

            const newLine = L.polyline(
              route.geometry.coordinates.map((c: any) => [c[1], c[0]]),
              { color: 'blue', weight: 4 }
            ).addTo(this.map);

            this.routeLines.push(newLine);
            if (this.routeLines.length === 1) {
              this.map.fitBounds(newLine.getBounds(), { padding: [20, 20] });
            }
          }
        },
        error: () => this.presentToast(`⚠️ Route failed for ${station.stationName}`),
      });
    }
  }

// ─────────────── Group Orders ───────────────
private groupOrders() {
  let cart = this.cartService.getCheckoutItems();
  if (!cart || cart.length === 0) cart = this.cartService.getCart();

  const grouped: { [stationId: string]: StationGroup } = {};

  cart.forEach((item: CartItem) => {
    if (!grouped[item.stationId]) {
      grouped[item.stationId] = {
        id: item.stationId,
        stationName: item.stationName || 'Unknown Station',
        address: 'Loading...',
        items: [],
        containerSwap: false,
        deliveryFee: 0,
        isOpen: true,
        operatingHours: '—',
      };

      // ✅ Firestore real-time station info
      this.stationService.getStationById(item.stationId).subscribe((station: any) => {
        if (!station) return;

        // ✅ Type-safe bracket access (fix TS4111)
        const openTime = station['openingTime'] || station['open'] || '—';
        const closeTime = station['closingTime'] || station['close'] || '—';

        grouped[item.stationId].address = station['address'] || 'No address available';
        grouped[item.stationId].operatingHours = `${openTime} - ${closeTime}`;
        grouped[item.stationId].isOpen = this.checkIfStationOpen(openTime, closeTime);

        grouped[item.stationId].gcashName = station['gcashName'] || '';
        grouped[item.stationId].gcashNumber = this.displayCheckoutPhone(station['gcashNumber'] || '');

        // ✅ Coordinates fallback
        if (typeof station['lat'] === 'number' && typeof station['lng'] === 'number') {
          grouped[item.stationId].lat = station['lat'];
          grouped[item.stationId].lng = station['lng'];
        } else {
          grouped[item.stationId].lat = 17.6131;
          grouped[item.stationId].lng = 121.7270;
        }

        // ✅ Save updated stations locally
        this.stations = Object.values(grouped);
        localStorage.setItem('checkoutStations', JSON.stringify(this.stations));
      });
    }

    // ✅ Ensure waterType is loaded and cached
    if (!item.waterType && item.productId && item.stationId) {
      this.stationService
        .getProductById(item.stationId, item.productId)
        .subscribe((product: any) => {
          const firestoreWaterType = product?.['waterType'] || product?.['type'] || '—';
          item.waterType = firestoreWaterType;

          // Cache in localStorage for offline persistence
          const cached = JSON.parse(localStorage.getItem('cartItems') || '[]');
          const idx = cached.findIndex((c: any) => c.lineId === item.lineId);
          if (idx !== -1) {
            cached[idx].waterType = firestoreWaterType;
            localStorage.setItem('cartItems', JSON.stringify(cached));
          }

          this.refreshStations(grouped);
        });
    }

    grouped[item.stationId].items.push(item);
  });

  this.stations = Object.values(grouped);
  localStorage.setItem('checkoutStations', JSON.stringify(this.stations));
}

// ──────────────────────────────────────────────
// Helper to refresh stations UI
// ──────────────────────────────────────────────
private refreshStations(grouped: { [id: string]: StationGroup }) {
  this.stations = Object.values(grouped);
  localStorage.setItem('checkoutStations', JSON.stringify(this.stations));
}

// ──────────────────────────────────────────────
// Check if station open (based on time range)
// ──────────────────────────────────────────────
private checkIfStationOpen(openingTime?: string, closingTime?: string): boolean {
  if (!openingTime || !closingTime) return true;

  const now = new Date();
  const [openH, openM, openMeridian] = this.parseTime(openingTime);
  const [closeH, closeM, closeMeridian] = this.parseTime(closingTime);

  const open24 = this.to24Hour(openH, openM, openMeridian);
  const close24 = this.to24Hour(closeH, closeM, closeMeridian);
  const current = now.getHours() * 60 + now.getMinutes();

  return current >= open24 && current <= close24;
}

// Parse 12-hour format like "08:00 AM"
private parseTime(timeStr: string): [number, number, string] {
  const match = timeStr.match(/(\d{1,2}):(\d{2})\s?(AM|PM)/i);
  if (!match) return [0, 0, 'AM'];
  return [parseInt(match[1], 10), parseInt(match[2], 10), match[3].toUpperCase()];
}

// Convert to total minutes (24-hour)
private to24Hour(hour: number, minute: number, meridian: string): number {
  if (meridian === 'PM' && hour !== 12) hour += 12;
  if (meridian === 'AM' && hour === 12) hour = 0;
  return hour * 60 + minute;
}


  // ─────────────── Delivery Fee + Totals ───────────────
  private getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) *
        Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * (2 * Math.atan2(Math.sqrt(1 - a), Math.sqrt(a)));
  }

calculateDeliveryFee(station: StationGroup): number {
  const mode = (station.items?.[0]?.mode || station.mode || 'delivery')
    .toString()
    .trim()
    .toLowerCase();

  // ✅ Pickup = no delivery fee
  if (mode === 'pickup') return 0;

  const totalContainers = (station.items || []).reduce(
    (sum, item) => sum + Number(item.quantity || 0),
    0
  );

  const schedule = (station.items?.[0]?.scheduledAt || '')
    .toString()
    .trim()
    .toUpperCase();

  // ✅ Base per-gallon fee
  const feePerGallon = schedule === 'ASAP' ? 10 : 5;
  const baseFee = totalContainers * feePerGallon;

  // ✅ If coordinates are missing, still charge only the base fee
  if (
    this.contact.lat == null || this.contact.lng == null ||
    station.lat == null || station.lng == null
  ) {
    return baseFee;
  }

  const distance = this.getDistanceKm(
    station.lat,
    station.lng,
    this.contact.lat,
    this.contact.lng
  );

  // ✅ Safety guard: if distance is invalid or absurd, ignore surcharge
  if (!isFinite(distance) || distance < 0 || distance > 30) {
    console.warn('⚠️ Invalid checkout distance detected. Using base fee only.', {
      stationName: station.stationName,
      stationLat: station.lat,
      stationLng: station.lng,
      customerLat: this.contact.lat,
      customerLng: this.contact.lng,
      distance,
    });
    return baseFee;
  }

  // ✅ Additional fee only if order distance exceeds 2 km
  if (distance > 2) {
    const extraKm = distance - 2;
    const extraFee = Math.ceil(extraKm) * 5;
    return baseFee + extraFee;
  }

  return baseFee;
}

getStationFeeRate(station: StationGroup): number {
  const mode = (station.items?.[0]?.mode || station.mode || 'delivery')
    .toString()
    .trim()
    .toLowerCase();

  if (mode === 'pickup') return 0;

  const schedule = (station.items?.[0]?.scheduledAt || '')
    .toString()
    .trim()
    .toUpperCase();

  return schedule === 'ASAP' ? 10 : 5;
}

getStationTotalGallons(station: StationGroup): number {
  return (station.items || []).reduce((sum, item) => {
    return sum + Number(item.quantity || 0);
  }, 0);
}

  getStationSubtotal(group: StationGroup): number {
    return (group.items || []).reduce(
      (sum, item) =>
        sum + (item.unitPriceComputed ?? item.basePrice ?? item.price ?? 0) * (item.quantity || 1),
      0
    );
  }

  getGrandSubtotal(): number {
    return this.stations.reduce((sum, s) => sum + this.getStationSubtotal(s), 0);
  }

  getGrandDeliveryFee(): number {
    return this.stations.reduce((sum, s) => sum + this.calculateDeliveryFee(s), 0);
  }

getGrandTotal(): number {
  const subtotal = this.getGrandSubtotal();
  // ✅ Only add delivery fees for delivery-mode stations
  const deliveryFee = this.stations.reduce((sum, s) => {
    const mode = (s.mode || (s.items?.[0]?.mode ?? 'delivery')).toLowerCase();
    return sum + (mode === 'pickup' ? 0 : this.calculateDeliveryFee(s));
  }, 0);
  return subtotal + deliveryFee;
}

  // ─────────────── Check if any station is closed ───────────────
isAnyStationClosed(): boolean {
  return Array.isArray(this.stations) && this.stations.some(s => s && s.isOpen === false);
}


  // ─────────────── State Saving ───────────────
  changePayment(method: PaymentMethod) {
    this.payment = method;
    localStorage.setItem('checkoutPayment', this.payment);
  }

  onContactChange() {
    localStorage.setItem('checkoutContact', JSON.stringify(this.contact));
  }

onStationOptionChange() {
  localStorage.setItem('checkoutStations', JSON.stringify(this.stations));

  this.stations = [...this.stations];
}

onProofSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (!file) return;

  if (!file.type.startsWith('image/')) {
    this.presentToast('Please upload an image file only.');
    return;
  }

  this.proofFile = file;
  this.proofPreviewUrl = URL.createObjectURL(file);
}

private async uploadProofToCloudinary(): Promise<string> {
  if (!this.proofFile) {
    throw new Error('No proof file selected.');
  }

  this.isUploadingProof = true;

  try {
    const formData = new FormData();
    formData.append('file', this.proofFile);
    formData.append('upload_preset', this.cloudinaryUploadPreset);
    formData.append('folder', 'aquaroute/payment-proofs');

    const uploadUrl = `https://api.cloudinary.com/v1_1/${this.cloudinaryCloudName}/image/upload`;

    const response: any = await firstValueFrom(
      this.http.post(uploadUrl, formData)
    );

    if (!response?.secure_url) {
      throw new Error('Cloudinary upload failed: no secure URL returned.');
    }

    return response.secure_url;
  } finally {
    this.isUploadingProof = false;
  }
}


  // ─────────────── Station Open Validation ───────────────
private async validateStationsOpen(): Promise<boolean> {
  try {
    for (const s of this.stations) {
      const ref = doc(this.firestore, `stations/${s.id}`);
      const snap = await getDoc(ref);
      const data = snap.data() as any;
      if (!data?.isOpen) {
        await this.presentToast(`🚫 ${data?.stationName || 'Station'} is currently closed.`);
        return false;
      }
    }
    return true;
  } catch (err) {
    console.error('❌ Failed to validate station open status:', err);
    await this.presentToast('⚠️ Could not verify station status. Try again later.');
    return false;
  }
}


// ─────────────── Place Order ───────────────
async placeOrder(form: NgForm) {
  // ✅ 1. Basic form validation
  if (form.invalid) {
    await this.presentToast('Please complete delivery details.');
    return;
  }

let uploadedProofUrl = '';

if (this.payment === 'GCASH') {
  const gcashStation = this.stations[0];

  if (!gcashStation?.gcashNumber || !gcashStation?.gcashName) {
    await this.presentToast('GCash details are not available for this station yet.');
    return;
  }

  if (!this.gcashReferenceNumber.trim()) {
    await this.presentToast('Please enter your GCash reference number.');
    return;
  }

  if (!this.proofFile) {
    await this.presentToast('Please upload your proof of payment.');
    return;
  }

  try {
    await this.presentToast('Uploading proof of payment...');
    uploadedProofUrl = await this.uploadProofToCloudinary();
  } catch (error) {
    console.error('❌ Cloudinary upload failed:', error);
    await this.presentToast('Failed to upload proof of payment. Please try again.');
    return;
  }
}

  // ✅ 2. Flatten all cart items
const allItems = this.stations.reduce(
  (acc: CartItem[], s: StationGroup) =>
    acc.concat(
      (s.items || []).map((item) => ({
        ...item,
        deliveryPriority: item.scheduledAt === 'ASAP' ? 'asap' : 'scheduled',
      }))
    ),
  []
);
  if (allItems.length === 0) {
    await this.presentToast('Your cart is empty.');
    return;
  }

  // ✅ 3. Delivery vs Pickup validation
  const hasDelivery = allItems.some(i => i.mode === 'delivery');

  if (hasDelivery) {
    if (!this.contact.address || !this.contact.address.toLowerCase().includes('tuguegarao')) {
      await this.presentToast('⚠️ Delivery orders must have a valid Tuguegarao City address.');
      return;
    }
    if (!this.contact.lat || !this.contact.lng) {
      await this.presentToast('📍 Please pin your delivery location on the map.');
      return;
    }
  }

  // ✅ 4. Ensure station coordinates are valid
  const ok = await this.ensureStationCoords();
  if (!ok) {
    await this.presentToast('A station is missing location info. Please try again.');
    return;
  }

  // ✅ 5. Save contact for reuse
  localStorage.setItem('checkoutContact', JSON.stringify(this.contact));

  try {
    const user = this.auth.currentUser;
    if (!user) {
      await this.presentToast('You must be logged in to place an order.');
      return;
    }

    const userOrdersRef = collection(this.firestore, `users/${user.uid}/orders`);
    const newUserOrderRef = doc(userOrdersRef);
    const globalOrdersRef = collection(this.firestore, 'orders');
    const newGlobalOrderRef = doc(globalOrdersRef, newUserOrderRef.id);

// ✅ 6. Build station payloads (auto-₱0 for Pickup)
const stationsPayload = this.stations.map((s) => {
  const mode = (s.items?.[0]?.mode || s.mode || 'delivery').toLowerCase();
  const fee = mode === 'pickup' ? 0 : this.calculateDeliveryFee(s);

  let safeStationLatLng: { lat: number; lng: number } | undefined;
  if (s.lat != null && s.lng != null) {
    if (s.lat >= 17.58 && s.lat <= 17.68 && s.lng >= 121.69 && s.lng <= 121.75) {
      safeStationLatLng = { lat: s.lat, lng: s.lng };
    }
  }

  return {
    stationId: s.id,
    stationName: s.stationName,
    stationAddress: s.address,
    stationLatLng: safeStationLatLng,
    containerSwap: s.containerSwap || false,
    deliveryFee: fee,
    subtotal: this.getStationSubtotal(s),
    total: mode === 'pickup' ? this.getStationSubtotal(s) : this.getStationSubtotal(s) + fee,
    mode,
  };
});


    // ✅ 7. Assemble order object
    const order: Order & any = {
      id: newUserOrderRef.id,
      userId: user.uid,
      stations: stationsPayload,
      items: allItems,
charges: (() => {
  const subtotal = this.getGrandSubtotal();

  // ✅ Sum only delivery-mode fees; pickup = ₱0
  const deliveryFee = stationsPayload.reduce((sum, st) => {
    const isPickup = (st.mode || '').toLowerCase() === 'pickup';
    return sum + (isPickup ? 0 : (st.deliveryFee ?? 0));
  }, 0);

  // ✅ Total should never exceed subtotal if all pickups
  const total = subtotal + deliveryFee;

  return { subtotal, deliveryFee, total, currency: 'PHP' };
})(),
      delivery: {
        fullName: this.contact.fullName,
        address: this.contact.address,
        phone: this.contact.phone || '',
        notes: this.contact.notes || '',
        ...(this.contact.lat != null &&
        this.contact.lng != null &&
        this.isInTuguegarao(this.contact.lat, this.contact.lng)
          ? {
              latLng: {
                lat: parseFloat(this.contact.lat.toFixed(6)),
                lng: parseFloat(this.contact.lng.toFixed(6)),
              },
              needsPin: false,
            }
          : { needsPin: true }),
      },
      payment: {
        method: this.payment,
        status: this.payment === 'COD' ? 'Pending' : 'Pending Verification',
        referenceNumber: this.payment === 'GCASH' ? this.gcashReferenceNumber.trim() : '',
        proofUrl: this.payment === 'GCASH' ? uploadedProofUrl : '',
        verifiedAt: null,
        verifiedBy: '',
      },
      status: 'Pending',
      statusHistory: [
        {
          status: 'Pending',
          changedAt: Date.now(),
          by: this.contact.fullName || user.displayName || 'Customer',
        },
      ],
      createdAt: serverTimestamp(),
      lastUpdatedAt: serverTimestamp(),
      ...(this.approximateLocation ? { approximateLocation: true } : {}),
    };

    // ✅ 8. Sanitize before save
    Object.keys(order).forEach((key) => {
      if (order[key] === undefined) delete order[key];
    });
    if (order.delivery) {
      Object.keys(order.delivery).forEach((key) => {
        if (order.delivery[key] === undefined) delete order.delivery[key];
      });
    }
    if (order.payment) {
      Object.keys(order.payment).forEach((key) => {
        if (order.payment[key] === undefined) delete order.payment[key];
      });
    }
    if (order.charges) {
      Object.keys(order.charges).forEach((key) => {
        if (order.charges[key] === undefined) delete order.charges[key];
      });
    }

    // ✅ 9. Save to Firestore
    await setDoc(newUserOrderRef, order);
    await setDoc(newGlobalOrderRef, order);

// ✅ 10. Mirror to station collections + manager notifications
for (const st of stationsPayload) {
  const sid = st.stationId;
  if (!sid) continue;

  try {
    // Fetch full station document to extract ownerId (manager)
    const stationRef = doc(this.firestore, `stations/${sid}`);
    const stationSnap = await getDoc(stationRef);
    const stationData = stationSnap.exists() ? (stationSnap.data() as any) : null;

    const managerId = stationData?.ownerId || null;

    // 🔹 Save order under station orders
    const stationOrderRef = doc(this.firestore, `stations/${sid}/orders/${order.id}`);
    await setDoc(
      stationOrderRef,
      {
        ...order,
        stationId: sid,
        stationName: st.stationName,
        deliveryFee: st.deliveryFee,
        subtotal: st.subtotal,
        total: st.total,
        managerId: managerId ?? null, // ✅ keep manager link
      },
      { merge: true }
    );

    // 🔔 Notify manager in Firestore if managerId exists
    if (managerId) {
      await this.notifications.addManagerNotification(managerId, {
        type: 'new_order',
        message: `🆕 New order received for ${st.stationName}`,
        relatedId: order.id,
        read: false,
        createdAt: serverTimestamp(), // ✅ fix for Firestore schema
      });
    }

    // 🔔 Fallback for push notifications
    await this.notifications.sendPush({
      title: '📦 New Order Received',
      body: `Order #${order.id} placed by ${this.contact.fullName || 'a customer'}`,
      topic: `manager_${sid}`,
      orderId: order.id,
      stationId: sid,
    });
  } catch (err) {
    console.error(`❌ Failed to mirror order ${order.id} to station ${sid}`, err);
  }
}

    // ✅ 11. Final push to each station topic
    for (const st of stationsPayload) {
      try {
        await this.notifications.sendPush({
          title: '📦 New Order',
          body: `Order #${order.id} for ${st.stationName}`,
          topic: `station_${st.stationId}`,
          orderId: order.id,
          stationId: st.stationId,
        });
      } catch (e) {
        console.warn('Push send failed for station', st.stationId, e);
      }
    }

    // ✅ 12. Cleanup + Redirect
    await this.cartService.clearCart();
    localStorage.removeItem('checkoutStations');
    localStorage.removeItem('checkoutContact');
    localStorage.removeItem('checkoutPayment');

    this.proofFile = null;
    this.proofPreviewUrl = '';
    this.gcashReferenceNumber = '';

    await this.presentToast('✅ Order placed successfully!');
    this.router.navigate(['/order-success'], {
      replaceUrl: true,
      queryParams: { id: newUserOrderRef.id },
    });
  } catch (err) {
    console.error('❌ Order save failed:', err);
    await this.presentToast('Failed to place order. Please try again.');

    if (this.contact.lat && this.contact.lng) {
      this.setCustomerMarker([this.contact.lat, this.contact.lng]);
    }
  }
}


  // ─────────────── Helpers ───────────────
  private async ensureStationCoords(): Promise<boolean> {
    try {
      const loaders: Promise<void>[] = [];
      for (const s of this.stations) {
        if (s.lat == null || s.lng == null) {
          loaders.push(
            firstValueFrom(this.stationService.getStationById(s.id)).then((st) => {
              s.address = st?.address || s.address;
              if (typeof (st as any)?.lat === 'number') s.lat = (st as any).lat;
              if (typeof (st as any)?.lng === 'number') s.lng = (st as any).lng;
            })
          );
        }
      }
      if (loaders.length) {
        await Promise.all(loaders);
        localStorage.setItem('checkoutStations', JSON.stringify(this.stations));
      }
      return this.stations.every((s) => s.lat != null && s.lng != null);
    } catch {
      return false;
    }
  }

    private displayCheckoutPhone(value: string): string {
    if (!value) return '';

    let cleaned = value.replace(/\D/g, '');

    if (cleaned.startsWith('63')) {
      cleaned = '0' + cleaned.slice(2);
    }

    if (!cleaned.startsWith('0') && cleaned.length === 10 && cleaned.startsWith('9')) {
      cleaned = '0' + cleaned;
    }

    return cleaned.slice(0, 11);
  }

  private async presentToast(message: string) {
    const t = await this.toastCtrl.create({
      message,
      duration: 2000,
      position: 'top',
    });
    await t.present();
  }

 // Apply a chosen saved address into checkout contact
async applyAddress(addr: any) {
  if (!addr) return;

    const phone =
    addr.phone ??
    addr.phoneNumber ??
    addr.contactNumber ??
    addr.mobile ??
    addr.mobileNumber ??
    addr.tel ??
    '';

  // Overwrite old contact fully
  this.contact = {
    fullName: addr.fullName || '',
    address: `${addr.street}, ${addr.barangay}, Tuguegarao City`,
    notes: addr.notes || '',
    phone: addr.phone || '',
    isDefault: addr.isDefault || false,
    lat: addr.lat ? parseFloat(addr.lat) : undefined,
    lng: addr.lng ? parseFloat(addr.lng) : undefined,
  };

  if (this.contact.lat && this.contact.lng) {
    // ✅ Use coordinates
    this.setCustomerMarker([this.contact.lat, this.contact.lng]);
    this.updateETA();
    this.map?.setView([this.contact.lat, this.contact.lng], 16);
    setTimeout(() => this.map?.invalidateSize(), 200);
  } else {
    // ❌ No coords → geocode
    try {
const url =
  `https://nominatim.openstreetmap.org/search?format=json&limit=1&` +
  `viewbox=121.693,17.605,121.750,17.660&bounded=1&` +
  `q=${encodeURIComponent(this.contact.address)}`;
      const results: any = await firstValueFrom(this.http.get(url));

      if (results?.length > 0) {
        const { lat, lon } = results[0];
        this.contact.lat = parseFloat(lat);
        this.contact.lng = parseFloat(lon);

        this.setCustomerMarker([this.contact.lat, this.contact.lng]);
        this.updateETA();
        this.map?.setView([this.contact.lat, this.contact.lng], 16);
        setTimeout(() => this.map?.invalidateSize(), 200);
      } else {
        await this.presentToast('⚠️ Unable to locate this address on the map.');
      }
    } catch (err) {
      console.error('Geocode failed:', err);
      await this.presentToast('❌ Failed to fetch location for this address.');
    }
  }

  // ✅ Persist selected contact
  localStorage.setItem('checkoutContact', JSON.stringify(this.contact));
  this.selectedAddressId = addr.id || null;

  // ✅ Show toast feedback
  await this.presentToast(`📍 Using selected address: ${this.contact.address}`);
}

  // Navigate to My Addresses page
goToAddresses() {
  this.router.navigate(['/addresses']);
}

}
