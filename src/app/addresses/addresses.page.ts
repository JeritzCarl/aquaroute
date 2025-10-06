import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, AlertController } from '@ionic/angular';
import { RouterModule, Router } from '@angular/router';
import { Firestore, collection, collectionData, doc, deleteDoc, updateDoc } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-addresses',
  templateUrl: './addresses.page.html',
  styleUrls: ['./addresses.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule],
})
export class AddressesPage implements OnInit, OnDestroy {
  addresses: any[] = [];
  private sub?: Subscription;

  constructor(
    private alertCtrl: AlertController,
    private firestore: Firestore,
    private auth: Auth,
    private router: Router
  ) {}

  ngOnInit() {
    const user = this.auth.currentUser;
    if (!user) return;

    const ref = collection(this.firestore, `users/${user.uid}/addresses`);
    this.sub = collectionData(ref, { idField: 'id' }).subscribe(data => {
      this.addresses = data;
    });
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
  }

  // ➕ Add Address
  addAddress() {
    this.router.navigate(['/add-address']);
  }

  // ✏️ Edit Address
  editAddress(addr: any, event?: Event) {
    event?.stopPropagation(); // prevent triggering select
    this.router.navigate(['/add-address'], {
      queryParams: { id: addr.id }
    });
  }

  // 🗑 Delete Address
  async deleteAddress(id: string, event?: Event) {
    event?.stopPropagation(); // prevent triggering select
    const alert = await this.alertCtrl.create({
      header: 'Delete Address',
      message: 'Are you sure you want to delete this address?',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Yes',
          handler: async () => {
            const user = this.auth.currentUser;
            if (!user) return;
            await deleteDoc(doc(this.firestore, `users/${user.uid}/addresses/${id}`));
          }
        }
      ]
    });
    await alert.present();
  }

  // 📌 Mark Default
  async setDefault(addr: any) {
    const user = this.auth.currentUser;
    if (!user) return;

    const promises = this.addresses.map(a => {
      const ref = doc(this.firestore, `users/${user.uid}/addresses/${a.id}`);
      return updateDoc(ref, { isDefault: a.id === addr.id });
    });

    await Promise.all(promises);
  }

  // ✅ Select Address → navigate back to checkout
  selectAddress(addr: any) {
    this.router.navigate(['/checkout'], {
      state: { selectedAddress: addr }
    });
  }
}
