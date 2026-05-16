import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { RouterModule, Router } from '@angular/router';
import { UserService, AppUser } from '../services/user.service';
import { Subscription } from 'rxjs';
import { NotificationService } from '../services/notification.service';

// ✅ Correct import
import { EditPersonalInfoModal } from './modals/edit-personal-info.modal';

@Component({
  selector: 'app-account',
  templateUrl: './account.page.html',
  styleUrls: ['./account.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule],
})
export class AccountPage implements OnInit, OnDestroy {
  private userSub?: Subscription;
  private notifSub?: Subscription;

  profilePic: string = 'assets/profile-placeholder.png';
  displayName: string | null = null;
  email: string | null = null;
  phoneNumber: string | null = null;
  provider: string | null = null;
  gender: string | null = null;
  dob: string | null = null;

  // 🔴 Unread Notifications
  unreadCount = 0;

  constructor(
    private userService: UserService,
    private router: Router,
    private modalCtrl: ModalController,
    private notifSvc: NotificationService
  ) {}

  ngOnInit() {
    // 👤 Subscribe to user profile updates
    this.userSub = this.userService.user$.subscribe((user: AppUser | null) => {
      if (!user) {
        this.displayName = null;
        this.email = null;
        this.phoneNumber = null;
        this.profilePic = 'assets/profile-placeholder.png';
        this.provider = null;
        this.gender = null;
        this.dob = null;
        return;
      }

      this.displayName = user.displayName ?? null;
      this.email = user.email ?? null;
      this.profilePic = user.photoURL ?? this.profilePic;
      this.phoneNumber = user.phoneNumber
        ? user.phoneNumber.replace(/^\+63/, '0')
        : null;

      this.gender = user.gender ?? null;
      this.dob = user.dob ?? null;

      const providerData = (user as any).providerData;
      if (providerData && providerData.length > 0) {
        const providerId = providerData[0]?.providerId ?? '';
        if (providerId.includes('google')) this.provider = 'Google';
        else if (providerId.includes('facebook')) this.provider = 'Facebook';
        else if (providerId.includes('password')) this.provider = 'Email';
        else if (providerId.includes('phone')) this.provider = 'Phone Number';
        else this.provider = 'Unknown';
      } else {
        this.provider = null;
      }
    });

    // 🔴 Subscribe to unread notifications counter
    this.notifSub = this.notifSvc.getUnreadCount$().subscribe((count) => {
      this.unreadCount = count;
    });
  }

  ngOnDestroy() {
    this.userSub?.unsubscribe();
    this.notifSub?.unsubscribe();
  }

  // ✅ Navigation helpers
  goToOrders() {
    this.router.navigate(['/orders']);
  }

  goToFavorites() {
    this.router.navigate(['/favorites']);
  }

  goToAddresses() {
    this.router.navigate(['/addresses']);
  }

  goToRegisterStation() {
    this.router.navigate(['/register-station']);
  }

  // ✅ Open modal to edit personal info
  async openPersonalInfoModal(field: 'gender' | 'dob') {
    const modal = await this.modalCtrl.create({
      component: EditPersonalInfoModal,
      componentProps: { field, value: this[field] ?? '' },
    });

    await modal.present();
    const { data } = await modal.onDidDismiss();

    if (data) {
      await this.userService.updatePersonalInfo({ [field]: data });
    }
  }
}
