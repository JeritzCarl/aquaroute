import { Component, OnInit, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { IonicModule, ToastController } from '@ionic/angular';
import { Router } from '@angular/router';
import { AlertController } from '@ionic/angular';

// Services
import { CartService, CartItem } from '../services/cart.service';
import { StationService } from '../services/station.service';
import { NotificationService } from '../services/notification.service';

// Firebase
import { Firestore, collection, doc, setDoc, serverTimestamp, getDoc, collectionData } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';

// HTTP
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

// Models
import { Station } from '../models/station.model';
import { Order } from '../models/order.model';

// Leaflet
import * as L from 'leaflet';

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
  lat?: number;
  lng?: number;
  containerSwap?: boolean;
  pickupLater?: boolean;
  deliveryFee?: number;
  eta?: { distance: string; duration: string };
};

@Component({
  selector: 'app-checkout',
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, HttpClientModule],
  templateUrl: './checkout.page.html',
  styleUrls: ['./checkout.page.scss'],
})
export class CheckoutPage implements OnInit, AfterViewInit {
  stations: StationGroup[] = [];
  addresses: any[] = [];
  selectedAddressId: string | null = null;
  contact: UserContact = { fullName: '', address: '', notes: '', lat: undefined, lng: undefined };
  payment: PaymentMethod = 'COD';

  // Default map center (Tuguegarao)
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

  // ✅ Otherwise try GPS
  await this.tryAutoLocate();

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
      iconUrl: 'assets/pin-customer.png',
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



  private async tryAutoLocate(): Promise<void> {
    if (!('geolocation' in navigator)) return;
    await new Promise<void>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          this.contact.lat = pos.coords.latitude;
          this.contact.lng = pos.coords.longitude;
          this.approximateLocation = false;

          this.setCustomerMarker([this.contact.lat, this.contact.lng]);
          await this.reverseGeocodeAndValidate(this.contact.lat, this.contact.lng);
          localStorage.setItem('checkoutContact', JSON.stringify(this.contact));
          this.updateETA();
          resolve();
          setTimeout(() => this.map?.invalidateSize(), 200);
        },
        () => resolve(),
        { enableHighAccuracy: true, timeout: 8000 }
      );
    });
  }

  async useMyLocation() {
    await this.tryAutoLocate();
    if (!this.contact.lat || !this.contact.lng) {
      await this.presentToast('Turn on Location Services and try again.');
    }
  }

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
        pickupLater: false,
        deliveryFee: 0,
      };

      // ✅ Fetch latest station info from Firestore
      this.stationService.getStationById(item.stationId).subscribe((station) => {
        grouped[item.stationId].address = station?.address || 'No address available';

// ✅ Validate station coords, fallback to centroid of deliveryArea if available
      if (typeof (station as any)?.lat === 'number' && typeof (station as any)?.lng === 'number') {
        grouped[item.stationId].lat = (station as any).lat;
        grouped[item.stationId].lng = (station as any).lng;
      } else if (Array.isArray((station as any)?.deliveryArea) && (station as any).deliveryArea.length) {
        const pts = (station as any).deliveryArea;
        const c = pts.reduce((a: any, p: any) => ({ lat: a.lat + p.lat, lng: a.lng + p.lng }),
          { lat: 0, lng: 0 });
        grouped[item.stationId].lat = c.lat / pts.length;
        grouped[item.stationId].lng = c.lng / pts.length;
        console.warn(`⚠️ Station ${item.stationName} missing direct coords, using deliveryArea centroid`);
      } else {
        grouped[item.stationId].lat = 17.6131;
        grouped[item.stationId].lng = 121.7270;
        console.warn(`⚠️ Station ${item.stationName} missing coords, forced Tuguegarao center fallback`);
      } 

        localStorage.setItem('checkoutStations', JSON.stringify(Object.values(grouped)));
      });
    }
    grouped[item.stationId].items.push(item);
  });

  this.stations = Object.values(grouped);
  localStorage.setItem('checkoutStations', JSON.stringify(this.stations));
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

  private calculateDeliveryFee(station: StationGroup): number {
    const totalContainers = (station.items || []).reduce((sum, item) => sum + (item.quantity || 1), 0);
    if (
      this.contact.lat == null || this.contact.lng == null ||
      station.lat == null || station.lng == null
    ) {
      return 0;
    }
    const distance = this.getDistanceKm(station.lat, station.lng, this.contact.lat, this.contact.lng);
    return distance <= 2 ? 0 : totalContainers * 5;
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
    return this.getGrandSubtotal() + this.getGrandDeliveryFee();
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
  }


 // ─────────────── Place Order ───────────────
async placeOrder(form: NgForm) {
  if (form.invalid) {
    await this.presentToast('Please complete delivery details.');
    return;
  }

  if (!this.contact.lat || !this.contact.lng) {
    await this.presentToast('📍 Please pin your delivery location on the map or use "Find via address".');
    return;
  }

  if (!this.contact.address || !this.contact.address.toLowerCase().includes('tuguegarao')) {
    await this.presentToast('⚠️ We currently deliver only within Tuguegarao City.');
    return;
  }

  const ok = await this.ensureStationCoords();
  if (!ok) {
    await this.presentToast('A station is missing location info. Please try again.');
    return;
  }

  localStorage.setItem('checkoutContact', JSON.stringify(this.contact));

  const allItems = this.stations.reduce(
    (acc: CartItem[], s: StationGroup) => acc.concat(s.items || []),
    []
  );
  if (allItems.length === 0) {
    await this.presentToast('Your cart is empty.');
    return;
  }

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

    const stationsPayload = this.stations.map((s) => {
      const fee = this.calculateDeliveryFee(s);

      // Validate station coords are within Tuguegarao
      let safeStationLatLng: { lat: number; lng: number } | undefined = undefined;
      if (s.lat != null && s.lng != null) {
        if (s.lat >= 17.58 && s.lat <= 17.68 && s.lng >= 121.69 && s.lng <= 121.75) {
          safeStationLatLng = { lat: s.lat, lng: s.lng };
        } else {
          console.warn(`⚠️ Station ${s.stationName} has coords outside Tuguegarao (${s.lat},${s.lng}), ignoring`);
        }
      }

      return {
        stationId: s.id,
        stationName: s.stationName,
        stationAddress: s.address,
        stationLatLng: safeStationLatLng,
        containerSwap: s.containerSwap,
        pickupLater: s.pickupLater,
        deliveryFee: fee,
        subtotal: this.getStationSubtotal(s),
        total: this.getStationSubtotal(s) + fee,
      };
    });

    const order: Order & any = {
      id: newUserOrderRef.id,
      userId: user.uid,
      stations: stationsPayload,
      items: allItems,
      charges: {
        subtotal: this.getGrandSubtotal(),
        deliveryFee: stationsPayload.reduce((sum, st) => sum + (st.deliveryFee ?? 0), 0),
        total: stationsPayload.reduce((sum, st) => sum + (st.total ?? 0), 0),
        currency: 'PHP',
      },
delivery: {
  fullName: this.contact.fullName,
  address: this.contact.address,
  notes: this.contact.notes || '',
  ...(this.contact.lat != null && this.contact.lng != null && this.isInTuguegarao(this.contact.lat, this.contact.lng)
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
        status: this.payment === 'COD' ? 'Pending' : 'Awaiting Proof',
      },
      status: 'Pending',
      statusHistory: [
        {
          status: 'Pending',
          changedAt: Date.now(), // client timestamp
          by: this.contact.fullName || user.displayName || 'Customer',
        },
      ],
      createdAt: serverTimestamp(),
      lastUpdatedAt: serverTimestamp(),
      ...(this.approximateLocation ? { approximateLocation: true } : {}),
    };

    await setDoc(newUserOrderRef, order);
    await setDoc(newGlobalOrderRef, order);

for (const st of stationsPayload) {
  const sid = st.stationId;
  if (!sid) {
    console.warn(`⚠️ Skipping station mirror: stationId missing for`, st);
    continue;
  }

  console.log(`📡 Mirroring order ${order.id} → station ${sid}`);

  try {
    const stationOrderRef = doc(this.firestore, `stations/${sid}/orders/${order.id}`);
    await setDoc(stationOrderRef, {
      ...order,
      stationId: sid,
      stationName: st.stationName,
      deliveryFee: st.deliveryFee,
      subtotal: st.subtotal,
      total: st.total,
    }, { merge: true });

    console.log(`✅ Order ${order.id} successfully mirrored to station ${sid}`);

    // 🔔 Push notify manager
    try {
      await this.notifications.sendPush({
        title: '📦 New Order Received',
        body: `Order #${order.id} placed by ${this.contact.fullName || 'a customer'}`,
        topic: `manager_${sid}`,
        orderId: order.id,
        stationId: sid,
      });
      console.log(`📨 Push sent to manager_${sid}`);
    } catch (err) {
      console.error(`⚠️ Failed to send push to manager_${sid}`, err);
    }

  } catch (err) {
    console.error(`❌ Failed to mirror order ${order.id} to station ${sid}`, err);
  }
}

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

    await this.cartService.clearCart();
    localStorage.removeItem('checkoutStations');
    localStorage.removeItem('checkoutContact');
    localStorage.removeItem('checkoutPayment');

    await this.presentToast('✅ Order placed successfully!');
    this.router.navigate(['/order-success'], {
      replaceUrl: true,
      queryParams: { id: newUserOrderRef.id },
    });
  } catch (err) {
    console.error('❌ Order save failed:', err);
    await this.presentToast('Failed to place order. Please try again.');

    // 🛠 Auto-fix fallback: reset invalid coords if save fails
    if (this.contact.lat && this.contact.lng) {
      this.setCustomerMarker([this.contact.lat, this.contact.lng]); // ✅ wrapped as array
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
