import { Component } from '@angular/core';
import { Platform } from '@ionic/angular';
import { Capacitor } from '@capacitor/core';
import { Keyboard, KeyboardResize, KeyboardStyle } from '@capacitor/keyboard';
import { StatusBar, Style as StatusBarStyle } from '@capacitor/status-bar';
import { NotificationService } from './services/notification.service';
import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth';
import { AuthService } from './services/auth.service';

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
    private authSvc: AuthService
  ) {
    this.platform.ready().then(() => {
      this.configureNativeUI();
      this.initPushNotifications();
      this.initGoogleAuth();
    });
  }

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

  private async initPushNotifications() {
    try {
      await this.notify.initPush();
    } catch (err) {
      console.error('⚠️ Failed to initialize push notifications:', err);
    }
  }

  private initGoogleAuth() {
    if (Capacitor.isNativePlatform()) {
      // @ts-ignore
      GoogleAuth.initialize({
        clientId: '480500507580-ifmdm4uvt146pevj1fdo59s2dnl6db5e.apps.googleusercontent.com',
        // @ts-ignore
        androidClientId: '480500507580-pf50pmqe5cggsoilmnramoe2jeo1umod.apps.googleusercontent.com',
        scopes: ['profile', 'email'],
        grantOfflineAccess: true,
      });
      console.log('✅ GoogleAuth initialized (native)');
    } else {
      console.log('ℹ️ Web mode: GoogleAuth skipped');
    }
  }
}