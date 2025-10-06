import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, AlertController } from '@ionic/angular';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { 
  Firestore, 
  doc, 
  setDoc, 
  getDoc, 
  collection, 
  getDocs 
} from '@angular/fire/firestore';
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
  notes = '';
  isDefault = false;
  editing = false;
  lat?: number;
  lng?: number;

  barangays: string[] = [
    "Annafunan East","Annafunan West","Atulayan Norte","Atulayan Sur","Bagay",
    "Buntun","Caggay","Capatan","Carig Norte","Carig Sur","Caritan Centro",
    "Caritan Norte","Caritan Sur","Cataggaman Nuevo","Cataggaman Pardo","Cataggaman Viejo",
    "Centro 01 (Bagumbayan)","Centro 02 (Poblacion)","Centro 03 (Poblacion)","Centro 04 (Poblacion)",
    "Centro 05 (Bagumbayan)","Centro 06 (Poblacion)","Centro 07 (Poblacion)","Centro 08 (Poblacion)",
    "Centro 09 (Bagumbayan)","Centro 10 (Riverside)","Centro 11 (Balzain East)","Centro 12 (Balzain West)",
    "Dadda","Gosi Norte","Gosi Sur","Larion Alto","Larion Bajo","Leonarda","Libag Norte","Libag Sur",
    "Linao East","Linao Norte","Linao West","Namabbalan Norte","Namabbalan Sur","Pallua Norte","Pallua Sur",
    "Pengue-Ruyu","San Gabriel","Tagga","Tanza","Ugac Norte","Ugac Sur"
  ].sort();

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private firestore: Firestore,
    private auth: Auth,
    private alertCtrl: AlertController,
    private http: HttpClient
  ) {
    this.route.queryParams.subscribe(params => {
      if (params['id']) {
        this.id = params['id'] as string;
        this.loadAddress(this.id);
      }
    });
  }

  async getCurrentUser() {
    return new Promise<any>((resolve) => {
      onAuthStateChanged(this.auth, (user) => resolve(user));
    });
  }

  // 🔹 Load existing address for editing
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
      this.notes = data.notes || '';
      this.isDefault = data.isDefault || false;
      this.lat = data.lat;
      this.lng = data.lng;
      this.editing = true;
    }
  }

  // 🔹 Geocode street + barangay → Tuguegarao
  private async geocodeAddress(): Promise<{ lat: number; lng: number } | null> {
    try {
      const query = `${this.street}, ${this.barangay}, Tuguegarao City, Philippines`;
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
      const results: any = await firstValueFrom(this.http.get(url));
      if (results && results.length > 0) {
        return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };
      }
      return null;
    } catch (err) {
      console.warn('Geocode failed', err);
      return null;
    }
  }

  // 🔹 Save address (new or update)
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

    const ref = collection(this.firestore, `users/${user.uid}/addresses`);
    const newRef = this.id 
      ? doc(this.firestore, `users/${user.uid}/addresses/${this.id}`) 
      : doc(ref);
    const id = this.id || newRef.id;

    // Geocode before saving
    const coords = await this.geocodeAddress();
    if (coords) {
      this.lat = coords.lat;
      this.lng = coords.lng;
    }

    // Check how many addresses exist
    const snapshot = await getDocs(ref);
    const isFirstAddress = snapshot.empty;
    if (isFirstAddress) this.isDefault = true;

    // Reset other defaults if needed
    if (this.isDefault && !isFirstAddress) {
      for (const docSnap of snapshot.docs) {
        if (docSnap.id !== id) {
          await setDoc(doc(this.firestore, `users/${user.uid}/addresses/${docSnap.id}`), {
            ...docSnap.data(),
            isDefault: false,
          });
        }
      }
    }

    const newAddress = {
      id,
      fullName: this.fullName,
      barangay: this.barangay,
      street: this.street,
      phone: this.phone,
      notes: this.notes,
      isDefault: this.isDefault,
      lat: this.lat,
      lng: this.lng,
    };

    await setDoc(newRef, newAddress);

    const alert = await this.alertCtrl.create({
      header: 'Success',
      message: '✅ Address saved successfully!',
      buttons: ['OK'],
    });
    await alert.present();

    // ✅ Redirect back to Checkout with this address
    this.router.navigate(['/checkout'], {
      state: { selectedAddress: newAddress }
    });
  }
}
