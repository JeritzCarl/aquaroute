import { Component } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';

@Component({
  standalone: true,
  selector: 'app-reset-success',
  templateUrl: './reset-success.page.html',
  styleUrls: ['./reset-success.page.scss'],
  imports: [IonicModule, CommonModule, RouterModule],
})
export class ResetSuccessPage {
  constructor(private router: Router) {}

  goToLogin() {
    this.router.navigate(['/login']);
  }
}
