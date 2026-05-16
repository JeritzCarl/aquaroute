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
import { authState } from '@angular/fire/auth';
import { docData } from '@angular/fire/firestore';
import { switchMap, map } from 'rxjs/operators';
import { of } from 'rxjs';

type Role = 'admin' | 'manager' | 'courier' | 'user';

interface AppUser {
  uid: string;
  email?: string | null;
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
  private lastRoutedUid: string | null = null;
  private initializing = true;

  constructor(
    private auth: Auth,
    private db: Firestore,
    private router: Router,
    private zone: NgZone
  ) {
    
setPersistence(this.auth, browserLocalPersistence).catch(console.error);

// ──────────────────────────────────────────────
// ✅ Final Auth Listener (stable for all roles)
// ──────────────────────────────────────────────
onAuthStateChanged(this.auth, async (fbUser) => {
  try {
    // Handle redirect results for mobile/social logins
    try {
      await getRedirectResult(this.auth);
    } catch {}

    if (this.initializing) return;

if (!fbUser) {
  this.lastRoutedUid = null;

  const currentUrl = this.router.url;
  const isPublicPage =
    currentUrl === '/login' ||
    currentUrl === '/home' ||
    currentUrl === '/landing-page' ||
    currentUrl === '/auth-options' ||
    currentUrl === '/register' ||
    currentUrl === '/email-login' ||
    currentUrl === '/reset-password' ||
    currentUrl === '/reset-success';

  if (!isPublicPage) {
    this.zone.run(() =>
      this.router.navigateByUrl('/login', { replaceUrl: true })
    );
  }
  return;
}

    // 🔹 Skip duplicate sessions
    if (this.lastRoutedUid === fbUser.uid) return;
    // ✅ Stop re-routing if user is already on a protected page
const currentUrl = this.router.url;
if (
  currentUrl.startsWith('/admin') ||
  currentUrl.startsWith('/manager') ||
  currentUrl.startsWith('/courier')
) {
  console.log('[Auth] Already on protected page — skip re-routing');
  return;
}
    this.lastRoutedUid = fbUser.uid;

    // 🔹 Ensure Firestore doc exists / update
    await this.ensureUserDoc(fbUser);

    // 🔹 Prepare to verify role
    const ref = doc(this.db, `users/${fbUser.uid}`);
    let verifiedRole: string | null = null;

    // 🔁 Try several times to catch Firestore updates
    for (let i = 0; i < 10; i++) {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data() as any;
        if (data.role && data.role !== 'user') {
          verifiedRole = data.role;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 400));
    }

    // ✅ Route correctly (with safe delay + verified fallback)
    if (verifiedRole) {
      sessionStorage.setItem('lastRole', verifiedRole);
      this.zone.run(() =>
        this.routeByRole({ ...fbUser, role: verifiedRole } as any)
      );
    } else {
      console.warn('[Auth] No verified role yet — waiting for Firestore...');
      // ⏳ Wait and re-check Firestore doc before defaulting
      setTimeout(async () => {
        const latestSnap = await getDoc(ref);
        if (latestSnap.exists()) {
          const data = latestSnap.data() as any;
          const finalRole = data.role || 'user';
          sessionStorage.setItem('lastRole', finalRole);
          this.zone.run(() =>
            this.routeByRole({ ...fbUser, role: finalRole } as any)
          );
        } else {
          this.zone.run(() =>
            this.router.navigateByUrl('/login', { replaceUrl: true })
          );
        }
      }, 800); // small wait to avoid instant redirect flicker
    }
  } catch (e) {
    console.error('Auth init error:', e);
    this.zone.run(() =>
      this.router.navigateByUrl('/login', { replaceUrl: true })
    );
  }
});

// ⏳ Release initialization lock
setTimeout(() => (this.initializing = false), 800);
  }

  // ──────────────────────────────────────────────
// 🔹 Step 2C — Reactive user/role streams for AdminGuard
// ──────────────────────────────────────────────
user$ = authState(this.auth);

userRole$ = this.user$.pipe(
  switchMap(user => {
    if (!user) return of(null);
    const ref = doc(this.db, `users/${user.uid}`);
    return docData(ref).pipe(map((data: any) => data?.role ?? null));
  })
);

  private async withPersistence<T>(fn: () => Promise<T>): Promise<T> {
    await setPersistence(this.auth, browserLocalPersistence);
    return fn();
  }

  // ───────────────────────────────────────────────────────────────
  // User doc ensure + role resolve
  // ───────────────────────────────────────────────────────────────
  private async ensureUserDoc(user: User, provider: string = 'email'): Promise<AppUser> {
    const ref = doc(this.db, `users/${user.uid}`);
    const snap = await getDoc(ref);

    const base: Partial<AppUser> = {
      uid: user.uid,
      email: (user.email || '').toLowerCase(),
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
      ...(snap.exists() ? {} : { createdAt: serverTimestamp() }),
    };

    await setDoc(ref, newDoc, { merge: true });
    return newDoc;
  }

  // ───────────────────────────────────────────────────────────────
  // Routing by role
  // ───────────────────────────────────────────────────────────────
private routeByRole(u: AppUser) {
  if (u.active === false) {
    this.router.navigateByUrl('/account-disabled', { replaceUrl: true });
    return;
  }

  switch (u.role) {
    case 'admin':
      this.router.navigateByUrl('/admin', { replaceUrl: true });
      break;
    case 'manager':
      this.router.navigateByUrl('/manager', { replaceUrl: true });
      break;
    case 'courier':
      this.router.navigateByUrl('/courier', { replaceUrl: true });
      break;
    case 'user':
    default:
      this.router.navigateByUrl('/landing-page', { replaceUrl: true });
      break;
  }
}

  // ───────────────────────────────────────────────────────────────
  // Authentication Methods
  // ───────────────────────────────────────────────────────────────
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
        let appUser = await this.ensureUserDoc(res.user, 'google');

        // ⏳ Retry until role appears
        let tries = 0;
        while ((!appUser.role || appUser.role === 'user') && tries < 5) {
          await new Promise((r) => setTimeout(r, 500));
          appUser = await this.ensureUserDoc(res.user, 'google');
          tries++;
        }

// ✅ Final Firestore role verification before routing
const verifiedSnap = await getDoc(doc(this.db, `users/${res.user.uid}`));
if (verifiedSnap.exists()) {
  const verifiedData = verifiedSnap.data() as any;

  if (verifiedData.active === false) {
    await fbSignOut(this.auth);
    throw new Error('Your account has been disabled by the admin.');
  }

  const verifiedRole = verifiedData.role;
  if (verifiedRole && verifiedRole !== appUser.role) {
    appUser.role = verifiedRole;
  }

  if (typeof verifiedData.active !== 'undefined') {
    appUser.active = verifiedData.active;
  }
}

// ✅ Route only when confirmed
this.zone.run(() => this.routeByRole(appUser));
        return res.user;
      }
    } catch (err: any) {
      console.error('[AuthService] Google login error:', err);
      throw new Error('Google Sign-In failed. Please check your Firebase configuration.');
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

  // ───────────────────────────────────────────────────────────────
  // Email/Password Authentication
  // ───────────────────────────────────────────────────────────────
async emailLogin(email: string, password: string) {
  return this.withPersistence(async () => {
    const res = await signInWithEmailAndPassword(this.auth, email, password);

    // Wait until Firestore doc is fully ready with correct role
    let appUser = await this.ensureUserDoc(res.user, 'email');

    // ⏳ Retry until role is not null (max 5 tries)
    let tries = 0;
    while ((!appUser.role || appUser.role === 'user') && tries < 5) {
      await new Promise((r) => setTimeout(r, 500));
      appUser = await this.ensureUserDoc(res.user, 'email');
      tries++;
    }

// ✅ Final Firestore role verification before routing
const verifiedSnap = await getDoc(doc(this.db, `users/${res.user.uid}`));
if (verifiedSnap.exists()) {
  const verifiedData = verifiedSnap.data() as any;

  if (verifiedData.active === false) {
    await fbSignOut(this.auth);
    throw new Error('Your account has been disabled by the admin.');
  }

  const verifiedRole = verifiedData.role;
  if (verifiedRole && verifiedRole !== appUser.role) {
    appUser.role = verifiedRole;
  }

  if (typeof verifiedData.active !== 'undefined') {
    appUser.active = verifiedData.active;
  }
}

// ✅ Route only when confirmed
this.zone.run(() => this.routeByRole(appUser));
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

// ───────────────────────────────────────────────────────────────
// ✅ Full Logout (No Back Navigation, No Flicker)
// ───────────────────────────────────────────────────────────────
async signOut() {
  try {
    // 🔹 Sign out of Firebase first
    await fbSignOut(this.auth);

    // 🔹 Reset cached role + session flags
    this.lastRoutedUid = null;
    sessionStorage.removeItem('lastRole');
    localStorage.clear();

    // 🔹 Hard delay to ensure all listeners release
    await new Promise((r) => setTimeout(r, 200));

    // 🔹 Route safely
    this.zone.run(() => {
      this.router.navigateByUrl('/login', { replaceUrl: true });
    });

    // 🔹 Hard reload to fully kill residual session
    setTimeout(() => {
      window.location.replace('/login');
    }, 300);

    console.log('✅ Fully signed out and redirected to login.');
  } catch (err) {
    console.error('❌ Sign-out failed:', err);
  }
}
}
