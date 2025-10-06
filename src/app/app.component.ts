import { Component } from '@angular/core';
import { Platform } from '@ionic/angular';
import { Capacitor } from '@capacitor/core';
import { Keyboard, KeyboardResize, KeyboardStyle } from '@capacitor/keyboard';
import { StatusBar, Style as StatusBarStyle } from '@capacitor/status-bar';
import { NotificationService } from './services/notification.service';

import { Router } from '@angular/router';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent {
  constructor(
    private platform: Platform,
    private notify: NotificationService,
    private router: Router,
    private auth: Auth,
    private db: Firestore
  ) {
    this.platform.ready().then(() => {
      this.configureNativeUI();
      this.initPushNotifications();
      this.handleAuthRouting(); // ✅ role-aware navigation
    });
  }

  // ──────────────────────────────────────────────
  // Native UI configs (Keyboard + StatusBar)
  // ──────────────────────────────────────────────
  private async configureNativeUI() {
    if (!Capacitor.isNativePlatform()) return;

    try {
      await Keyboard.setResizeMode({ mode: KeyboardResize.Body });
      await Keyboard.setStyle({ style: KeyboardStyle.Light });
      await Keyboard.setAccessoryBarVisible({ isVisible: false });

      await StatusBar.setOverlaysWebView({ overlay: false });
      await StatusBar.setStyle({ style: StatusBarStyle.Light });
    } catch {
      /* noop on web */
    }
  }

  // ──────────────────────────────────────────────
  // Push Notifications
  // ──────────────────────────────────────────────
  private async initPushNotifications() {
    try {
      await this.notify.initPush();
    } catch (err) {
      console.error('⚠️ Failed to initialize push notifications:', err);
    }
  }

  // ──────────────────────────────────────────────
  // Auth Routing (role-aware, no more welcome/location-setup)
  // ──────────────────────────────────────────────
  private handleAuthRouting() {
    onAuthStateChanged(this.auth, async (user) => {
      if (!user) {
        if (!this.router.url.startsWith('/landing')) {
          this.router.navigateByUrl('/landing', { replaceUrl: true });
        }
        return;
      }

      try {
        const ref = doc(this.db, 'users', user.uid);
        const snap = await getDoc(ref);
        const data = snap.data();

        if (!data) return; // no profile, stay put

        const role = data['role'] || 'customer';
        const current = this.router.url;

        // Neutral = landing, home, or root
        const isNeutral = current === '/' || current === '/home' || current.startsWith('/landing');

        // ─────────────── MANAGER ───────────────
        if (role === 'manager') {
          if (isNeutral) {
            this.router.navigateByUrl('/manager', { replaceUrl: true });
          } else {
            console.log('✅ Manager staying on', current);
          }
        }

        // ─────────────── COURIER ───────────────
        else if (role === 'courier') {
          if (isNeutral) {
            this.router.navigateByUrl('/courier', { replaceUrl: true });
          } else {
            console.log('✅ Courier staying on', current);
          }
        }

        // ─────────────── CUSTOMER (default) ───────────────
        else {
          if (isNeutral) {
            this.router.navigateByUrl('/station', { replaceUrl: true });
          } else {
            console.log('✅ Customer staying on', current);
          }
        }
      } catch (err) {
        console.error('⚠️ Auth routing failed:', err);
        this.router.navigateByUrl('/landing', { replaceUrl: true });
      }
    });
  }
}
