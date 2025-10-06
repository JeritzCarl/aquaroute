import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-notifications',
  templateUrl: './notifications.page.html',
  styleUrls: ['./notifications.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule]
})
export class NotificationsPage {
  notifications = [
    { icon: 'alert-circle-outline', color: 'primary', title: 'Your order #1234 is on the way', subtitle: 'Expected delivery: 3:30 PM' },
    { icon: 'checkmark-circle-outline', color: 'success', title: 'Order #1220 delivered', subtitle: 'Delivered at 9:45 AM today' },
    { icon: 'gift-outline', color: 'tertiary', title: 'Promo available at AquaPure Station', subtitle: 'Get ₱20 off your next order' }
  ];
}
