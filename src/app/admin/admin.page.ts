import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, AlertController, ToastController } from '@ionic/angular';
import { RouterModule, Router } from '@angular/router';
import {
  Firestore,
  collection,
  deleteDoc,
  doc,
  updateDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  getDocs,
  setDoc,
} from '@angular/fire/firestore';
import { AuthService } from '../services/auth.service';

type VerificationStatus = 'pending' | 'approved' | 'disabled' | 'rejected';
type AdminFilter = 'pending' | 'approved' | 'disabled' | 'rejected' | 'couriers' | 'all';
type RecordType = 'station' | 'user' | 'manager' | 'courier';

interface Station {
  id: string;
  stationName?: string;
  ownerName?: string;
  ownerEmail?: string;
  phone?: string;
  alternateContactNumber?: string;
  address?: string;
  barangay?: string;
  city?: string;
  zipCode?: string;
  types?: string[];
  operatingHours?: { open?: string; close?: string };

  businessPermitNumber?: string;
  ownerValidIdType?: string;
  ownerValidIdNumber?: string;
  businessPermitImageUrl?: string;
  validIdImageUrl?: string;

  verificationStatus?: VerificationStatus;
  verified?: boolean;
  ownerId?: string;
  createdAt?: any;
  active?: boolean;

  [key: string]: any;
}

interface PersonRecord {
  id: string;
  displayName?: string;
  email?: string;
  phoneNumber?: string;
  role?: string;
  createdAt?: any;
  updatedAt?: any;
  lastLoginAt?: any;
  active?: boolean;
  photoURL?: string;
  providerData?: any[];
  [key: string]: any;
}

interface CombinedAdminRecord {
  id: string;
  type: RecordType;
  title: string;
  subtitle: string;
  searchBlob: string;
  raw: Station | PersonRecord;
}

@Component({
  selector: 'app-admin',
  templateUrl: './admin.page.html',
  styleUrls: ['./admin.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule, FormsModule],
})
export class AdminPage implements OnInit, OnDestroy {
  stations: Station[] = [];
  users: PersonRecord[] = [];
  managers: PersonRecord[] = [];
  couriers: PersonRecord[] = [];

  filter: AdminFilter = 'all';
  searchTerm = '';

  private unsubscribeStations: (() => void) | null = null;
  private unsubscribeUsers: (() => void) | null = null;
  private unsubscribeManagers: (() => void) | null = null;
  private unsubscribeCouriers: (() => void) | null = null;
  private filterRefreshTimer: any = null;

  constructor(
    private firestore: Firestore,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
    private auth: AuthService,
    private router: Router
  ) {}

async ngOnInit() {
  await this.migrateStationStatuses();
  this.listenStations();
  this.listenPeople();
}

  ngOnDestroy() {
    this.teardownListeners();
  }

  ionViewWillLeave() {
    this.teardownListeners();
  }

  private teardownListeners() {
    if (this.unsubscribeStations) {
      this.unsubscribeStations();
      this.unsubscribeStations = null;
    }

    if (this.unsubscribeUsers) {
      this.unsubscribeUsers();
      this.unsubscribeUsers = null;
    }

    if (this.unsubscribeManagers) {
      this.unsubscribeManagers();
      this.unsubscribeManagers = null;
    }

    if (this.unsubscribeCouriers) {
      this.unsubscribeCouriers();
      this.unsubscribeCouriers = null;
    }

        if (this.filterRefreshTimer) {
      clearTimeout(this.filterRefreshTimer);
      this.filterRefreshTimer = null;
    }
  }

  private normalizeVerificationStatus(data: any): VerificationStatus {
    if (
      data?.verificationStatus === 'pending' ||
      data?.verificationStatus === 'approved' ||
      data?.verificationStatus === 'disabled' ||
      data?.verificationStatus === 'rejected'
    ) {
      return data.verificationStatus;
    }

    if (data?.verified === true && data?.active === true) {
      return 'approved';
    }

    if (data?.verified === true && data?.active === false) {
      return 'disabled';
    }

    return 'pending';
  }

  private async migrateStationStatuses(): Promise<void> {
    try {
      const stationsRef = collection(this.firestore, 'stations');
      const snap = await getDocs(stationsRef);

      const updates = snap.docs
        .filter((docSnap) => !(docSnap.data() as any)?.verificationStatus)
        .map(async (docSnap) => {
          const data = docSnap.data() as any;
          const normalizedStatus = this.normalizeVerificationStatus(data);

          await updateDoc(doc(this.firestore, 'stations', docSnap.id), {
            verificationStatus: normalizedStatus,
          });
        });

      await Promise.all(updates);
    } catch (error) {
      console.warn('Failed to migrate station verificationStatus:', error);
    }
  }

  handleFilterChange() {}

  onSearchChange() {}

  private scheduleFilterRefresh() {
    if (this.filterRefreshTimer) {
      clearTimeout(this.filterRefreshTimer);
    }

    this.filterRefreshTimer = setTimeout(() => {
      this.filterRefreshTimer = null;
    }, 0);
  }

  listenStations() {
    if (this.unsubscribeStations) {
      this.unsubscribeStations();
      this.unsubscribeStations = null;
    }

    const stationsRef = collection(this.firestore, 'stations');
    const q = query(stationsRef, orderBy('createdAt', 'desc'));

    this.unsubscribeStations = onSnapshot(q, (snapshot) => {
      this.stations = snapshot.docs.map((docSnap) => {
        const data = docSnap.data() as any;
        const normalizedStatus = this.normalizeVerificationStatus(data);

        return {
          id: docSnap.id,
          stationName: data.stationName || 'N/A',
          ownerName: data.ownerName || 'N/A',
          ownerEmail: data.ownerEmail || 'N/A',
          phone: data.phone || 'N/A',
          alternateContactNumber: data.alternateContactNumber || 'N/A',
          address: data.address || 'N/A',
          barangay: data.barangay || 'N/A',
          city: data.city || 'N/A',
          zipCode: data.zipCode || 'N/A',
          types: data.types || [],
          operatingHours: data.operatingHours || {},

          businessPermitNumber: data.businessPermitNumber || 'N/A',
          ownerValidIdType: data.ownerValidIdType || 'N/A',
          ownerValidIdNumber: data.ownerValidIdNumber || 'N/A',
          businessPermitImageUrl: data.businessPermitImageUrl || '',
          validIdImageUrl: data.validIdImageUrl || '',

          verificationStatus: normalizedStatus,
          verified: data.verified ?? false,
          ownerId: data.ownerId || null,
          active: data.active ?? false,
          createdAt: data.createdAt || null,
        };
      });
      this.scheduleFilterRefresh();
    });
  }

  listenPeople() {
    const usersRef = collection(this.firestore, 'users');

    if (this.unsubscribeUsers) {
      this.unsubscribeUsers();
      this.unsubscribeUsers = null;
    }

    if (this.unsubscribeManagers) {
      this.unsubscribeManagers();
      this.unsubscribeManagers = null;
    }

    if (this.unsubscribeCouriers) {
      this.unsubscribeCouriers();
      this.unsubscribeCouriers = null;
    }

    this.unsubscribeUsers = onSnapshot(
      query(usersRef, where('role', '==', 'user')),
      (snap) => {
        this.users = snap.docs.map((d) => this.mapPersonRecord(d.id, d.data(), 'user'));
        this.scheduleFilterRefresh();
      }
    );

    this.unsubscribeManagers = onSnapshot(
      query(usersRef, where('role', '==', 'manager')),
      (snap) => {
        this.managers = snap.docs.map((d) => this.mapPersonRecord(d.id, d.data(), 'manager'));
        this.scheduleFilterRefresh();
      }
    );

    this.unsubscribeCouriers = onSnapshot(
      query(usersRef, where('role', '==', 'courier')),
      (snap) => {
        this.couriers = snap.docs.map((d) => this.mapPersonRecord(d.id, d.data(), 'courier'));
        this.scheduleFilterRefresh();
      }
    );
  }

  private mapPersonRecord(id: string, data: any, fallbackRole: string): PersonRecord {
    return {
      id,
      ...data,
      displayName: data?.displayName || 'Unnamed',
      email: data?.email || 'No email',
      phoneNumber: data?.phoneNumber || 'N/A',
      role: data?.role || fallbackRole,
      createdAt: data?.createdAt || null,
      updatedAt: data?.updatedAt || null,
      lastLoginAt: data?.lastLoginAt || null,
      active: data?.active ?? true,
      photoURL: data?.photoURL || '',
      providerData: data?.providerData || [],
    };
  }

    get displayedStations(): Station[] {
    let list = [...this.stations];

    if (this.filter === 'pending') {
      list = list.filter((s) => (s.verificationStatus || 'pending') === 'pending');
    } else if (this.filter === 'approved') {
      list = list.filter((s) => s.verificationStatus === 'approved');
    } else if (this.filter === 'disabled') {
      list = list.filter((s) => s.verificationStatus === 'disabled');
    } else if (this.filter === 'rejected') {
      list = list.filter((s) => s.verificationStatus === 'rejected');
    } else {
      return [];
    }

    const term = this.searchTerm.trim().toLowerCase();

    return list
      .filter((s) => this.buildStationSearchBlob(s).includes(term))
      .sort((a, b) =>
        String(a.stationName || '').localeCompare(String(b.stationName || ''), undefined, {
          sensitivity: 'base',
        })
      );
  }

  get displayedAllRecords(): CombinedAdminRecord[] {
    if (this.filter !== 'all') return [];

    const term = this.searchTerm.trim().toLowerCase();

    const typeOrder: Record<RecordType, number> = {
      station: 1,
      manager: 2,
      courier: 3,
      user: 4,
    };

    return this.buildCombinedRecords()
      .filter((record) => record.searchBlob.includes(term))
      .sort((a, b) => {
        if (typeOrder[a.type] !== typeOrder[b.type]) {
          return typeOrder[a.type] - typeOrder[b.type];
        }

        return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
      });
  }

  private buildCombinedRecords(): CombinedAdminRecord[] {
    const stationRecords: CombinedAdminRecord[] = this.stations.map((station) => ({
      id: station.id,
      type: 'station',
      title: station.stationName || 'Unnamed Station',
      subtitle: station.ownerEmail || station.ownerName || 'No owner info',
      searchBlob: this.buildStationSearchBlob(station),
      raw: station,
    }));

    const managerRecords: CombinedAdminRecord[] = this.managers.map((manager) => ({
      id: manager.id,
      type: 'manager',
      title: manager.displayName || 'Unnamed Manager',
      subtitle: manager.email || 'No email',
      searchBlob: this.buildPersonSearchBlob(manager),
      raw: manager,
    }));

    const courierRecords: CombinedAdminRecord[] = this.couriers.map((courier) => ({
      id: courier.id,
      type: 'courier',
      title: courier.displayName || 'Unnamed Courier',
      subtitle: courier.email || 'No email',
      searchBlob: this.buildPersonSearchBlob(courier),
      raw: courier,
    }));

    const userRecords: CombinedAdminRecord[] = this.users.map((user) => ({
      id: user.id,
      type: 'user',
      title: user.displayName || 'Unnamed User',
      subtitle: user.email || 'No email',
      searchBlob: this.buildPersonSearchBlob(user),
      raw: user,
    }));

    return [...stationRecords, ...managerRecords, ...courierRecords, ...userRecords];
  }

  private buildStationSearchBlob(station: Station): string {
    return [
      station.stationName,
      station.ownerName,
      station.ownerEmail,
      station.phone,
      station.alternateContactNumber,
      station.address,
      station.barangay,
      station.city,
      station.zipCode,
      station.businessPermitNumber,
      station.ownerValidIdType,
      station.ownerValidIdNumber,
      station.verificationStatus,
    ]
      .map((value) => String(value ?? '').toLowerCase())
      .join(' ');
  }

  private buildPersonSearchBlob(person: PersonRecord): string {
    return [
      person.displayName,
      person.email,
      person.phoneNumber,
      person.role,
      person.id,
      person.active === false ? 'disabled' : 'active',
      this.formatDate(person.createdAt),
      this.formatDate(person.updatedAt),
      this.formatDate(person.lastLoginAt),
    ]
      .map((value) => String(value ?? '').toLowerCase())
      .join(' ');
  }

  getRecordTypeColor(type: RecordType): string {
    switch (type) {
      case 'station':
        return 'primary';
      case 'manager':
        return 'success';
      case 'courier':
        return 'warning';
      case 'user':
      default:
        return 'medium';
    }
  }

  getRecordTypeLabel(type: RecordType): string {
    switch (type) {
      case 'station':
        return 'Station';
      case 'manager':
        return 'Manager';
      case 'courier':
        return 'Courier';
      case 'user':
      default:
        return 'User';
    }
  }

async approveStation(station: Station) {
  if (station.verificationStatus !== 'pending') {
    await this.showToast('Only pending stations can be approved.', 'warning');
    return;
  }

  const alert = await this.alertCtrl.create({
    header: 'Approve Station',
    message: `Approve "${station.stationName}"?`,
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Approve',
        role: 'confirm',
        handler: async () => {
          try {
            const ref = doc(this.firestore, 'stations', station.id);
            await updateDoc(ref, {
              verificationStatus: 'approved',
              verified: true,
              active: true,
            });

            if (station.ownerId) {
              const userRef = doc(this.firestore, `users/${station.ownerId}`);
              await setDoc(userRef, { role: 'manager', updatedAt: new Date() }, { merge: true });
            }

            await this.showToast(`${station.stationName} approved ✅`, 'success');
          } catch {
            await this.showToast('Error approving station ❌', 'danger');
          }
        }
      }
    ]
  });

  await alert.present();
}

async rejectStation(station: Station) {
  if (station.verificationStatus !== 'pending') {
    await this.showToast('Only pending stations can be rejected.', 'warning');
    return;
  }

  const alert = await this.alertCtrl.create({
    header: 'Reject Station',
    message: `Reject "${station.stationName}"?`,
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Reject',
        role: 'destructive',
        handler: async () => {
          try {
            const ref = doc(this.firestore, 'stations', station.id);
            await updateDoc(ref, {
              verificationStatus: 'rejected',
              verified: false,
              active: false,
            });

            await this.showToast(`${station.stationName} rejected ❌`, 'danger');
          } catch {
            await this.showToast('Failed to reject station ❌', 'danger');
          }
        }
      }
    ]
  });

  await alert.present();
}

async disableStation(station: Station) {
  if (station.verificationStatus !== 'approved') {
    await this.showToast('Only approved stations can be disabled.', 'warning');
    return;
  }

  const alert = await this.alertCtrl.create({
    header: 'Disable Station',
    message: `Disable "${station.stationName}"?`,
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Disable',
        role: 'destructive',
        handler: async () => {
          try {
            const ref = doc(this.firestore, 'stations', station.id);
            await updateDoc(ref, {
              verificationStatus: 'disabled',
              verified: true,
              active: false,
            });

            await this.showToast(`${station.stationName} disabled 🚫`, 'warning');
          } catch {
            await this.showToast('Failed to disable station ❌', 'danger');
          }
        }
      }
    ]
  });

  await alert.present();
}

async enableStation(station: Station) {
  if (station.verificationStatus !== 'disabled') {
    await this.showToast('Only disabled stations can be re-enabled.', 'warning');
    return;
  }

  const alert = await this.alertCtrl.create({
    header: 'Re-enable Station',
    message: `Re-enable "${station.stationName}"?`,
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Re-enable',
        role: 'confirm',
        handler: async () => {
          try {
            const ref = doc(this.firestore, 'stations', station.id);
            await updateDoc(ref, {
              verificationStatus: 'approved',
              verified: true,
              active: true,
            });

            await this.showToast(`${station.stationName} enabled ✅`, 'success');
          } catch {
            await this.showToast('Failed to enable station ❌', 'danger');
          }
        }
      }
    ]
  });

  await alert.present();
}

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
            try {
              await deleteDoc(doc(this.firestore, 'stations', id));
              await this.showToast('Station deleted ✅', 'success');
            } catch (error) {
              console.error('Delete station error:', error);
              await this.showToast('Failed to delete station ❌', 'danger');
            }
          },
        },
      ],
    });

    await alert.present();
  }

async disablePerson(person: PersonRecord) {
  if (person.active === false) {
    await this.showToast(`${person.displayName} is already disabled.`, 'warning');
    return;
  }

  const alert = await this.alertCtrl.create({
    header: 'Disable Account',
    message: `Disable ${person.displayName}?`,
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Disable',
        role: 'destructive',
        handler: async () => {
          try {
            const ref = doc(this.firestore, 'users', person.id);
            await updateDoc(ref, { active: false, updatedAt: new Date() });
            await this.showToast(`${person.displayName} disabled 🚫`, 'warning');
          } catch {
            await this.showToast('Failed to disable account ❌', 'danger');
          }
        }
      }
    ]
  });

  await alert.present();
}

async enablePerson(person: PersonRecord) {
  if (person.active !== false) {
    await this.showToast(`${person.displayName} is already active.`, 'warning');
    return;
  }

  const alert = await this.alertCtrl.create({
    header: 'Re-enable Account',
    message: `Re-enable ${person.displayName}?`,
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Re-enable',
        handler: async () => {
          try {
            const ref = doc(this.firestore, 'users', person.id);
            await updateDoc(ref, { active: true, updatedAt: new Date() });
            await this.showToast(`${person.displayName} re-enabled ✅`, 'success');
          } catch {
            await this.showToast('Failed to re-enable account ❌', 'danger');
          }
        }
      }
    ]
  });

  await alert.present();
}

  async deletePerson(person: PersonRecord) {
    const alert = await this.alertCtrl.create({
      header: 'Delete Account',
      message: `Are you sure you want to delete ${person.displayName || 'this account'}?`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: async () => {
            try {
              await deleteDoc(doc(this.firestore, 'users', person.id));
              await this.showToast('Account deleted ✅', 'success');
            } catch (error) {
              console.error('Delete person error:', error);
              await this.showToast('Failed to delete account ❌', 'danger');
            }
          },
        },
      ],
    });

    await alert.present();
  }

  formatDate(value: any): string {
    if (!value) return 'N/A';

    try {
      if (typeof value?.toDate === 'function') {
        return value.toDate().toLocaleString();
      }

      if (value instanceof Date) {
        return value.toLocaleString();
      }

      const parsed = new Date(value);
      if (!isNaN(parsed.getTime())) {
        return parsed.toLocaleString();
      }

      return 'N/A';
    } catch {
      return 'N/A';
    }
  }

  getStatusColor(status?: string): string {
    switch (status) {
      case 'approved':
        return 'success';
      case 'disabled':
        return 'medium';
      case 'rejected':
        return 'danger';
      case 'pending':
      default:
        return 'warning';
    }
  }

  private async showToast(msg: string, color: string) {
    const toast = await this.toastCtrl.create({
      message: msg,
      duration: 1800,
      color,
    });
    await toast.present();
  }

  goToLogs() {
    this.router.navigate(['/admin-logs']);
  }

  async confirmLogout() {
    const alert = await this.alertCtrl.create({
      header: 'Confirm Logout',
      message: 'Are you sure you want to log out?',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Logout',
          handler: async () => {
            try {
              await this.auth.signOut();
              this.router.navigate(['/landing-page']);
            } catch (err) {
              console.error('Logout failed:', err);
            }
          },
        },
      ],
    });

    await alert.present();
  }

  openNotifications() {
    this.router.navigate(['/admin-notifications']).catch(() => {});
  }
}