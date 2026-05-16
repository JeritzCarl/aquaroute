import { Injectable } from '@angular/core';
import { Firestore, collection, getDocs } from '@angular/fire/firestore';

/**
 * 💧 RatingService
 * Centralized Firestore-based rating fetcher for all station-related views.
 * Returns average rating and total review count for any station.
 */
@Injectable({
  providedIn: 'root',
})
export class RatingService {
  constructor(private firestore: Firestore) {}

  /**
   * Fetch average rating and review count for a given station.
   * Falls back gracefully if the subcollection doesn't exist or has no docs.
   */
  async getStationRating(stationId: string): Promise<{ avgRating: number; reviewCount: number }> {
    if (!stationId) return { avgRating: 0, reviewCount: 0 };

    try {
      const ratingsRef = collection(this.firestore, `stations/${stationId}/ratings`);
      const snapshot = await getDocs(ratingsRef);

      if (snapshot.empty) {
        return { avgRating: 0, reviewCount: 0 };
      }

      const ratings: number[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data() as any;
        if (typeof data?.rating === 'number') ratings.push(data.rating);
      });

      if (ratings.length === 0) {
        return { avgRating: 0, reviewCount: 0 };
      }

      const total = ratings.reduce((a, b) => a + b, 0);
      const avg = parseFloat((total / ratings.length).toFixed(1));

      return { avgRating: avg, reviewCount: ratings.length };
    } catch (err) {
      console.warn('⚠️ Failed to fetch station ratings:', err);
      return { avgRating: 0, reviewCount: 0 };
    }
  }
}
