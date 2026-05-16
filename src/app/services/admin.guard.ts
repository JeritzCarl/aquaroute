import { Injectable, inject } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { map, take } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class AdminGuard implements CanActivate {
  private auth = inject(AuthService);
  private router = inject(Router);

  canActivate() {
    return this.auth.userRole$.pipe(
      take(1),
      map(role => {
        if (role === 'admin') {
          return true;
        } else {
          this.router.navigateByUrl('/home');
          return false;
        }
      })
    );
  }
}
