import { Injectable, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import {
  Auth,
  User,
  GoogleAuthProvider,
  FacebookAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  PhoneAuthProvider,
  signInWithCredential,
  browserLocalPersistence,
  setPersistence,
  onAuthStateChanged,
  signOut as fbSignOut,
  signInWithRedirect,
  getRedirectResult,
} from '@angular/fire/auth';
import {
  Firestore,
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
  collectionGroup,
  serverTimestamp,
} from '@angular/fire/firestore';
import { Capacitor } from '@capacitor/core';

type Role = 'admin' | 'manager' | 'courier' | 'user';

interface AppUser {
  uid: string;
  email?: string | null;
  phoneNumber?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
  provider?: string;
  role?: Role;
  active?: boolean;
  createdAt?: any;
  updatedAt?: any;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private verificationId?: string;
  private lastRoutedUid: string | null = null;

  constructor(
    private auth: Auth,
    private db: Firestore,
    private router: Router,
    private zone: NgZone
  ) {
    setPersistence(this.auth, browserLocalPersistence).catch(console.error);

    onAuthStateChanged(this.auth, async (fbUser) => {
      try {
        try { await getRedirectResult(this.auth); } catch {}

        if (!fbUser) {
          if (this.lastRoutedUid !== null) {
            this.lastRoutedUid = null;
            this.zone.run(() =>
              this.router.navigateByUrl('/login', { replaceUrl: true })
            );
          }
          return;
        }

        if (fbUser.uid !== this.lastRoutedUid) {
          const appUser = await this.ensureUserDoc(fbUser);
          this.lastRoutedUid = fbUser.uid;
          this.zone.run(() => this.routeByRole(appUser));
        }
      } catch (e) {
        console.error('Auth init error:', e);
        this.zone.run(() =>
          this.router.navigateByUrl('/landing-page', { replaceUrl: true })
        );
      }
    });
  }

  get currentUser(): User | null {
    return this.auth.currentUser;
  }

  private async withPersistence<T>(fn: () => Promise<T>): Promise<T> {
    await setPersistence(this.auth, browserLocalPersistence);
    return fn();
  }

  // ---------------------------
  // User doc ensure + role resolve
  // ---------------------------
  private async ensureUserDoc(user: User, provider: string = 'email'): Promise<AppUser> {
    const ref = doc(this.db, `users/${user.uid}`);
    const snap = await getDoc(ref);

    const base: Partial<AppUser> = {
      uid: user.uid,
      email: (user.email || '').toLowerCase(),
      phoneNumber: user.phoneNumber || '',
      displayName: user.displayName || '',
      photoURL: user.photoURL || '',
      provider,
      updatedAt: serverTimestamp(),
    };

    let role: Role = snap.exists() ? ((snap.data() as any).role as Role) || 'user' : 'user';

    // Manager check
    const stationsRef = collection(this.db, 'stations');
    let qsStations = await getDocs(query(stationsRef, where('ownerId', '==', user.uid)));
    if (qsStations.empty && user.email) {
      qsStations = await getDocs(query(stationsRef, where('ownerEmail', '==', (user.email as string).toLowerCase())));
    }
    const isManager = !qsStations.empty;

    // Courier check
    const couriersCg = collectionGroup(this.db, 'couriers');
    let qsCourier = await getDocs(query(couriersCg, where('uid', '==', user.uid)));
    if (qsCourier.empty && user.email) {
      qsCourier = await getDocs(query(couriersCg, where('email', '==', (user.email as string).toLowerCase())));
    }
    const isCourier = !qsCourier.empty;

    // Precedence
    if (role === 'admin') {
      // keep admin
    } else if (isManager) {
      role = 'manager';
    } else if (isCourier) {
      role = 'courier';
      const first = qsCourier.docs[0];
      if (first && (first.data() as any)?.uid !== user.uid) {
        await setDoc(first.ref, { uid: user.uid }, { merge: true });
      }
    } else {
      role = 'user';
    }

    const newDoc: AppUser = {
      uid: user.uid,
      role,
      active: (snap.exists() ? (snap.data() as any).active : true) ?? true,
      ...base,
      ...(snap.exists() ? {} : { createdAt: serverTimestamp() })
    };

    await setDoc(ref, newDoc, { merge: true });
    return newDoc;
  }

  // ---------------------------
  // Routing by role
  // ---------------------------
  private routeByRole(u: AppUser) {
    if ((u.role === 'manager' || u.role === 'courier') && u.active === false) {
      this.router.navigateByUrl('/pending-approval', { replaceUrl: true });
      return;
    }

    switch (u.role) {
      case 'admin':
        this.router.navigateByUrl('/admin-dashboard', { replaceUrl: true });
        break;
      case 'manager':
        this.router.navigateByUrl('/manager', { replaceUrl: true });
        break;
      case 'courier':
        this.router.navigateByUrl('/courier', { replaceUrl: true });
        break;
      default:
        // ✅ All normal users go to landing-page
        this.router.navigateByUrl('/landing-page', { replaceUrl: true });
        break;
    }
  }

  // ---------------------------
  // Provider & email/phone auth
  // ---------------------------
  async loginWithGoogle() {
    return this.withPersistence(async () => {
      const provider = new GoogleAuthProvider();
      (provider as any).setCustomParameters({ prompt: 'select_account' });

      const platform = Capacitor.getPlatform();
      try {
        if (platform === 'android' || platform === 'ios') {
          await signInWithRedirect(this.auth, provider);
          return;
        } else {
          const res = await signInWithPopup(this.auth, provider);
          await this.ensureUserDoc(res.user, 'google');
          return res.user;
        }
      } catch (err: any) {
        const code = String(err?.code || '');
        const isWeb = platform === 'web';
        const msg = isWeb
          ? 'Google Sign-In failed on web. Ensure Google provider is enabled and "localhost" is in Authorized domains.'
          : (code.includes('failed-precondition')
             ? 'Google Sign-In failed-precondition on device. Add SHA-1/SHA-256 to Firebase Android app and update android/app/google-services.json; also allow ionic://localhost in Auth settings.'
             : 'Google Sign-In failed on device.');
        console.error('[AuthService] Google login error:', err);
        throw new Error(msg);
      }
    });
  }

  async loginWithFacebook() {
    return this.withPersistence(async () => {
      const provider = new FacebookAuthProvider();
      provider.addScope('email');
      const res = await signInWithPopup(this.auth, provider);
      await this.ensureUserDoc(res.user, 'facebook');
      return res.user;
    });
  }

  async emailLogin(email: string, password: string) {
    return this.withPersistence(async () => {
      const res = await signInWithEmailAndPassword(this.auth, email, password);
      await this.ensureUserDoc(res.user, 'email');
      return res.user;
    });
  }

  async emailRegister(name: string, email: string, password: string) {
    return this.withPersistence(async () => {
      const res = await createUserWithEmailAndPassword(this.auth, email, password);
      if (name) await updateProfile(res.user, { displayName: name });
      await this.ensureUserDoc(res.user, 'email');
      return res.user;
    });
  }

  async sendPhoneOTP(rawPhone: string, recaptchaId: string) {
    return this.withPersistence(async () => {
      const recaptcha = new RecaptchaVerifier(this.auth, recaptchaId, { size: 'invisible' });
      const phone = this.toE164(rawPhone);
      const result = await signInWithPhoneNumber(this.auth, phone, recaptcha);
      this.verificationId = result.verificationId;
      return true;
    });
  }

  async verifyPhoneOTP(code: string) {
    if (!this.verificationId) throw new Error('Missing verificationId');
    const credential = PhoneAuthProvider.credential(this.verificationId, code);
    const res = await signInWithCredential(this.auth, credential);
    await this.ensureUserDoc(res.user, 'phone');
    this.verificationId = undefined;
    return res.user;
  }

  async signOut() {
    await fbSignOut(this.auth);
    this.lastRoutedUid = null;
    this.router.navigateByUrl('/login', { replaceUrl: true });
  }

  private toE164(input: string) {
    const cleaned = (input || '').replace(/\D/g, '');
    if (cleaned.startsWith('63')) return `+${cleaned}`;
    if (cleaned.startsWith('0')) return `+63${cleaned.substring(1)}`;
    if (cleaned.startsWith('9')) return `+63${cleaned}`;
    return `+63${cleaned}`;
  }
}
