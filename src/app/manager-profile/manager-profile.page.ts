import { Component, OnInit } from '@angular/core';
import { IonicModule, AlertController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { UserService } from '../services/user.service';

@Component({
  selector: 'app-manager-profile',
  templateUrl: './manager-profile.page.html',
  styleUrls: ['./manager-profile.page.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule]
})
export class ManagerProfilePage implements OnInit {
  profilePic: string = 'assets/profile-placeholder.png';
  displayName: string | null = null;
  email: string | null = null;
  phoneNumber: string | null = null;

  constructor(
    private userService: UserService,
    private router: Router,
    private alertCtrl: AlertController
  ) {}

  ngOnInit() {
    const user = this.userService.currentUser;
    if (user) {
      this.displayName = user.displayName ?? 'Manager User';
      this.email = user.email ?? 'No email linked';
      this.profilePic = user.photoURL || 'assets/profile-placeholder.png';
      this.phoneNumber = user.phoneNumber ? user.phoneNumber.replace(/^\+63/, '0') : null;
    }
  }

  async logout() {
    try {
      await this.userService.signOut(); // ✅ fixed
      this.router.navigate(['/home']);
    } catch (err) {
      console.error('Logout failed', err);
    }
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
          handler: () => this.deleteAccount()
        }
      ]
    });
    await alert.present();
  }

  async deleteAccount() {
    try {
      await this.userService.deleteAccount(); // ✅ make sure this exists in UserService
      this.router.navigate(['/home']);
    } catch (err) {
      console.error('Delete account failed', err);
    }
  }
}
