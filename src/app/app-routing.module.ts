// src/app/app-routing.module.ts
import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';

const routes: Routes = [
  {
    path: '',
    redirectTo: 'home',
    pathMatch: 'full'
  },

  // Public routes
  {
    path: 'home',
    loadComponent: () => import('./home/home.page').then(m => m.HomePage)
  },
  {
    path: 'login',
    loadComponent: () => import('./login/login.page').then(m => m.LoginPage)
  },
  {
    path: 'number-input',
    loadComponent: () => import('./number-input/number-input.page').then(m => m.NumberInputPage)
  },
  {
    path: 'landing-page',
    loadComponent: () => import('./landing-page/landing-page.page').then(m => m.LandingPage)
  },
  {
    path: 'notifications',
    loadComponent: () => import('./notifications/notifications.page').then(m => m.NotificationsPage)
  },
  {
    path: 'account',
    loadComponent: () => import('./account/account.page').then(m => m.AccountPage)
  },
  { 
    path: 'verify',
    loadComponent: () => import('./verify/verify.page').then(m => m.VerifyPage)
  },
  {
    path: 'auth-options',
    loadComponent: () => import('./auth-options/auth-options.page').then(m => m.AuthOptionsPage)
  },
  {
    path: 'register',
    loadComponent: () => import('./register/register.page').then(m => m.RegisterPage)
  },
  {
    path: 'email-login',
    loadComponent: () => import('./email-login/email-login.page').then(m => m.EmailLoginPage)
  },
  {
    path: 'profile',
    loadComponent: () => import('./profile/profile.page').then(m => m.ProfilePage)
  },
  {
    path: 'register-station',
    loadComponent: () => import('./register-station/register-station.page').then(m => m.RegisterStationPage)
  },

  // Admin / Manager / Courier (now unguarded)
  {
    path: 'admin',
    loadComponent: () => import('./admin/admin.page').then(m => m.AdminPage)
  },
  {
    path: 'manager',
    loadComponent: () => import('./manager/manager.page').then(m => m.ManagerPage)
  },
  {
    path: 'manager-profile',
    loadComponent: () => import('./manager-profile/manager-profile.page').then(m => m.ManagerProfilePage)
  },
  {
    path: 'courier',
    loadComponent: () =>  import('./courier/courier.page').then((m) => m.CourierPage)
  },

  // Public/customer routes
  {
    path: 'station/:id',
    loadComponent: () => import('./station/station.page').then(m => m.StationPage)
  },
  {
    path: 'cart',
    loadComponent: () => import('./cart/cart.page').then(m => m.CartPage)
  },
  {
    path: 'settings',
    loadComponent: () =>  import('./settings/settings.page').then(m => m.SettingsPage)
  },
  {
    path: 'product/:id',
    loadComponent: () => import('./product/product.page').then(m => m.ProductPage)
  },
  {
    path: 'reset-password',
    loadComponent: () => import('./reset-password/reset-password.page').then(m => m.ResetPasswordPage)
  },
  {
    path: 'reset-success',
    loadComponent: () => import('./reset-success/reset-success.page').then(m => m.ResetSuccessPage)
  },
  {
    path: 'station-message/:id',
    loadComponent: () => import('./station-message/station-message.page').then(m => m.StationMessagePage)
  },
  {
    path: 'checkout',
    loadComponent: () => import('./checkout/checkout.page').then(m => m.CheckoutPage)
  },
  {
    path: 'order-success',
    loadComponent: () =>  import('./order-success/order-success.page').then(m => m.OrderSuccessPage),
  },
  {
    path: 'orders',
    loadComponent: () =>  import('./orders/orders.page').then((m) => m.OrdersPage),
  },
  {
    path: 'track-order',
    loadComponent: () =>  import('./track-order/track-order.page').then(m => m.TrackOrderPage),
  },
  {
    path: 'courier-account',
    loadComponent: () =>  import('./courier-account/courier-account.page').then(m => m.CourierAccountPage),
  },
  {
    path: 'addresses',
    loadComponent: () =>  import('./addresses/addresses.page').then(m => m.AddressesPage),
  },
  { 
    path: 'add-address', 
    loadComponent: () =>  import('./add-address/add-address.page').then(m => m.AddAddressPage) 
  },
  {
  path: 'manager-orders',
  loadComponent: () => import('./manager-orders/manager-orders.page').then(m => m.ManagerOrdersPage)
  },






  // { path: '**', redirectTo: 'landing-page' },
];




@NgModule({
  imports: [RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })],
  exports: [RouterModule]
})
export class AppRoutingModule {}
