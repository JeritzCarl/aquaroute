import { Injectable } from '@angular/core';
import {
  Firestore,
  doc,
  setDoc,
  deleteDoc,
  collection,
  collectionData,
  updateDoc,
  increment,
  getDoc,
} from '@angular/fire/firestore';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class FavoritesService {
  private favorites$ = new BehaviorSubject<string[]>([]);
  private favSub?: Subscription;

  constructor(private afs: Firestore, private auth: Auth) {
    // ✅ Watch for auth state changes
    onAuthStateChanged(this.auth, (user) => {
      if (user) this.listenToFavorites(user.uid);
      else {
        this.favorites$.next([]);
        this.favSub?.unsubscribe();
      }
    });
  }

  // 🔹 Safely get current user ID
  private uid(): string {
    const u = this.auth.currentUser;
    if (!u) throw new Error('User not logged in.');
    return u.uid;
  }

  // 🔹 Firestore ref
  private favoriteDoc(stationId: string) {
    return doc(this.afs, `users/${this.uid()}/favorites/${stationId}`);
  }

  // ✅ Real-time listener for user favorites
  private listenToFavorites(uid: string) {
    if (this.favSub) this.favSub.unsubscribe();

    const col = collection(this.afs, `users/${uid}/favorites`);
    this.favSub = collectionData(col, { idField: 'id' }).subscribe((rows: any[]) => {
      const ids = rows.map((r) => r.id);
      this.favorites$.next(ids);
    });
  }

  // ✅ Observable of all favorite IDs
  favoritesList$(): Observable<string[]> {
    return this.favorites$.asObservable();
  }

  // ✅ Observable for single favorite
  isFavorite$(stationId: string): Observable<boolean> {
    return this.favorites$.pipe(map((list) => list.includes(stationId)));
  }

  // ✅ Toggle favorite add/remove
  async toggle(stationId: string): Promise<{ favored: boolean }> {
    const ref = this.favoriteDoc(stationId);
    const snap = await getDoc(ref);

    if (snap.exists()) {
      await deleteDoc(ref);
      await this.bumpStationCount(stationId, -1);
      return { favored: false };
    } else {
      await setDoc(ref, { stationId, addedAt: new Date() });
      await this.bumpStationCount(stationId, +1);
      return { favored: true };
    }
  }

  // ✅ Adjust station favorites count
  private async bumpStationCount(stationId: string, delta: number): Promise<void> {
    const sRef = doc(this.afs, `stations/${stationId}`);
    try {
      await updateDoc(sRef, { favoritesCount: increment(delta) });
    } catch {
      await updateDoc(sRef, { favoritesCount: delta > 0 ? 1 : 0 });
    }
  }
}
