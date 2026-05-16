import { Component, OnInit, NgZone } from '@angular/core';
import { IonicModule, AlertController, NavController, ToastController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { UserService } from '../services/user.service';
import { Firestore, collection, getDocs, query, updateDoc, where, doc } from '@angular/fire/firestore';

@Component({
  selector: 'app-manager-profile',
  templateUrl: './manager-profile.page.html',
  styleUrls: ['./manager-profile.page.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule],
})
export class ManagerProfilePage implements OnInit {
  profilePic: string = 'assets/profile-placeholder.png';
  displayName: string | null = null;
  email: string | null = null;
  phoneNumber: string | null = null;
  gcashName: string = '';
  gcashNumber: string = '';
  stationId: string = '';
  isSavingPayment: boolean = false;

  constructor(
    private userService: UserService,
    private router: Router,
    private navCtrl: NavController,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
    private zone: NgZone,
    private firestore: Firestore
  ) {}

  async ngOnInit() {
    const user = this.userService.currentUser;
    if (user) {
      this.displayName = user.displayName ?? 'Manager User';
      this.email = user.email ?? 'No email linked';
      this.profilePic = user.photoURL || 'assets/profile-placeholder.png';
      this.phoneNumber = user.phoneNumber ? user.phoneNumber.replace(/^\+63/, '0') : null;

      await this.loadPaymentDetails(user.uid);
    }
  }

    async loadPaymentDetails(ownerId: string) {
    try {
      const stationsRef = collection(this.firestore, 'stations');
      const q = query(stationsRef, where('ownerId', '==', ownerId));
      const snap = await getDocs(q);

      if (!snap.empty) {
        const stationDoc = snap.docs[0];
        const stationData: any = stationDoc.data();

        this.stationId = stationDoc.id;
        this.gcashName = stationData.gcashName || '';
        this.gcashNumber = this.displayPhoneForInput(stationData.gcashNumber || '');
      }
    } catch (error) {
      console.error('❌ Failed to load payment details:', error);
    }
  }

  onGcashNumberInput(event: any) {
    const rawValue = event?.detail?.value ?? event?.target?.value ?? '';
    this.gcashNumber = this.displayPhoneForInput(rawValue);
  }

  private displayPhoneForInput(value: string): string {
    if (!value) return '';

    let cleaned = value.replace(/\D/g, '');

    if (cleaned.startsWith('63')) {
      cleaned = '0' + cleaned.slice(2);
    }

    if (!cleaned.startsWith('0') && cleaned.length === 10 && cleaned.startsWith('9')) {
      cleaned = '0' + cleaned;
    }

    return cleaned.slice(0, 11);
  }

  private normalizePhoneToPhp63(value: string): string {
    const cleaned = (value || '').replace(/\D/g, '');

    if (cleaned.length === 11 && cleaned.startsWith('09')) {
      return '+63' + cleaned.slice(1);
    }

    if (cleaned.length === 12 && cleaned.startsWith('639')) {
      return '+' + cleaned;
    }

    if (cleaned.length === 13 && cleaned.startsWith('63')) {
      return '+' + cleaned;
    }

    if (value.startsWith('+63') && cleaned.length === 12 && cleaned.startsWith('63')) {
      return '+' + cleaned;
    }

    return '';
  }

  private isValidPhilippineMobile(value: string): boolean {
    const cleaned = (value || '').replace(/\D/g, '');
    return cleaned.length === 11 && cleaned.startsWith('09');
  }

  async savePaymentDetails() {
    if (!this.stationId) {
      const toast = await this.toastCtrl.create({
        message: 'No station account found for this manager.',
        duration: 2000,
        color: 'danger',
      });
      await toast.present();
      return;
    }

    if (!this.gcashName.trim()) {
      const toast = await this.toastCtrl.create({
        message: 'Please enter the GCash account name.',
        duration: 2000,
        color: 'warning',
      });
      await toast.present();
      return;
    }

    if (!this.isValidPhilippineMobile(this.gcashNumber)) {
      const toast = await this.toastCtrl.create({
        message: 'GCash number must be 11 digits and start with 09.',
        duration: 2200,
        color: 'warning',
      });
      await toast.present();
      return;
    }

    const normalizedNumber = this.normalizePhoneToPhp63(this.gcashNumber);

    if (!normalizedNumber) {
      const toast = await this.toastCtrl.create({
        message: 'Invalid GCash number format.',
        duration: 2000,
        color: 'warning',
      });
      await toast.present();
      return;
    }

    this.isSavingPayment = true;

    try {
      const stationRef = doc(this.firestore, `stations/${this.stationId}`);

      await updateDoc(stationRef, {
        gcashName: this.gcashName.trim(),
        gcashNumber: normalizedNumber,
      });

      this.gcashNumber = this.displayPhoneForInput(normalizedNumber);

      const toast = await this.toastCtrl.create({
        message: 'GCash payment details updated successfully.',
        duration: 1800,
        color: 'success',
      });
      await toast.present();
    } catch (error) {
      console.error('❌ Failed to save payment details:', error);

      const toast = await this.toastCtrl.create({
        message: 'Failed to save payment details. Please try again.',
        duration: 2000,
        color: 'danger',
      });
      await toast.present();
    } finally {
      this.isSavingPayment = false;
    }
  }

  // ─────────────────────────────────────────────
  // 🔹 Logout Confirmation (permanent fix)
  // ─────────────────────────────────────────────
  async logout() {
    const alert = await this.alertCtrl.create({
      header: 'Confirm Logout',
      message: 'Are you sure you want to log out?',
      cssClass: 'aqua-alert',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel',
          cssClass: 'aqua-cancel',
        },
        {
          text: 'Logout',
          role: 'destructive',
          cssClass: 'aqua-logout',
          handler: async () => {
            try {
              // 🔹 Full Firebase sign-out
              await this.userService.signOut();

              // 🔹 Clear caches and session
              localStorage.clear();
              sessionStorage.clear();

              const toast = await this.toastCtrl.create({
                message: 'You have been logged out successfully.',
                duration: 1500,
                color: 'medium',
              });
              await toast.present();

              // ✅ Reset navigation and prevent back navigation
              this.zone.run(() => {
                this.navCtrl.navigateRoot('/login', { animated: true });
              });

              // 🧠 Final hard safety flush (stops “ghost session” issue)
              setTimeout(() => {
                window.location.replace('/login');
              }, 400);
            } catch (err) {
              console.error('❌ Logout failed:', err);
              const toast = await this.toastCtrl.create({
                message: 'Logout failed. Please try again.',
                duration: 2000,
                color: 'danger',
              });
              await toast.present();
            }
          },
        },
      ],
    });

    await alert.present();
  }

  // ─────────────────────────────────────────────
  // 🔹 Delete Account Confirmation
  // ─────────────────────────────────────────────
  async confirmDeleteAccount() {
    const alert = await this.alertCtrl.create({
      header: 'Delete Account',
      message:
        'Are you sure you want to permanently delete your account? This action cannot be undone.',
      cssClass: 'aqua-alert',
      buttons: [
        { text: 'Cancel', role: 'cancel', cssClass: 'aqua-cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          cssClass: 'aqua-logout',
          handler: async () => this.deleteAccount(),
        },
      ],
    });

    await alert.present();
  }

  // ─────────────────────────────────────────────
  // 🔹 Delete Account Logic (same safe redirect)
  // ─────────────────────────────────────────────
  async deleteAccount() {
    try {
      await this.userService.deleteAccount();

      const toast = await this.toastCtrl.create({
        message: 'Account deleted successfully.',
        duration: 1500,
        color: 'medium',
      });
      await toast.present();

      this.zone.run(() => {
        this.navCtrl.navigateRoot('/login', { animated: true });
      });

      setTimeout(() => {
        window.location.replace('/login');
      }, 400);

      console.log('✅ Manager account deleted and redirected to Login');
    } catch (err) {
      console.error('❌ Delete account failed', err);
      const toast = await this.toastCtrl.create({
        message: 'Account deletion failed. Please try again.',
        duration: 2000,
        color: 'danger',
      });
      await toast.present();
    }
  }
}
