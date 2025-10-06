import { Component } from '@angular/core';
import { IonicModule, ToastController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { Auth, sendPasswordResetEmail } from '@angular/fire/auth';

@Component({
  standalone: true,
  selector: 'app-reset-password',
  templateUrl: './reset-password.page.html',
  styleUrls: ['./reset-password.page.scss'],
  imports: [IonicModule, CommonModule, FormsModule, RouterModule],
})
export class ResetPasswordPage {
  email: string = '';
  isLoading: boolean = false; // ✅ new state

  constructor(
    private auth: Auth,
    private router: Router,
    private toastCtrl: ToastController
  ) {}

  async resetPassword() {
    if (!this.email) {
      this.showToast('⚠️ Please enter your email address', 'warning');
      return;
    }

    this.isLoading = true; // show spinner
    try {
      await sendPasswordResetEmail(this.auth, this.email);
      this.showToast('📩 Reset link sent! Check your inbox.', 'success');
      this.router.navigate(['/login']);
    } catch (error: any) {
      console.error('❌ Reset password error:', error);

      if (error.code === 'auth/user-not-found') {
        this.showToast('❌ No account found with this email.', 'danger');
      } else if (error.code === 'auth/invalid-email') {
        this.showToast('⚠️ Please enter a valid email address.', 'warning');
      } else {
        this.showToast(
          error.message || 'Something went wrong. Please try again.',
          'danger'
        );
      }
    } finally {
      this.isLoading = false; // hide spinner
    }
  }

  private async showToast(message: string, color: 'primary' | 'success' | 'warning' | 'danger') {
    const toast = await this.toastCtrl.create({
      message,
      duration: 3000,
      position: 'top',
      color,
    });
    await toast.present();
  }
}
