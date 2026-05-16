import { Injectable } from '@angular/core';
import {
  Auth,
  onAuthStateChanged,
  signOut,
  deleteUser,
} from '@angular/fire/auth';
import {
  Firestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  deleteDoc,
  updateDoc,
} from '@angular/fire/firestore';
import { BehaviorSubject, Observable } from 'rxjs';

export interface AppUser {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  phoneNumber?: string | null;
  photoURL?: string | null;
  role?: 'user' | 'manager'; // 🔑 always up to date now

  // 🔹 Personal info
  address?: string;
  gender?: 'Male' | 'Female' | 'Other';
  dob?: string; // YYYY-MM-DD

  providerData?: any[];
}

@Injectable({
  providedIn: 'root',
})
export class UserService {
  private currentUserSubject = new BehaviorSubject<AppUser | null>(null);

  public currentUser$: Observable<AppUser | null> =
    this.currentUserSubject.asObservable();
  public user$: Observable<AppUser | null> = this.currentUser$; // alias

  constructor(private auth: Auth, private firestore: Firestore) {
    // 🔹 Watch Firebase Auth state
    onAuthStateChanged(this.auth, async (user) => {
      if (user) {
        const baseUser: AppUser = {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          phoneNumber: user.phoneNumber,
          photoURL: user.photoURL,
          providerData: user.providerData,
        };

        const userRef = doc(this.firestore, 'users', user.uid);
        const snap = await getDoc(userRef);

        if (!snap.exists()) {
          // ✅ Create Firestore doc if missing
          await setDoc(userRef, {
            ...baseUser,
            role: 'user', // default role
            createdAt: new Date(),
          });
        }

        // 🔹 Live sync Firestore → app state (includes role)
        onSnapshot(userRef, (docSnap) => {
          if (docSnap.exists()) {
            this.currentUserSubject.next(docSnap.data() as AppUser);
          } else {
            this.currentUserSubject.next(baseUser);
          }
        });
      } else {
        this.currentUserSubject.next(null);
      }
    });
  }

  // 🔹 Get current user instantly from BehaviorSubject
  get currentUser(): AppUser | null {
    return this.currentUserSubject.value;
  }

  // ✅ Get live user directly from Firebase Auth (used in Register Station)
  async getCurrentUser(): Promise<any> {
    return new Promise<any>((resolve, reject) => {
      const unsubscribe = onAuthStateChanged(
        this.auth,
        (user) => {
          unsubscribe();
          if (user) {
            resolve(user);
          } else {
            resolve(null);
          }
        },
        (error) => {
          console.error('❌ Error getting current user:', error);
          reject(error);
        }
      );
    });
  }

  // ✅ Update role safely (user → manager, etc.)
  async updateRole(role: 'user' | 'manager') {
    if (!this.currentUser) return;
    const userRef = doc(this.firestore, 'users', this.currentUser.uid);
    await updateDoc(userRef, { role });
  }

  // ✅ Update general profile info in Firestore
  async updateProfile(data: Partial<AppUser>) {
    if (!this.currentUser) return;
    const userRef = doc(this.firestore, 'users', this.currentUser.uid);
    await setDoc(userRef, { ...this.currentUser, ...data }, { merge: true });
  }

  // ✅ Update personal info (gender, dob, address)
  async updatePersonalInfo(data: {
    gender?: 'Male' | 'Female' | 'Other';
    dob?: string;
    address?: string;
  }) {
    const user = this.auth.currentUser;
    if (!user) return;

    const userRef = doc(this.firestore, `users/${user.uid}`);
    await updateDoc(userRef, data);
  }

  // ✅ Logout
  async signOut(): Promise<void> {
    try {
      await signOut(this.auth);
      this.currentUserSubject.next(null);
    } catch (error) {
      console.error('Error signing out:', error);
      throw error;
    }
  }

  // ✅ Delete account (Firestore + Auth)
  async deleteAccount(): Promise<void> {
    const user = this.auth.currentUser;
    if (user) {
      try {
        if (user.providerData.some((p) => p.providerId === 'google.com')) {
          throw new Error(
            'Google accounts cannot be deleted programmatically. Please manage deletion in Google settings.'
          );
        }

        const userRef = doc(this.firestore, 'users', user.uid);
        await deleteDoc(userRef);

        await deleteUser(user);
        this.currentUserSubject.next(null);
      } catch (error) {
        console.error('Error deleting account:', error);
        throw error;
      }
    }
  }
clearUser() {
  this.currentUserSubject.next(null);
}
}
