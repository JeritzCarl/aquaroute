// src/app/profile/profile.page.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, AlertController } from '@ionic/angular';
import { RouterModule, Router } from '@angular/router';
import {
  Auth,
  signOut,
  deleteUser,
  reauthenticateWithPopup,
  reauthenticateWithCredential,
  EmailAuthProvider,
  GoogleAuthProvider,
  FacebookAuthProvider,
  PhoneAuthProvider,
  PhoneAuthCredential,
  User,
} from '@angular/fire/auth';
import { Firestore, collection, deleteDoc, doc, getDocs } from '@angular/fire/firestore';
import { UserService } from '../services/user.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-profile',
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule],
})
export class ProfilePage implements OnInit, OnDestroy {
  private userSub?: Subscription;

  profilePic: string = 'assets/profile-placeholder.png';
  displayName: string | null = null;
  email: string | null = null;
  phoneNumber: string | null = null;
  provider: string | null = null;
  isGoogleLinked: boolean = false;
  isFacebookLinked: boolean = false;

  constructor(
    private auth: Auth,
    private router: Router,
    private alertCtrl: AlertController,
    private userService: UserService,
    private firestore: Firestore
  ) {}

  ngOnInit() {
    this.userSub = this.userService.user$.subscribe((user) => {
      if (!user) {
        this.displayName = null;
        this.email = null;
        this.phoneNumber = null;
        this.profilePic = 'assets/profile-placeholder.png';
        this.provider = null;
        this.isGoogleLinked = false;
        this.isFacebookLinked = false;
        return;
      }

      this.displayName = user.displayName ?? 'Guest User';
      this.email = user.email ?? 'No email linked';
      this.profilePic = user.photoURL ?? this.profilePic;
      this.phoneNumber = user.phoneNumber ? user.phoneNumber.replace(/^\+63/, '0') : null;

      this.isGoogleLinked = false;
      this.isFacebookLinked = false;
      this.provider = null;

      const providerData = (user as any).providerData || [];
      for (const p of providerData) {
        const providerId = p?.providerId ?? '';
        if (providerId.includes('google')) {
          this.provider = 'Google';
          this.isGoogleLinked = true;
        } else if (providerId.includes('facebook')) {
          this.provider = 'Facebook';
          this.isFacebookLinked = true;
        } else if (providerId.includes('password')) {
          this.provider = 'Email';
        } else if (providerId.includes('phone')) {
          this.provider = 'Phone Number';
        }
      }

      if (!this.provider) {
        if (this.phoneNumber) this.provider = 'Phone Number';
        else if (this.email && this.email !== 'No email linked') this.provider = 'Email';
      }
    });
  }

  async logout() {
    await signOut(this.auth);
    this.router.navigate(['/login']);
  }

  async confirmDeleteAccount() {
    const alert = await this.alertCtrl.create({
      header: 'Delete Account',
      message: 'Are you sure you want to permanently delete your account? This action cannot be undone.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: () => this.deleteAccount(),
        },
      ],
    });
    await alert.present();
  }

  // 🔹 Delete all Firestore user data
  private async deleteUserData(uid: string) {
    try {
      await deleteDoc(doc(this.firestore, `users/${uid}`));

      const ordersSnap = await getDocs(collection(this.firestore, `users/${uid}/orders`));
      for (const order of ordersSnap.docs) await deleteDoc(order.ref);

      const addrSnap = await getDocs(collection(this.firestore, `users/${uid}/addresses`));
      for (const addr of addrSnap.docs) await deleteDoc(addr.ref);

      const notifSnap = await getDocs(collection(this.firestore, `users/${uid}/notifications`));
      for (const notif of notifSnap.docs) await deleteDoc(notif.ref);

      console.log(`✅ All Firestore data deleted for user: ${uid}`);
    } catch (err) {
      console.error('❌ Failed to delete user Firestore data:', err);
    }
  }

// 🔹 Handle reauthentication when required
private async reauthenticate(user: User) {
  if (user.providerData.some(p => p.providerId === 'password')) {
    const password = prompt('Please re-enter your password to confirm account deletion:') || '';
    const credential = EmailAuthProvider.credential(user.email!, password);
    return reauthenticateWithCredential(user, credential);
  }
  if (user.providerData.some(p => p.providerId.includes('google'))) {
    return reauthenticateWithPopup(user, new GoogleAuthProvider());
  }
  if (user.providerData.some(p => p.providerId.includes('facebook'))) {
    return reauthenticateWithPopup(user, new FacebookAuthProvider());
  }
  if (user.providerData.some(p => p.providerId.includes('phone'))) {
    const otp = prompt('Enter the SMS verification code sent to your phone:') || '';
    const verificationId = localStorage.getItem('lastVerificationId');
    if (!verificationId) throw new Error('No verificationId found. Please log in again before deleting your account.');
    const credential: PhoneAuthCredential = PhoneAuthProvider.credential(verificationId, otp);
    return reauthenticateWithCredential(user, credential);
  }

  // ✅ Added fallback
  throw new Error('Unsupported provider. Cannot reauthenticate.');
}


  async deleteAccount() {
    const currentUser = this.auth.currentUser;
    if (!currentUser) {
      console.warn('No authenticated user available to delete.');
      return;
    }

    try {
      // 🔹 Step 1: Delete Firestore data
      await this.deleteUserData(currentUser.uid);

      // 🔹 Step 2: Try deleting auth user directly
      await deleteUser(currentUser);

      // 🔹 Step 3: Redirect
      this.router.navigate(['/signup']);
    } catch (error: any) {
      if (error.code === 'auth/requires-recent-login') {
        console.warn('⚠️ Reauthentication required');
        try {
          await this.reauthenticate(currentUser);

          // Retry Firestore delete + auth delete
          await this.deleteUserData(currentUser.uid);
          await deleteUser(currentUser);

          this.router.navigate(['/signup']);
          return;
        } catch (reauthErr) {
          console.error('❌ Reauthentication failed:', reauthErr);
        }
      } else {
        console.error('❌ Error deleting account:', error);
      }

      const alert = await this.alertCtrl.create({
        header: 'Delete Account',
        message: 'Failed to delete your account. Please try again.',
        buttons: ['OK'],
      });
      await alert.present();
    }
  }

  ngOnDestroy() {
    this.userSub?.unsubscribe();
  }
}
