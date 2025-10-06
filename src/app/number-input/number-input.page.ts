import { Component } from '@angular/core';
import { IonicModule, ToastController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Component({
  standalone: true,
  selector: 'app-number-input',
  templateUrl: './number-input.page.html',
  styleUrls: ['./number-input.page.scss'],
  imports: [IonicModule, CommonModule, FormsModule, RouterModule],
})
export class NumberInputPage {
  phoneNumber: string = '';
  isSending: boolean = false;
  mode: 'login' | 'signup' = 'login';

  constructor(
    private authSvc: AuthService,
    private router: Router,
    private route: ActivatedRoute,
    private toastCtrl: ToastController
  ) {
    this.route.queryParams.subscribe((params) => {
      if (params['mode']) {
        this.mode = params['mode'];
      }
    });
  }

  async sendOTP() {
    if (!this.phoneNumber) {
      this.showToast('Please enter a phone number.', 'warning');
      return;
    }
    if (this.isSending) return;
    this.isSending = true;

    try {
      await this.authSvc.sendPhoneOTP(this.phoneNumber, 'recaptcha-container');
      console.log(`✅ OTP sent to: ${this.phoneNumber}`);
      this.showToast('OTP has been sent to your number.', 'success');
      this.router.navigate(['/verify']);
    } catch (error: any) {
      console.error('❌ Failed to send OTP', error);
      const message =
        error?.message || 'Failed to send OTP. Please try again later.';
      this.showToast(message, 'danger');
    } finally {
      this.isSending = false;
    }
  }

  private async showToast(
    message: string,
    color: 'success' | 'warning' | 'danger' = 'warning'
  ) {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2500,
      color,
    });
    await toast.present();
  }
}
