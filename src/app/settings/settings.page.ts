import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ToastController } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { ThemeService } from '../services/theme.service';
import { NotificationService } from '../services/notification.service';

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
    private toastCtrl: ToastController
  ) {}

  ngOnInit() {
    this.darkTheme = this.themeService.isDarkMode();
    this.pushNotifications = this.notificationService.isEnabled();
  }

  async toggleTheme() {
    this.themeService.toggleTheme();
    this.darkTheme = this.themeService.isDarkMode();

    const toast = await this.toastCtrl.create({
      message: this.darkTheme ? 'Dark Mode Enabled 🌙' : 'Light Mode Enabled ☀️',
      duration: 2000,
      position: 'bottom',
    });
    toast.present();
  }

  async toggleNotifications() {
    this.notificationService.setEnabled(this.pushNotifications);

    const toast = await this.toastCtrl.create({
      message: this.pushNotifications
        ? 'Push Notifications Enabled 🔔'
        : 'Push Notifications Disabled 🔕',
      duration: 2000,
      position: 'bottom',
    });
    toast.present();
  }
}
