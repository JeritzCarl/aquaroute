import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, AlertController } from '@ionic/angular';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { Firestore, doc, setDoc, getDoc, collection, getDocs } from '@angular/fire/firestore';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-add-address',
  templateUrl: './add-address.page.html',
  styleUrls: ['./add-address.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule, FormsModule, HttpClientModule],
})
export class AddAddressPage {
id: string | null = null;
fullName = '';
barangay = '';
street = '';
phone = '';
isDefault = false;
editing = false;
lat: number | null = null;
lng: number | null = null;
fromCheckout = false; // ✅ new flag to track source


  // ✅ Complete Barangay list of Tuguegarao City (verified & alphabetically sorted)
  barangays: string[] = [
    'Annafunan East', 'Annafunan West', 'Atulayan Norte', 'Atulayan Sur',
    'Bagay', 'Balzain East', 'Balzain West', 'Buntun', 'Caggay', 'Capatan',
    'Carig Norte', 'Carig Sur', 'Caritan Centro', 'Caritan Norte', 'Caritan Sur',
    'Cataggaman Nuevo', 'Cataggaman Pardo', 'Cataggaman Viejo',
    'Centro 1', 'Centro 2', 'Centro 3', 'Centro 4', 'Centro 5', 'Centro 6',
    'Centro 7', 'Centro 8', 'Centro 9', 'Centro 10', 'Centro 11', 'Centro 12',
    'Dadda', 'Gosi Norte', 'Gosi Sur', 'Larion Alto', 'Larion Bajo',
    'Leonarda', 'Libag Norte', 'Libag Sur', 'Linao East', 'Linao Norte', 'Linao West',
    'Namabbalan Norte', 'Namabbalan Sur', 'Pallua Norte', 'Pallua Sur',
    'Pengue-Ruyu', 'San Gabriel', 'Tagga', 'Tanza', 'Ugac Norte', 'Ugac Sur',
  ].sort();

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private firestore: Firestore,
    private auth: Auth,
    private alertCtrl: AlertController,
    private http: HttpClient
  ) {
    // ✅ Detect edit mode & navigation source
    this.route.queryParams.subscribe((params) => {
      if (params['id']) {
        this.id = params['id'] as string;
        this.loadAddress(this.id);
      }
      if (params['from'] === 'checkout') {
        this.fromCheckout = true;
      }
    });
  }

  // ✅ Resolve current Firebase user
  async getCurrentUser() {
    return new Promise<any>((resolve) => {
      onAuthStateChanged(this.auth, (user) => resolve(user));
    });
  }

  // ✅ Auto-format phone number to 09xxxxxxxxx as the user types
  formatPhone() {
    this.phone = this.phone.replace(/[^0-9]/g, '').substring(0, 11);
  }

  // ✅ Load existing address for editing
  async loadAddress(id: string) {
    const user = await this.getCurrentUser();
    if (!user) return;

    const ref = doc(this.firestore, `users/${user.uid}/addresses/${id}`);
    const snap = await getDoc(ref);

    if (snap.exists()) {
      const data = snap.data() as any;
      this.fullName = data.fullName || '';
      this.barangay = data.barangay || '';
      this.street = data.street || '';
      this.phone = data.phone || '';
      this.isDefault = data.isDefault || false;
      this.lat = data.lat ?? null;
      this.lng = data.lng ?? null;
      this.editing = true;
    }
  }

  // ✅ Geocode (street + barangay → Tuguegarao)
  private async geocodeAddress(): Promise<{ lat: number; lng: number } | null> {
    try {
      const query = `${this.street}, ${this.barangay}, Tuguegarao City, Philippines`;
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
        query
      )}&limit=1`;
      const results: any = await firstValueFrom(this.http.get(url));
      if (results?.length > 0) {
        return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };
      }
      return null;
    } catch (err) {
      console.warn('⚠️ Geocode failed', err);
      return null;
    }
  }

  // ✅ Save or Update Address
  async saveAddress() {
    const user = await this.getCurrentUser();
    if (!user) {
      const alert = await this.alertCtrl.create({
        header: 'Error',
        message: '⚠️ You must be logged in to save an address.',
        buttons: ['OK'],
      });
      await alert.present();
      return;
    }

    // 🔹 Validate Philippine number (09xxxxxxxxx)
    if (!/^09\d{9}$/.test(this.phone)) {
      const alert = await this.alertCtrl.create({
        header: 'Invalid Number',
        message: 'Please enter a valid Philippine mobile number (e.g., 09XXXXXXXXX).',
        buttons: ['OK'],
      });
      await alert.present();
      return;
    }

    const ref = collection(this.firestore, `users/${user.uid}/addresses`);
    const newRef = this.id
      ? doc(this.firestore, `users/${user.uid}/addresses/${this.id}`)
      : doc(ref);
    const id = this.id || newRef.id;

    // 🔹 Attempt to geocode
    const coords = await this.geocodeAddress();
    if (coords) {
      this.lat = coords.lat;
      this.lng = coords.lng;
    } else {
      console.warn('⚠️ Geocoding failed — coordinates set to null.');
      this.lat = null;
      this.lng = null;
    }

    // 🔹 Determine if this is the user's first address
    const snapshot = await getDocs(ref);
    const isFirstAddress = snapshot.empty;
    if (isFirstAddress) this.isDefault = true;

    // 🔹 Reset other defaults
    if (this.isDefault && !isFirstAddress) {
      for (const docSnap of snapshot.docs) {
        if (docSnap.id !== id) {
          await setDoc(
            doc(this.firestore, `users/${user.uid}/addresses/${docSnap.id}`),
            { ...docSnap.data(), isDefault: false }
          );
        }
      }
    }

    // ✅ Final clean Firestore-safe object
    const newAddress = {
      id,
      fullName: this.fullName.trim(),
      barangay: this.barangay,
      street: this.street.trim(),
      city: 'Tuguegarao City',
      zipCode: '3500',
      phone: this.phone,
      isDefault: this.isDefault,
      lat: this.lat ?? null,
      lng: this.lng ?? null,
    };

    // 🔹 Write safely to Firestore
    await setDoc(newRef, newAddress);

    const alert = await this.alertCtrl.create({
      header: 'Success',
      message: '✅ Address saved successfully!',
      buttons: ['OK'],
    });
    await alert.present();

    // ✅ Redirect based on context
    if (this.fromCheckout) {
      this.router.navigate(['/checkout'], {
        state: { selectedAddress: newAddress },
      });
    } else {
      this.router.navigate(['/addresses']);
    }
  }
}
