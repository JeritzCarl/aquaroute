// src/app/rating/rating.page.ts
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ToastController, AlertController } from '@ionic/angular';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  Firestore,
  doc,
  getDoc,
  updateDoc,
  setDoc,
  collection,
  serverTimestamp,
  getDocs,
} from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';

@Component({
  selector: 'app-rating',
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule, FormsModule],
  templateUrl: './rating.page.html',
  styleUrls: ['./rating.page.scss'],
})
export class RatingPage implements OnInit {
  orderId!: string;
  order: any;
  mode: 'delivery' | 'pickup' = 'delivery';

  stationRating = 0;
  courierRating = 0;
  stationFeedback = '';
  courierFeedback = '';

  constructor(
    private route: ActivatedRoute,
    private firestore: Firestore,
    private auth: Auth,
    private toastCtrl: ToastController,
    private alertCtrl: AlertController,
    private router: Router
  ) {}

  async ngOnInit() {
    this.orderId = this.route.snapshot.paramMap.get('orderId') || '';

    const queryMode = this.route.snapshot.queryParamMap.get('mode');
    if (queryMode && (queryMode === 'pickup' || queryMode === 'delivery')) {
      this.mode = queryMode;
    }

    if (!this.orderId) {
      this.showToast('Invalid order ID', 'danger');
      return;
    }
    await this.loadOrder();
  }

  async loadOrder() {
    try {
      const ref = doc(this.firestore, `orders/${this.orderId}`);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        this.order = snap.data();
        const m = (this.order.mode || 'delivery').toLowerCase();
        this.mode = m === 'pickup' ? 'pickup' : 'delivery';
      } else {
        this.showToast('Order not found', 'danger');
      }
    } catch (err) {
      console.error('⚠️ Failed to load order:', err);
      this.showToast('Failed to load order.', 'danger');
    }
  }

  async submitRating() {
    if (this.stationRating <= 0) {
      this.showToast('Please rate the station.', 'warning');
      return;
    }
    if (this.mode === 'delivery' && this.courierRating <= 0) {
      this.showToast('Please rate the courier.', 'warning');
      return;
    }

    try {
      const user = this.auth.currentUser;
      if (!user || !this.order) return;

      const stationId =
        this.order.stationId ||
        this.order.stations?.[0]?.stationId ||
        this.order.stations?.[0]?.id;

      const courierId =
        this.order.courier?.id ||
        this.order.assignedCourierId ||
        this.order.courierId ||
        this.order.courierRef?.id ||
        null;

      const payload = {
        orderId: this.orderId,
        userId: user.uid,
        stationId,
        courierId: courierId || null,
        ratingStation: this.stationRating,
        ratingCourier: this.mode === 'delivery' ? this.courierRating : null,
        feedbackStation: this.stationFeedback || null,
        feedbackCourier:
          this.mode === 'delivery' ? this.courierFeedback || null : null,
        mode: this.mode,
        createdAt: serverTimestamp(),
      };

      // 🔹 Save user rating
      await setDoc(
        doc(this.firestore, `users/${user.uid}/ratings/${this.orderId}`),
        payload
      );

      // 🔹 Save station rating
      if (stationId) {
        await setDoc(
          doc(this.firestore, `stations/${stationId}/ratings/${this.orderId}`),
          payload
        );
      }

      // 🔹 Save courier rating + live avg sync
      if (this.mode === 'delivery' && courierId) {
        await setDoc(
          doc(this.firestore, `couriers/${courierId}/ratings/${this.orderId}`),
          {
            orderId: this.orderId,
            userId: user.uid,
            stationId: stationId || null,
            rating: this.courierRating,
            feedback: this.courierFeedback || '',
            mode: this.mode,
            createdAt: serverTimestamp(),
          },
          { merge: true }
        );

        // 🔹 Recalculate averages for courier
        const snap = await getDocs(
          collection(this.firestore, `couriers/${courierId}/ratings`)
        );
        const ratings = snap.docs
          .map((d) => d.data()['rating'])
          .filter((v) => typeof v === 'number' && v > 0);
        const avg =
          ratings.length > 0
            ? ratings.reduce((a, b) => a + b, 0) / ratings.length
            : 0;

        await updateDoc(doc(this.firestore, `couriers/${courierId}`), {
          avgRating: parseFloat(avg.toFixed(1)),
          totalRatings: ratings.length,
          updatedAt: serverTimestamp(),
        });

        // 🔹 Notify courier with feedback
        await setDoc(
          doc(collection(this.firestore, `couriers/${courierId}/notifications`)),
          {
            title: 'You received a rating!',
            message: this.courierFeedback
              ? `⭐ ${this.courierRating} stars – “${this.courierFeedback}”`
              : `⭐ ${this.courierRating} stars on your last delivery.`,
            type: 'rating',
            createdAt: serverTimestamp(),
            read: false,
          }
        );
      }

      // 🔹 Safe order rating update across all mirrors
      const ratingData = {
        rated: true,
        'rating.stationRating': this.stationRating,
        'rating.courierRating':
          this.mode === 'delivery' ? this.courierRating : null,
        'rating.review':
          this.mode === 'delivery'
            ? this.stationFeedback || this.courierFeedback
            : this.stationFeedback,
        'rating.ratedAt': serverTimestamp(),
        'rating.rated': true,
      };

      const globalOrderRef = doc(this.firestore, `orders/${this.orderId}`);
      const stationOrderRef = doc(
        this.firestore,
        `stations/${stationId}/orders/${this.orderId}`
      );
      const archivedOrderRef = doc(
        this.firestore,
        `stations/${stationId}/archivedOrders/${this.orderId}`
      );

      try {
        const [globalSnap, stationSnap, archivedSnap] = await Promise.all([
          getDoc(globalOrderRef),
          getDoc(stationOrderRef),
          getDoc(archivedOrderRef),
        ]);

        if (globalSnap.exists()) {
          await updateDoc(globalOrderRef, ratingData);
        } else if (stationSnap.exists()) {
          await updateDoc(stationOrderRef, ratingData);
        } else if (archivedSnap.exists()) {
          await updateDoc(archivedOrderRef, ratingData);
        } else {
          console.warn('⚠️ No order document found for rating update:', this.orderId);
        }
      } catch (err) {
        console.error('❌ Order update during rating failed:', err);
      }

      // ✅ Propagate rated flag
      const updates = { rated: true };
      await Promise.all([
        updateDoc(
          doc(this.firestore, `users/${user.uid}/orders/${this.orderId}`),
          updates
        ).catch(() => {}),
        stationId
          ? updateDoc(
              doc(this.firestore, `stations/${stationId}/orders/${this.orderId}`),
              updates
            ).catch(() => {})
          : Promise.resolve(),
      ]);

      // ✅ Recalculate averages for station
      if (stationId) await this.updateAverage('stations', stationId);

      // 🔹 Notify station manager
      if (stationId) {
        await setDoc(
          doc(collection(this.firestore, `stations/${stationId}/notifications`)),
          {
            title: 'New Rating Received',
            message: this.stationFeedback
              ? `⭐ ${this.stationRating} stars – “${this.stationFeedback}”`
              : `⭐ ${this.stationRating} stars from a customer.`,
            type: 'rating',
            createdAt: serverTimestamp(),
            read: false,
          }
        );
      }

      await this.showToast('⭐ Rating submitted successfully!', 'success');
      this.router.navigate(['/orders']);
    } catch (err) {
      console.error('❌ Rating submission failed:', err);
      this.showToast('Failed to submit rating.', 'danger');
    }
  }

  async showToast(
    message: string,
    color: 'success' | 'warning' | 'danger' | 'medium'
  ) {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2000,
      color,
    });
    await toast.present();
  }

  private async updateAverage(
    collectionName: 'stations' | 'couriers',
    id: string
  ) {
    const snap = await getDocs(
      collection(this.firestore, `${collectionName}/${id}/ratings`)
    );
    const ratings = snap.docs
      .map((d) => d.data()['ratingStation'] || d.data()['rating'] || 0)
      .filter((v) => typeof v === 'number' && v > 0);

    const avg =
      ratings.length > 0
        ? ratings.reduce((a, b) => a + b, 0) / ratings.length
        : 0;

    await updateDoc(doc(this.firestore, `${collectionName}/${id}`), {
      avgRating: parseFloat(avg.toFixed(1)),
      totalRatings: ratings.length,
    });
  }
}
