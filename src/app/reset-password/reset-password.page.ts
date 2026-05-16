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
  isLoading: boolean = false;

  constructor(
    private auth: Auth,
    private router: Router,
    private toastCtrl: ToastController
  ) {
    const nav = this.router.getCurrentNavigation();
    const passedEmail = nav?.extras?.state?.['email'] || history.state?.email;
    if (passedEmail) this.email = passedEmail;
  }

  async resetPassword() {
    const emailTrimmed = this.email.trim();

    if (!emailTrimmed) {
      this.showToast('Please enter your email address.', 'warning');
      return;
    }

    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[A-Za-z]{2,}$/;
    if (!emailRegex.test(emailTrimmed)) {
      this.showToast('Please enter a valid email address.', 'warning');
      return;
    }

    this.isLoading = true;
    try {
      await sendPasswordResetEmail(this.auth, emailTrimmed);
      await this.showToast('Reset link sent! Check your inbox.', 'success');
      this.router.navigate(['/email-login'], { replaceUrl: true });
    } catch (error: any) {
      console.error('❌ Reset password error:', error);

      switch (error.code) {
        case 'auth/user-not-found':
          this.showToast('No account found with this email.', 'danger');
          break;
        case 'auth/invalid-email':
          this.showToast('Invalid email address.', 'warning');
          break;
        default:
          this.showToast('Something went wrong. Please try again.', 'danger');
          break;
      }
    } finally {
      this.isLoading = false;
    }
  }

  private async showToast(
    message: string,
    color: 'primary' | 'success' | 'warning' | 'danger'
  ) {
    const toast = await this.toastCtrl.create({
      message,
      duration: 3000,
      position: 'top',
      color,
    });
    await toast.present();
  }
}