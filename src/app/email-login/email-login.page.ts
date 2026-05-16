import { Component, ElementRef, AfterViewInit } from '@angular/core';
import { IonicModule, ToastController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../services/auth.service';

@Component({
  standalone: true,
  selector: 'app-email-login',
  templateUrl: './email-login.page.html',
  styleUrls: ['./email-login.page.scss'],
  imports: [IonicModule, CommonModule, FormsModule, RouterModule],
})
export class EmailLoginPage implements AfterViewInit {
  email: string = '';
  password: string = '';
  showPassword: boolean = false;

  constructor(
    private authSvc: AuthService,
    private router: Router,
    private toastCtrl: ToastController,
    private el: ElementRef
  ) {}

  togglePassword() {
    this.showPassword = !this.showPassword;
  }

  ngAfterViewInit() {
    const inputs = this.el.nativeElement.querySelectorAll('ion-input');
    inputs.forEach((input: HTMLIonInputElement) => {
      input.addEventListener('focusin', () => {
        setTimeout(() => {
          input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 150);
      });
    });
  }

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
      await this.authSvc.emailLogin(this.email.trim(), this.password);
      this.showToast('Login successful.', 'success');
    } catch (error: any) {
      console.error('❌ Email login error:', error);

      let msg = 'Login failed. Please try again.';
      if (error.code === 'auth/invalid-email') msg = 'Invalid email format.';
      else if (error.code === 'auth/user-not-found') msg = 'No account found with this email.';
      else if (error.code === 'auth/wrong-password') msg = 'Incorrect password.';
      else if (error.message) msg = error.message;

      this.showToast(msg, 'danger');
    }
  }

  goToResetPassword() {
    const emailTrimmed = this.email.trim();
    if (emailTrimmed) {
      this.router.navigate(['/reset-password'], {
        state: { email: emailTrimmed }
      });
    } else {
      this.router.navigate(['/reset-password']);
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