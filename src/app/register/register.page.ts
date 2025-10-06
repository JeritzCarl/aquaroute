import { Component } from '@angular/core';
import { IonicModule, ToastController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Component({
  standalone: true,
  selector: 'app-register',
  templateUrl: './register.page.html',
  styleUrls: ['./register.page.scss'],
  imports: [IonicModule, CommonModule, FormsModule, RouterModule],
})
export class RegisterPage {
  fullName: string = '';
  email: string = '';
  password: string = '';
  confirmPassword: string = '';

  constructor(
    private authSvc: AuthService,
    private router: Router,
    private toastCtrl: ToastController
  ) {}

  async createAccount() {
    if (!this.fullName || !this.email || !this.password) {
      this.showToast('Please fill out all fields.', 'warning');
      return;
    }

    if (this.password !== this.confirmPassword) {
      this.showToast('Passwords do not match.', 'danger');
      return;
    }

    if (this.password.length < 6) {
      this.showToast('Password must be at least 6 characters long.', 'danger');
      return;
    }

    try {
      const user = await this.authSvc.emailRegister(
        this.fullName.trim(),
        this.email.trim(),
        this.password
      );

      console.log('✅ Account created:', user);
      this.router.navigate(['/landing-page']);
    } catch (error: any) {
      console.error('❌ Failed to create account', error);
      let msg = 'Error creating account. Please try again.';
      if (error.code === 'auth/email-already-in-use') msg = 'This email is already registered.';
      else if (error.code === 'auth/invalid-email') msg = 'Invalid email format.';
      else if (error.code === 'auth/weak-password') msg = 'Password is too weak.';

      this.showToast(msg, 'danger');
    }
  }

  goToLogin() {
    this.router.navigate(['/login']);
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
