
import { Component } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';

@Component({
  standalone: true,
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  imports: [IonicModule, CommonModule, RouterModule],
})
export class HomePage {
  constructor(private router: Router) {}

  goToSignUp() {
    this.router.navigate(['/number-input']);
  }

  goToLogin() {
    this.router.navigate(['/login']);
  }
}

