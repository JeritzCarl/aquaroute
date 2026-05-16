import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ToastController } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { ThemeService } from '../services/theme.service';
import { NotificationService } from '../services/notification.service';
import { Auth } from '@angular/fire/auth';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.page.html',
  styleUrls: ['./settings.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule],
})
export class SettingsPage {
  darkTheme = false;
  unit = 'kmh';
  pushNotifications = true;

  constructor(
    private themeService: ThemeService,
    private notificationService: NotificationService,
    private toastCtrl: ToastController,
    private auth: Auth
  ) {}

ngOnInit() {
  // ✅ Load saved preferences from localStorage
  const savedTheme = localStorage.getItem('darkTheme');
  const savedNotif = localStorage.getItem('pushNotifications');

  this.darkTheme = savedTheme ? savedTheme === 'true' : this.themeService.isDarkMode();
  this.pushNotifications = savedNotif ? savedNotif === 'true' : this.notificationService.isEnabled();

  // ✅ Apply saved theme by toggling only if different
  const currentTheme = this.themeService.isDarkMode();
  if (this.darkTheme !== currentTheme) {
    this.themeService.toggleTheme();
  }
}

  // 🌙 Toggle theme and persist
  async toggleTheme() {
    this.themeService.toggleTheme();
    this.darkTheme = this.themeService.isDarkMode();

    // ✅ Save to localStorage
    localStorage.setItem('darkTheme', String(this.darkTheme));

    const toast = await this.toastCtrl.create({
      message: this.darkTheme ? 'Dark Mode Enabled 🌙' : 'Light Mode Enabled ☀️',
      duration: 2000,
      position: 'bottom',
    });
    toast.present();
  }

  // 🔔 Toggle notifications and persist
  async toggleNotifications() {
    this.notificationService.setEnabled(this.pushNotifications);

    // ✅ Save to localStorage
    localStorage.setItem('pushNotifications', String(this.pushNotifications));

    const toast = await this.toastCtrl.create({
      message: this.pushNotifications
        ? 'Push Notifications Enabled 🔔'
        : 'Push Notifications Disabled 🔕',
      duration: 2000,
      position: 'bottom',
    });
    toast.present();
  }

  // ✅ Keep: Test notification feature
  async sendTestNotification() {
    const user = this.auth.currentUser;
    if (!user) {
      const toast = await this.toastCtrl.create({
        message: 'You must be logged in to send a test notification.',
        duration: 2000,
        color: 'warning',
        position: 'bottom',
      });
      toast.present();
      return;
    }

    try {
      await this.notificationService.addUserNotification(user.uid, {
        type: 'system',
        message: 'This is a test notification from Settings ⚙️',
        relatedId: 'test',
        read: false,
      });

      const toast = await this.toastCtrl.create({
        message: 'Test notification sent successfully ✅',
        duration: 2000,
        color: 'success',
        position: 'bottom',
      });
      toast.present();
    } catch (err) {
      console.error('⚠️ Failed to send test notification:', err);
      const toast = await this.toastCtrl.create({
        message: 'Failed to send test notification.',
        duration: 2000,
        color: 'danger',
        position: 'bottom',
      });
      toast.present();
    }
  }
}
