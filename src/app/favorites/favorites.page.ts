import { Component, OnInit, OnDestroy } from '@angular/core';
import { IonicModule, ToastController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { Firestore } from '@angular/fire/firestore';
import { FavoritesService } from '../services/favorites.service';
import { StationService } from '../services/station.service';
import { Subscription, switchMap, of, combineLatest } from 'rxjs';

@Component({
  selector: 'app-favorites',
  standalone: true,
  imports: [IonicModule, CommonModule, RouterModule],
  templateUrl: './favorites.page.html',
  styleUrls: ['./favorites.page.scss'],
})
export class FavoritesPage implements OnInit, OnDestroy {
  stations: any[] = [];
  sub?: Subscription;
  loading = true;

  constructor(
    private fav: FavoritesService,
    private stationSvc: StationService,
    private router: Router,
    private toast: ToastController,
    private afs: Firestore
  ) {}

  ngOnInit() {
    // 🔹 Real-time stream of favorite stations
    this.sub = this.fav.favoritesList$()
      .pipe(
        switchMap((ids: string[]) => {
          if (!ids || !ids.length) return of([]);
          const streams = ids.map((id: string) => this.stationSvc.getStationById(id));
          return combineLatest(streams);
        })
      )
      .subscribe({
        next: (data: any[]) => {
          this.stations = data.filter((s) => !!s);
          this.loading = false;
        },
        error: (err: any) => {
          console.error('Failed to load favorites:', err);
          this.loading = false;
        },
      });
  }

  // ❤️ Toggle favorite directly from Favorites Page
  async toggleFavorite(stationId: string) {
    try {
      const res = await this.fav.toggle(stationId);
      const msg = res.favored
        ? 'Added to favorites ❤️'
        : 'Removed from favorites 💔';
      const toast = await this.toast.create({
        message: msg,
        duration: 1300,
        color: 'medium',
      });
      await toast.present();
    } catch (e) {
      console.error('Toggle failed:', e);
    }
  }

  // 🏪 View Station Details
  viewStation(stationId: string) {
    this.router.navigate(['/station', stationId]);
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
  }
}
