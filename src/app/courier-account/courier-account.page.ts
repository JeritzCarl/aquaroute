import { Component, OnInit } from '@angular/core';
import { Auth, signOut } from '@angular/fire/auth';
import { Router } from '@angular/router';
import { CourierService } from '../services/courier.service';

// ✅ Angular & Ionic imports for standalone page
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-courier-account',
  templateUrl: './courier-account.page.html',
  styleUrls: ['./courier-account.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule],
})
export class CourierAccountPage implements OnInit {
  courierName = 'Courier';
  courierEmail = '';
  stationName = 'Station';
  myCourierId = '';
  courierPhotoUrl: string = 'assets/default-avatar.png'; // ✅ fallback

  constructor(
    private auth: Auth,
    private router: Router,
    private courierService: CourierService
  ) {}

  async ngOnInit() {
    const user = this.auth.currentUser;

    if (user) {
      // 🔹 Base profile from Firebase Auth
      this.courierEmail = user.email || '';
      this.courierName = user.displayName || this.courierName;
      this.courierPhotoUrl = user.photoURL || this.courierPhotoUrl;

      // 🔹 Get courier + station profile from Firestore
      const info = await this.courierService.getCourierStationAndProfile(user.uid);
      if (info) {
        this.stationName = info.stationName || this.stationName;
        this.myCourierId = info.courierId || '';

        // Prefer Firestore name/photo if available
        if (info.name) this.courierName = info.name;
        this.courierPhotoUrl =
          info.photoUrl || user.photoURL || this.courierPhotoUrl;

        // ✅ Save/update cache so CourierPage shows correct info after refresh
        localStorage.setItem(
          'courierProfile',
          JSON.stringify({
            name: this.courierName,
            stationName: this.stationName,
            photoUrl: this.courierPhotoUrl,
          })
        );
      }
    }
  }

  // 🔹 Logout function
  async logout() {
    try {
      await signOut(this.auth);

      // 🧹 Clear cache on logout
      localStorage.removeItem('courierProfile');

      this.router.navigateByUrl('/login', { replaceUrl: true });
    } catch (e) {
      console.error('Logout failed:', e);
    }
  }

  // 🔹 Back navigation
  goBack() {
    this.router.navigateByUrl('/courier', { replaceUrl: true });
  }
}
