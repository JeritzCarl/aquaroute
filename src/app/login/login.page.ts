import { Component } from '@angular/core';
import { IonicModule, ToastController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
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
    private toastCtrl: ToastController,
    private router: Router
  ) {}

  async loginWithGoogle() {
    try {
      await this.authSvc.loginWithGoogle();
      this.showToast('✅ Login successful', 'success');
    } catch (error: any) {
      console.error('🔴 Google login error:', error);
      this.showToast(
        `Google login failed: ${error?.message || error}`,
        'danger'
      );
    }
  }

  loginWithEmail() {
    this.showToast('✉️ Redirecting to Email Login...', 'medium');
    this.router.navigateByUrl('/email-login');
  }

  private async showToast(
    message: string,
    color: 'success' | 'warning' | 'danger' | 'medium' = 'warning'
  ) {
    const toast = await this.toastCtrl.create({
      message,
      duration: 3000,
      color
    });
    await toast.present();
  }
}