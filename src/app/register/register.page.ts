import { Component, ElementRef, Renderer2 } from '@angular/core';
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
  fullName = '';
  email = '';
  password = '';
  confirmPassword = '';

  showPassword = false;
  showConfirm = false;

  passwordStrength: 'weak' | 'medium' | 'strong' = 'weak';
passwordError = '';
nameError = '';

checkPasswordStrength(): 'weak' | 'medium' | 'strong' {
  const p = this.password;
  if (!p) {
    this.passwordStrength = 'weak';
    return 'weak';
  }

  const strong = /(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}/;
  const medium = /((?=.*[a-z])(?=.*[A-Z])|(?=.*[A-Z])(?=.*\d)|(?=.*[a-z])(?=.*\d)).{6,}/;

  if (strong.test(p)) this.passwordStrength = 'strong';
  else if (medium.test(p)) this.passwordStrength = 'medium';
  else this.passwordStrength = 'weak';

  return this.passwordStrength;
}


  constructor(
    private authSvc: AuthService,
    private router: Router,
    private toastCtrl: ToastController,
    private el: ElementRef,
    private renderer: Renderer2
  ) {}

  // ──────────────────────────────────────────────
  // 👁️ Password Visibility Toggles
  // ──────────────────────────────────────────────
  togglePassword() {
    this.showPassword = !this.showPassword;
  }

  toggleConfirm() {
    this.showConfirm = !this.showConfirm;
  }

  // ──────────────────────────────────────────────
  // 🧭 Smooth scroll to active input
  // ──────────────────────────────────────────────
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


async createAccount() {
  // name validation
  const nameRegex = /^[A-Za-z\s]+$/;
  if (!this.fullName || !nameRegex.test(this.fullName)) {
    this.nameError = 'Full name must contain letters only.';
    return this.showToast(this.nameError, 'danger');
  } else this.nameError = '';

// email & password checks
const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const gmailRegex = /^[a-zA-Z0-9._%+-]+@gmail\.com$/;

if (!this.email || !this.password || !this.confirmPassword) {
  return this.showToast('Please fill in all fields.', 'warning');
}

if (!emailRegex.test(this.email.trim())) {
  return this.showToast('Please enter a valid email address.', 'danger');
}

// // Optional: only allow Gmail accounts
// if (!gmailRegex.test(this.email.trim())) {
//   return this.showToast('Only Gmail addresses are allowed.', 'danger');
// }

  if (this.password !== this.confirmPassword)
    return this.showToast('Passwords do not match.', 'danger');

  if (this.passwordStrength === 'weak')
    return this.showToast('Password is too weak.', 'danger');

  try {
    const user = await this.authSvc.emailRegister(
      this.fullName.trim(),
      this.email.trim(),
      this.password
    );

    if (user) {
      await this.showToast('Account created successfully!', 'success');
      // ✅ Auto-login and redirect
      await this.authSvc.emailLogin(this.email.trim(), this.password);
      this.router.navigate(['/landing-page']);
    }
  } catch (error: any) {
    console.error('❌ Account creation error', error);
    let msg = 'Error creating account. Please try again.';
    if (error.code === 'auth/email-already-in-use') msg = 'This email is already registered.';
    else if (error.code === 'auth/invalid-email') msg = 'Invalid email format.';
    else if (error.code === 'auth/weak-password') msg = 'Password is too weak.';
    this.showToast(msg, 'danger');
  }
}


  // ──────────────────────────────────────────────
  // 🔁 Navigation
  // ──────────────────────────────────────────────
  goToLogin() {
    this.router.navigate(['/login']);
  }

  // ──────────────────────────────────────────────
  // 🔔 Toast Helper
  // ──────────────────────────────────────────────
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
