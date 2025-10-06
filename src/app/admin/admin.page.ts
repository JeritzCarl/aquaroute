import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, AlertController } from '@ionic/angular';
import { RouterModule } from '@angular/router';
import { Firestore, collection, collectionData, doc, deleteDoc } from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import * as L from 'leaflet';
import 'leaflet-draw';


@Component({
  selector: 'app-admin',
  templateUrl: './admin.page.html',
  styleUrls: ['./admin.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule],
})
export class AdminPage implements OnInit {
  stations$!: Observable<any[]>;  // ✅ Observable of all stations

  constructor(
    private firestore: Firestore,
    private alertCtrl: AlertController
  ) {}

  ngOnInit() {
    // ✅ Load ALL stations from Firestore
    const stationsRef = collection(this.firestore, 'stations');
    this.stations$ = collectionData(stationsRef, { idField: 'id' });
  }

  // ✅ Delete a station
  async deleteStation(id: string) {
    const alert = await this.alertCtrl.create({
      header: 'Delete Station',
      message: 'Are you sure you want to delete this station?',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: async () => {
            await deleteDoc(doc(this.firestore, 'stations', id));
          },
        },
      ],
    });
    await alert.present();
  }
}
