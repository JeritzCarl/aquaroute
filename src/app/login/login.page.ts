import { Component } from '@angular/core';
import { IonicModule, ToastController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Component({
  standalone: true,
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  imports: [IonicModule, CommonModule, FormsModule, RouterModule],
})
export class LoginPage {
  constructor(
    private authSvc: AuthService,
    private toastCtrl: ToastController
  ) {}

  // ✅ Google login
  async loginWithGoogle() {
    try {
      await this.authSvc.loginWithGoogle();
      // AuthService will handle redirect
    } catch (error: any) {
      console.error('🔴 Google login raw error:', error);
      this.showToast(
        `Google login failed: ${error?.code || error?.message || error}`,
        'danger'
      );
    }
  }

  // ✅ Facebook login
  async loginWithFacebook() {
    try {
      await this.authSvc.loginWithFacebook();
      this.showToast('✅ Facebook login successful', 'success');
    } catch (error: any) {
      this.handleError(error, 'Facebook');
    }
  }

  // ✅ Email login → go to email-login page
  loginWithEmail() {
    this.showToast('✉️ Redirecting to Email Login...', 'medium');
    window.location.href = '/email-login';
  }

  // ✅ Back to home
  navigateHome() {
    window.location.href = '/home';
  }

  // 🔔 Error handler
  private async handleError(error: any, provider: string) {
    if (error?.code === 'auth/popup-closed-by-user') {
      this.showToast(`${provider} login was canceled.`, 'warning');
    } else {
      console.error(`${provider} login error (raw):`, error);
      this.showToast(
        `${provider} login failed: ${error?.code || error?.message || error}`,
        'danger'
      );
    }
  }

  // 🔔 Toast helper
  private async showToast(
    message: string,
    color: 'success' | 'warning' | 'danger' | 'medium' = 'warning'
  ) {
    const toast = await this.toastCtrl.create({ message, duration: 3000, color });
    await toast.present();
  }
}
