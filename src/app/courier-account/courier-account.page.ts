import { Component, OnInit } from '@angular/core';
import { Auth, signOut } from '@angular/fire/auth';
import { Router } from '@angular/router';
import { CourierService } from '../services/courier.service';
import { CommonModule } from '@angular/common';
import { IonicModule, NavController, AlertController } from '@ionic/angular';
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
  courierPhotoUrl: string = 'assets/default-avatar.png';

  constructor(
    private auth: Auth,
    private router: Router,
    private navCtrl: NavController,
    private courierService: CourierService,
    private alertCtrl: AlertController   // ✅ Added
  ) {}

  async ngOnInit() {
    const user = this.auth.currentUser;

    if (user) {
      this.courierEmail = user.email || '';
      this.courierName = user.displayName || this.courierName;
      this.courierPhotoUrl = user.photoURL || this.courierPhotoUrl;

      const info = await this.courierService.getCourierStationAndProfile(user.uid);
      if (info) {
        this.stationName = info.stationName || this.stationName;
        this.myCourierId = info.courierId || '';

        if (info.name) this.courierName = info.name;
        this.courierPhotoUrl =
          info.photoUrl || user.photoURL || this.courierPhotoUrl;

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

  // ✅ Updated logout → now calls confirmation first
  async logout() {
    const alert = await this.alertCtrl.create({
      header: 'Log Out?',
      message: 'Are you sure you want to log out of your courier account?',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel',
        },
        {
          text: 'Log Out',
          handler: async () => {
            try {
              await signOut(this.auth);
              localStorage.removeItem('courierProfile');
              this.navCtrl.navigateRoot('/home'); // 👈 full navigation reset
              console.log('✅ Courier logged out and redirected to Home');
            } catch (e) {
              console.error('❌ Logout failed:', e);
            }
          },
        },
      ],
    });

    await alert.present();
  }

  goBack() {
    this.router.navigateByUrl('/courier', { replaceUrl: true });
  }
}
