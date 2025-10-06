import { Component, Input } from '@angular/core';
import { IonicModule, ModalController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { UserService } from '../../services/user.service';

@Component({
  selector: 'app-edit-personal-info-modal',
  standalone: true,
  template: `
    <!-- ✅ Header like Cart/Checkout -->
    <ion-header class="aqua-header-wrap">
      <ion-toolbar class="aqua-header">
        <ion-title class="header-title">
          {{ getHeaderTitle(field) }}
        </ion-title>
        <ion-buttons slot="end">
          <ion-button fill="clear" (click)="dismiss()">
            <ion-icon name="close"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <form (ngSubmit)="save()" class="form-container">

        <!-- Gender -->
        <ion-item *ngIf="field === 'gender'" class="form-item">
          <ion-label position="stacked">Select Gender</ion-label>
          <ion-select [(ngModel)]="value" name="gender" interface="popover">
            <ion-select-option value="Male">Male</ion-select-option>
            <ion-select-option value="Female">Female</ion-select-option>
            <ion-select-option value="Other">Other</ion-select-option>
          </ion-select>
        </ion-item>

        <!-- Date of Birth -->
        <ion-item *ngIf="field === 'dob'" class="form-item">
          <ion-label position="stacked">Date of Birth</ion-label>
          <ion-datetime
            [(ngModel)]="value"
            name="dob"
            presentation="date"
          ></ion-datetime>
        </ion-item>

        <!-- Address -->
        <ion-item *ngIf="field === 'address'" class="form-item">
          <ion-label position="stacked">Address</ion-label>
          <ion-textarea
            [(ngModel)]="value"
            name="address"
            autoGrow="true"
            placeholder="House No., Street, Barangay, City"
          ></ion-textarea>
        </ion-item>

        <!-- Save -->
        <ion-button expand="block" type="submit" color="primary" class="save-btn">
          Save Changes
        </ion-button>
      </form>
    </ion-content>
  `,
  styleUrls: ['./edit-personal-info.modal.scss'],
  imports: [IonicModule, CommonModule, FormsModule],
})
export class EditPersonalInfoModal {
  @Input() field!: 'gender' | 'dob' | 'address';
  @Input() value: any;

  constructor(
    private modalCtrl: ModalController,
    private userService: UserService
  ) {}

  dismiss() {
    this.modalCtrl.dismiss();
  }

  async save() {
    await this.userService.updatePersonalInfo({ [this.field]: this.value });
    this.dismiss();
  }

  // ✅ Custom header text
  getHeaderTitle(field: string): string {
    if (field === 'dob') return 'Date of Birth';
    if (field === 'gender') return 'Gender';
    if (field === 'address') return 'Address';
    return 'Edit Info';
  }
}
