import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, AlertController } from '@ionic/angular';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  Firestore,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
  doc,
  setDoc
} from '@angular/fire/firestore';
import { Router } from '@angular/router';
import { UserService } from '../services/user.service';
import { geocodeTuguegarao } from '../utils/geocode.util';

@Component({
  selector: 'app-register-station',
  templateUrl: './register-station.page.html',
  styleUrls: ['./register-station.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, ReactiveFormsModule],
})
export class RegisterStationPage implements OnInit {
  businessPermitFile: File | null = null;
validIdFile: File | null = null;

businessPermitUrl: string | null = null;
validIdUrl: string | null = null;

CLOUD_NAME = 'ddmbxblmz';
UPLOAD_PRESET = 'aquaroute_unsigned';

  stationForm: FormGroup;
  openTimes: string[] = [];
  closeTimes: string[] = [];
  submitting = false;
  waitingForVerification = false;

  applicationStatus: 'pending' | 'approved' | 'disabled' | 'rejected' | null = null;
  statusMessage: string = '';

  barangays: string[] = [
    'Annafunan East', 'Annafunan West', 'Atulayan North', 'Atulayan Sur',
    'Bagay', 'Balzain East', 'Balzain West', 'Buntun', 'Caggay', 'Capatan',
    'Caritan Centro', 'Caritan Norte', 'Caritan Sur',
    'Cataggaman Nuevo', 'Cataggaman Pardo', 'Cataggaman Viejo',
    'Centro 1', 'Centro 2', 'Centro 3', 'Centro 4', 'Centro 5', 'Centro 6', 'Centro 7', 'Centro 8', 'Centro 9', 'Centro 10',
    'Gosi Norte', 'Gosi Sur', 'Larion Alto', 'Larion Bajo',
    'Leonarda', 'Libag Norte', 'Libag Sur', 'Linao East', 'Linao West',
    'Namabbalan Norte', 'Namabbalan Sur', 'Pallua Norte', 'Pallua Sur',
    'Pengue-Ruyu', 'San Gabriel', 'Tagga', 'Tanza', 'Ugac Norte', 'Ugac Sur'
  ];

  validIdTypes: string[] = [
    'National ID',
    `Driver's License`,
    'Passport',
    'UMID',
    `Voter's ID`,
    'PhilHealth ID',
    'Postal ID',
    'PRC ID',
  ];

  constructor(
    private fb: FormBuilder,
    private firestore: Firestore,
    private alertCtrl: AlertController,
    private router: Router,
    private userService: UserService
  ) {
    this.stationForm = this.fb.group({
      ownerName: [{ value: '', disabled: true }, Validators.required],
      email: [{ value: '', disabled: true }, [Validators.required, Validators.email]],

      stationName: ['', [Validators.required, Validators.minLength(3)]],

      phone: ['', [
        Validators.required,
        Validators.pattern(/^09\d{9}$/)
      ]],

      alternateContactNumber: ['', [
        Validators.pattern(/^$|^09\d{9}$/)
      ]],

      address: ['', [Validators.required, Validators.minLength(5)]],
      barangay: ['', Validators.required],
      city: [{ value: 'Tuguegarao City', disabled: true }, Validators.required],
      zipCode: [{ value: '3500', disabled: true }, Validators.required],

      stationType: [[], Validators.required],

      openTime: ['', Validators.required],
      closeTime: ['', Validators.required],

      businessPermitNumber: ['', [Validators.required, Validators.minLength(6)]],
      ownerValidIdType: ['', Validators.required],
      ownerValidIdNumber: ['', [Validators.required, Validators.minLength(6)]],
    });
  }

  async ngOnInit() {
    this.openTimes = this.generateTimes(5, 11);
    this.closeTimes = this.generateTimes(12, 19);

    await this.prefillOwnerInfo();
    await this.checkExistingStation();

    this.userService.currentUser$.subscribe(async (user) => {
      if (user) {
        this.stationForm.patchValue({
          ownerName: user.displayName || 'Unknown User',
          email: user.email || 'No email found',
        });
      } else {
        const authUser = await this.userService.getCurrentUser();
        if (authUser) {
          this.stationForm.patchValue({
            ownerName: authUser.displayName || 'Unknown User',
            email: authUser.email || 'No email found',
          });
        }
      }
    });
  }

  private async prefillOwnerInfo() {
    const cachedUser = this.userService.currentUser;
    if (cachedUser) {
      this.stationForm.patchValue({
        ownerName: cachedUser.displayName || 'Unknown User',
        email: cachedUser.email || 'No email found',
      });
    } else {
      const authUser = await this.userService.getCurrentUser();
      if (authUser) {
        this.stationForm.patchValue({
          ownerName: authUser.displayName || 'Unknown User',
          email: authUser.email || 'No email found',
        });
      }
    }
  }

  generateTimes(startHour: number, endHour: number): string[] {
    const times: string[] = [];

    for (let h = startHour; h <= endHour; h++) {
      for (let m = 0; m < 60; m += 15) {
        const period = h < 12 ? 'AM' : 'PM';
        const hour = h % 12 === 0 ? 12 : h % 12;
        const hh = hour.toString().padStart(2, '0');
        const mm = m.toString().padStart(2, '0');
        times.push(`${hh}:${mm} ${period}`);
      }
    }

    return times;
  }

  onBusinessPermitSelected(event: any) {
  this.businessPermitFile = event.target.files[0];
}

onValidIdSelected(event: any) {
  this.validIdFile = event.target.files[0];
}

async uploadToCloudinary(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', this.UPLOAD_PRESET);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${this.CLOUD_NAME}/image/upload`,
    {
      method: 'POST',
      body: formData,
    }
  );

  const data = await res.json();
  return data.secure_url;
}

  onAddressInput() {
    const address = (this.stationForm.get('address')?.value || '').toLowerCase();
    for (const b of this.barangays) {
      if (address.includes(b.toLowerCase())) {
        this.stationForm.patchValue({ barangay: b }, { emitEvent: false });
        break;
      }
    }
  }

formatPhone() {
  const control = this.stationForm.get('phone');
  if (!control) return;

  let val = (control.value || '').replace(/\D/g, ''); // numbers only

  // Force start with 09
  if (val.startsWith('9')) {
    val = '0' + val;
  }

  if (!val.startsWith('09')) {
    val = '09';
  }

  // Limit to 11 digits
  val = val.substring(0, 11);

  control.setValue(val, { emitEvent: false });
  control.updateValueAndValidity();
}

formatAlternatePhone() {
  const control = this.stationForm.get('alternateContactNumber');
  if (!control) return;

  let val = (control.value || '').replace(/\D/g, '');

  if (!val) {
    control.setValue('', { emitEvent: false });
    return;
  }

  if (val.startsWith('9')) {
    val = '0' + val;
  }

  if (!val.startsWith('09')) {
    val = '09';
  }

  val = val.substring(0, 11);

  control.setValue(val, { emitEvent: false });
  control.updateValueAndValidity();
}

  private async checkExistingStation() {
    const user = this.userService.currentUser || (await this.userService.getCurrentUser());
    if (!user) return;

    const stationsRef = collection(this.firestore, 'stations');
    const q = query(stationsRef, where('ownerId', '==', user.uid));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      this.waitingForVerification = false;
      this.applicationStatus = null;
      this.statusMessage = '';

      this.stationForm.enable();
      this.stationForm.get('ownerName')?.disable();
      this.stationForm.get('email')?.disable();
      this.stationForm.get('city')?.disable();
      this.stationForm.get('zipCode')?.disable();
      return;
    }

    const station = snapshot.docs[0].data() as any;

    const verificationStatus =
      station.verificationStatus ||
      (station.verified
        ? (station.active === false ? 'disabled' : 'approved')
        : 'pending');

    this.applicationStatus = verificationStatus;

    switch (verificationStatus) {
      case 'approved':
        this.waitingForVerification = false;
        this.statusMessage = 'Your station has already been approved. Redirecting to Manager Page...';
        this.router.navigate(['/manager']);
        break;

      case 'disabled':
        this.waitingForVerification = false;
        this.statusMessage = 'Your station has been disabled by the admin. Please contact the administrator for assistance.';
        this.stationForm.disable();
        break;

      case 'rejected':
        this.waitingForVerification = false;
        this.statusMessage = 'Your station registration was rejected. Please contact the administrator or submit a new application if allowed.';
        this.stationForm.disable();
        break;

      case 'pending':
      default:
        this.waitingForVerification = true;
        this.statusMessage = 'Your station registration is pending admin review.';
        this.stationForm.disable();
        break;
    }

    this.stationForm.get('ownerName')?.disable();
    this.stationForm.get('email')?.disable();
    this.stationForm.get('city')?.disable();
    this.stationForm.get('zipCode')?.disable();
  }

  get submitDisabled(): boolean {
    return this.stationForm.invalid || this.submitting || this.isApplicationLocked;
  }

  async registerStation() {
    this.stationForm.markAllAsTouched();
    this.stationForm.updateValueAndValidity();

    if (this.submitDisabled) {
      const alert = await this.alertCtrl.create({
        header: 'Incomplete Form',
        message: 'Please complete all required fields correctly before submitting.',
        buttons: ['OK'],
      });
      await alert.present();
      return;
    }

    const user = this.userService.currentUser || (await this.userService.getCurrentUser());
    if (!user) return;

    this.submitting = true;

    try {
      const stationsRef = collection(this.firestore, 'stations');
      const q = query(stationsRef, where('ownerId', '==', user.uid));
      const existing = await getDocs(q);

      if (!existing.empty) {
        await this.checkExistingStation();

        const alert = await this.alertCtrl.create({
          header: 'Station Already Registered',
          message: this.statusMessage || 'You already have a station application in the system.',
          buttons: ['OK'],
        });

        await alert.present();

        if (this.applicationStatus === 'approved') {
          this.router.navigate(['/manager']);
        }

        this.submitting = false;
        return;
      }

      if (!this.businessPermitFile || !this.validIdFile) {
  const alert = await this.alertCtrl.create({
    header: 'Missing Documents',
    message: 'Please upload both Business Permit and Valid ID.',
    buttons: ['OK'],
  });
  await alert.present();
  this.submitting = false;
  return;
}

      const formData = this.stationForm.getRawValue();

      const open = new Date(`1970/01/01 ${formData.openTime}`);
      const close = new Date(`1970/01/01 ${formData.closeTime}`);

      if (open >= close) {
        const alert = await this.alertCtrl.create({
          header: 'Invalid Operating Hours',
          message: 'Closing time must be later than opening time.',
          buttons: ['OK'],
        });
        await alert.present();
        this.submitting = false;
        return;
      }

      this.businessPermitUrl = await this.uploadToCloudinary(this.businessPermitFile);
      this.validIdUrl = await this.uploadToCloudinary(this.validIdFile);

      const geo = await geocodeTuguegarao(formData.address);
      const newStationRef = doc(stationsRef);

      const data = {
        ownerId: user.uid,
        ownerName: formData.ownerName,
        ownerEmail: formData.email,
        contactEmail: formData.email,

        stationName: formData.stationName,
        phone: formData.phone,
        alternateContactNumber: formData.alternateContactNumber || null,

        address: formData.address,
        barangay: formData.barangay,
        city: formData.city,
        zipCode: formData.zipCode,

        types: formData.stationType,

        operatingHours: {
          open: formData.openTime,
          close: formData.closeTime,
        },

        businessPermitNumber: formData.businessPermitNumber,
        ownerValidIdType: formData.ownerValidIdType,
        ownerValidIdNumber: formData.ownerValidIdNumber,

        businessPermitImageUrl: this.businessPermitUrl,
        validIdImageUrl: this.validIdUrl,

        createdAt: serverTimestamp(),

        verificationStatus: 'pending',
        verified: false,
        active: false,

        id: newStationRef.id,
        availableTypes: {
          Purified: formData.stationType?.includes('Purified') || false,
          Alkaline: formData.stationType?.includes('Alkaline') || false,
          Mineral: formData.stationType?.includes('Mineral') || false,
        },
        lat: geo?.lat || 17.6131,
        lng: geo?.lng || 121.7269,
        status: 'open',
        containers: [],
        waterTypes: formData.stationType,
        minPrice: 0,
      };

      await setDoc(newStationRef, data);

      this.waitingForVerification = true;
      this.applicationStatus = 'pending';
      this.statusMessage = 'Your station registration has been submitted and is pending admin review.';
      this.stationForm.disable();

      const alert = await this.alertCtrl.create({
        header: 'Submitted for Verification',
        message:
          'Your station has been submitted for admin review. Please wait for approval before accessing your Manager Page.',
        buttons: [
          {
            text: 'OK',
            handler: () => this.router.navigate(['/landing-page']),
          },
        ],
      });
      await alert.present();
    } catch (error) {
      const alert = await this.alertCtrl.create({
        header: 'Registration Failed',
        message: 'Something went wrong while submitting your station registration. Please try again.',
        buttons: ['OK'],
      });
      await alert.present();
      console.error('registerStation error:', error);
    } finally {
      this.submitting = false;
    }
  }

  get isApplicationLocked(): boolean {
    return ['pending', 'approved', 'disabled', 'rejected'].includes(this.applicationStatus || '');
  }
}