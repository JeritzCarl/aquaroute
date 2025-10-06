// capacitor.config.ts
import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize, KeyboardStyle } from '@capacitor/keyboard';

const config: CapacitorConfig = {
  appId: 'io.ionic.starter',
  appName: 'aquaroute-app',
  webDir: 'www',
  plugins: {
    Keyboard: {
      resize: KeyboardResize.Native, // ✅ better for forms
      style: KeyboardStyle.Light,
      resizeOnFullScreen: true,
    },
    StatusBar: {
      overlaysWebView: false,
    },
  },
};

export default config;
