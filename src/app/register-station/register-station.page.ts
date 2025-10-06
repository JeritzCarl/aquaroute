import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, AlertController } from '@ionic/angular';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Firestore, collection, addDoc, query, where, getDocs, serverTimestamp } from '@angular/fire/firestore';
import { Router } from '@angular/router';
import { UserService } from '../services/user.service';

@Component({
  selector: 'app-register-station',
  templateUrl: './register-station.page.html',
  styleUrls: ['./register-station.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, ReactiveFormsModule],
})
export class RegisterStationPage {
  stationForm: FormGroup;

  constructor(
    private fb: FormBuilder,
    private firestore: Firestore,
    private alertCtrl: AlertController,
    private router: Router,
    private userService: UserService
  ) {
    this.stationForm = this.fb.group({
      ownerName: ['', Validators.required],
      stationName: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      phone: ['', [Validators.required, Validators.pattern(/^\+63\d{10}$/)]],
      address: ['', Validators.required],
      stationType: ['', Validators.required],
      operatingHours: ['', Validators.required],
      vehicles: [1, [Validators.required, Validators.min(1)]],
      maxGallonsPerTrip: [20, [Validators.required, Validators.min(1)]],
      paymentOptions: [[]],
    });
  }

  isValid(control: string) {
    const ctrl = this.stationForm.get(control);
    return ctrl?.valid && ctrl?.touched;
  }

  isInvalid(control: string) {
    const ctrl = this.stationForm.get(control);
    return ctrl?.invalid && ctrl?.touched;
  }

  async registerStation() {
    if (this.stationForm.invalid) return;

    const user = this.userService.currentUser;
    if (!user) return;

    const stationsRef = collection(this.firestore, 'stations');
    const q = query(stationsRef, where('ownerId', '==', user.uid));
    const existing = await getDocs(q);

    if (!existing.empty) {
      const alert = await this.alertCtrl.create({
        header: 'Already Registered',
        message: 'You already registered a station. Manage it in your Manager Page.',
        buttons: ['OK'],
      });
      await alert.present();
      this.router.navigate(['/manager']);
      return;
    }

    // ✅ Save station
    await addDoc(stationsRef, {
      ...this.stationForm.value,
      ownerId: user.uid,
      createdAt: serverTimestamp(),
    });

    // ✅ Promote user role to manager (cleaner method)
    await this.userService.updateRole('manager');

    // ✅ Success alert & redirect
    const alert = await this.alertCtrl.create({
      header: 'Success',
      message: 'Station registered successfully! You are now a Manager.',
      buttons: [
        {
          text: 'OK',
          handler: () => this.router.navigate(['/manager']),
        },
      ],
    });

    await alert.present();
  }
}
