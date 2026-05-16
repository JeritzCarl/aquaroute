import { Component } from '@angular/core';
import { IonicModule, ToastController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../services/auth.service';

@Component({
  standalone: true,
  selector: 'app-auth-options',
  templateUrl: './auth-options.page.html',
  styleUrls: ['./auth-options.page.scss'],
  imports: [IonicModule, CommonModule, FormsModule, RouterModule],
})
export class AuthOptionsPage {
  constructor(
    private authSvc: AuthService,
    private router: Router,
    private toastCtrl: ToastController
  ) {}

  async continueWithGoogle() {
    try {
      await this.authSvc.loginWithGoogle();
      this.showToast('✅ Login successful', 'success');
    } catch (error: any) {
      console.error('❌ Google Sign-In failed:', error);
      this.showToast(`Google login failed: ${error?.message || error}`, 'danger');
    }
  }

  createAccount() {
    this.router.navigate(['/register']);
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