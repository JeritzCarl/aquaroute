import { Component } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { AuthService } from '../services/auth.service';

@Component({
  standalone: true,
  selector: 'app-pending-approval',
  imports: [IonicModule, CommonModule],
  template: `
    <ion-header class="aqua-header-wrap">
      <ion-toolbar class="aqua-header"><ion-title>Pending Approval</ion-title></ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <h2>Your account is awaiting activation</h2>
      <p>Please contact your station manager/admin.</p>
      <ion-button expand="block" (click)="logout()">Sign out</ion-button>
    </ion-content>
  `
})
export class PendingApprovalPage {
  constructor(private auth: AuthService) {}
  logout() { this.auth.signOut(); }
}
