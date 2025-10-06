import { Component } from '@angular/core';
import { IonicModule, AlertController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { Firestore, collection, query, where, getDocs } from '@angular/fire/firestore';
import { AuthService } from '../services/auth.service';
import { User } from '@angular/fire/auth';

@Component({
  standalone: true,
  selector: 'app-verify',
  templateUrl: './verify.page.html',
  styleUrls: ['./verify.page.scss'],
  imports: [IonicModule, CommonModule, FormsModule, RouterModule],
})
export class VerifyPage {
  otpCode: string = '';

  constructor(
    private authSvc: AuthService,
    private firestore: Firestore,
    private router: Router,
    private alertCtrl: AlertController
  ) {}

  async verifyCode() {
    if (!this.otpCode || this.otpCode.length < 6) {
      this.showAlert('Error', 'Please enter the 6-digit code.');
      return;
    }

    try {
      const user: User = await this.authSvc.verifyPhoneOTP(this.otpCode);

      console.log('✅ Phone verified & Firestore updated:', user.phoneNumber);

      // ✅ Check if this user owns a station
      const stationsRef = collection(this.firestore, 'stations');
      const q = query(stationsRef, where('ownerId', '==', user.uid));
      const snapshot = await getDocs(q);

      if (!snapshot.empty) {
        this.router.navigate(['/manager']);
      } else {
        this.router.navigate(['/landing-page']);
      }
    } catch (error: any) {
      console.error('❌ Verification failed', error);
      this.showAlert(
        'Invalid Code',
        'The code you entered is invalid or expired. Please try again.'
      );
    }
  }

  private async showAlert(header: string, message: string) {
    const alert = await this.alertCtrl.create({
      header,
      message,
      buttons: ['OK'],
    });
    await alert.present();
  }
}
