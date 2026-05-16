import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController, ToastController, AlertController } from '@ionic/angular';
import { Firestore, doc, updateDoc, deleteDoc, collection, setDoc } from '@angular/fire/firestore';

@Component({
  selector: 'app-station-details-modal',
  standalone: true,
  template: `
  <ion-header>
    <ion-toolbar color="primary">
      <ion-title>{{ station?.stationName || 'Station Details' }}</ion-title>
      <ion-buttons slot="end">
        <ion-button (click)="close()">Close</ion-button>
      </ion-buttons>
    </ion-toolbar>
  </ion-header>

  <ion-content class="ion-padding">
    <ion-list>
      <ion-item>
        <ion-label><strong>Owner:</strong> {{ station?.ownerName || 'N/A' }}</ion-label>
      </ion-item>
      <ion-item>
        <ion-label><strong>Email:</strong> {{ station?.email || 'N/A' }}</ion-label>
      </ion-item>
      <ion-item>
        <ion-label><strong>Phone:</strong> {{ station?.phone || 'N/A' }}</ion-label>
      </ion-item>
      <ion-item>
        <ion-label>
          <strong>Status:</strong>
          <ion-badge [color]="station?.verified ? 'success' : 'warning'">
            {{ station?.verified ? 'Verified' : 'Pending' }}
          </ion-badge>
        </ion-label>
      </ion-item>
      <ion-item *ngIf="station?.permitUrl">
        <a [href]="station.permitUrl" target="_blank">View Permit</a>
      </ion-item>
    </ion-list>

    <ion-row class="ion-margin-top">
      <ion-col size="6">
        <ion-button expand="block" color="success" (click)="updateVerification(true)">Verify</ion-button>
      </ion-col>
      <ion-col size="6">
        <ion-button expand="block" color="medium" (click)="updateVerification(false)">Unverify</ion-button>
      </ion-col>
    </ion-row>

    <ion-button color="danger" expand="block" class="ion-margin-top" (click)="deleteStation()">
      Delete Station
    </ion-button>
  </ion-content>
  `,
  imports: [CommonModule, IonicModule],
})

export class StationDetailsModalComponent {
  @Input() station: any;

  constructor(
    private modalCtrl: ModalController,
    private firestore: Firestore,
    private toastCtrl: ToastController,
    private alertCtrl: AlertController
  ) {}

  close() {
    this.modalCtrl.dismiss();
  }

  // ──────────────────────────────────────────────
  // ✅ Update Verification (with admin logging)
  // ──────────────────────────────────────────────
  async updateVerification(verified: boolean) {
    if (!this.station?.id) return;

    // 🔹 Check if permit is missing when verifying
    if (verified && !this.station.permitUrl) {
      const toast = await this.toastCtrl.create({
        message: '⚠️ Cannot verify — permit is missing!',
        duration: 2000,
        color: 'warning',
      });
      await toast.present();
      return;
    }

    try {
      await updateDoc(doc(this.firestore, 'stations', this.station.id), { verified });

      // 🔹 Log admin action
      const adminUid = localStorage.getItem('adminUid') || 'unknown';
      const adminEmail = localStorage.getItem('adminEmail') || 'unknown';
      const logRef = doc(collection(this.firestore, `adminLogs/${adminUid}/actions`));
      await setDoc(logRef, {
        action: verified ? 'Verified Station' : 'Unverified Station',
        stationId: this.station.id,
        stationName: this.station.stationName || 'Unnamed Station',
        timestamp: new Date(),
        adminEmail,
      });

      const toast = await this.toastCtrl.create({
        message: verified ? 'Station verified ✅' : 'Station unverified ⚠️',
        duration: 1800,
        color: verified ? 'success' : 'warning',
      });
      await toast.present();
      this.modalCtrl.dismiss({ refresh: true });
    } catch (err) {
      console.error(err);
    }
  }

  // ──────────────────────────────────────────────
  // ✅ Delete Station (with admin logging)
  // ──────────────────────────────────────────────
  async deleteStation() {
    const alert = await this.alertCtrl.create({
      header: 'Delete Station',
      message: 'Are you sure you want to delete this station?',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: async () => {
            try {
              await deleteDoc(doc(this.firestore, 'stations', this.station.id));

              // 🔹 Log delete action
              const adminUid = localStorage.getItem('adminUid') || 'unknown';
              const adminEmail = localStorage.getItem('adminEmail') || 'unknown';
              const logRef = doc(collection(this.firestore, `adminLogs/${adminUid}/actions`));
              await setDoc(logRef, {
                action: 'Deleted Station',
                stationId: this.station.id,
                stationName: this.station.stationName || 'Unnamed Station',
                timestamp: new Date(),
                adminEmail,
              });

              const toast = await this.toastCtrl.create({
                message: 'Station deleted ✅',
                duration: 1800,
                color: 'success',
              });
              await toast.present();
              this.modalCtrl.dismiss({ refresh: true });
            } catch (err) {
              console.error(err);
            }
          },
        },
      ],
    });
    await alert.present();
  }
}
