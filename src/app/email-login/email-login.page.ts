import { Component } from '@angular/core';
import { IonicModule, ToastController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Firestore, collection, query, where, getDocs } from '@angular/fire/firestore';
import { AuthService } from '../services/auth.service';
import { User } from '@angular/fire/auth';

@Component({
  standalone: true,
  selector: 'app-email-login',
  templateUrl: './email-login.page.html',
  styleUrls: ['./email-login.page.scss'],
  imports: [IonicModule, CommonModule, FormsModule, RouterModule],
})
export class EmailLoginPage {
  email: string = '';
  password: string = '';

  constructor(
    private authSvc: AuthService,
    private firestore: Firestore,
    private router: Router,
    private toastCtrl: ToastController
  ) {}

  ionViewDidEnter() {
    this.email = '';
    this.password = '';
  }

  async loginWithEmail() {
    if (!this.email || !this.password) {
      this.showToast('Please enter email and password.', 'warning');
      return;
    }

    try {
      const user: User = await this.authSvc.emailLogin(this.email.trim(), this.password);

      console.log('✅ Email login success:', user);

      // ✅ If no phone → go to number-input
      if (!user.phoneNumber) {
        this.router.navigate(['/number-input'], {
          queryParams: { fromEmail: 'true' },
        });
        return;
      }

      // ✅ If phone exists → check station ownership
      const stationsRef = collection(this.firestore, 'stations');
      const q = query(stationsRef, where('ownerId', '==', user.uid));
      const snapshot = await getDocs(q);

      if (!snapshot.empty) {
        this.router.navigate(['/manager']);
      } else {
        this.router.navigate(['/landing-page']);
      }
    } catch (error: any) {
      console.error('❌ Email login error:', error);

      let msg = 'Login failed. Please try again.';
      if (error.code === 'auth/invalid-email') msg = 'Invalid email format.';
      else if (error.code === 'auth/user-not-found') msg = 'No account found with this email.';
      else if (error.code === 'auth/wrong-password') msg = 'Incorrect password.';

      this.showToast(msg, 'danger');
    }
  }

  private async showToast(message: string, color: 'success' | 'warning' | 'danger' = 'warning') {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2500,
      color,
    });
    await toast.present();
  }
}
