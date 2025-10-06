import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Observable } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';
import { CartService } from '../services/cart.service';
import { StationService } from '../services/station.service';
import { Product } from '../models/product.model';
import { Station } from '../models/station.model';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-station',
  templateUrl: './station.page.html',
  styleUrls: ['./station.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule, RouterModule],
})
export class StationPage implements OnInit {
  stationId: string | null = null;
  station: Station | null = null;

  products$: Observable<Product[]> = new Observable<Product[]>();
  productsSnapshot: Product[] = [];

  cartCount = 0;

  constructor(
    private route: ActivatedRoute,
    private stationService: StationService,
    private cartService: CartService,
    private router: Router
  ) {}

  ngOnInit() {
    this.stationId = this.route.snapshot.paramMap.get('id');
    if (!this.stationId) return;

    this.loadStation();
    this.loadProducts();

    this.cartService.cartCount$.subscribe(
      (count) => (this.cartCount = count)
    );
  }

  private loadStation() {
    if (!this.stationId) return;
    this.stationService.getStationById(this.stationId).subscribe((station) => {
      this.station = {
        ...station,
        deliveryEstimate: station.deliveryEstimate || '30–45 mins',
        distanceKm: station.distanceKm ?? this.mockDistance(),
        promo: station.promo || null,
        services: station.services ?? ['delivery', 'pickup', 'scheduled'],
        payments: station.payments ?? ['cod', 'gcash'],
      };
    });
  }

  private loadProducts() {
    if (!this.stationId) return;

    this.products$ = this.stationService.getProducts(this.stationId).pipe(
      map((products: Product[]) =>
        products.map((p: any) => ({
          ...p,
          basePrice: p.basePrice ?? p.price ?? 0,
          inStock: true, // ✅ always true (water never out of stock)
          waterType: p.waterType ?? 'Purified',
          containerSize: p.containerSize ?? '20L',
        }))
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.products$.subscribe((products) => {
      this.productsSnapshot = products;
    });
  }

  goToCart() {
    this.router.navigate(['/cart']);
  }

  goToProduct(product: Product) {
    this.router.navigate(['/product', product.id], {
      state: { product, station: this.station },
      queryParams: { stationId: this.station?.id },
    });
  }

  goBack() {
    this.router.navigate(['/landing-page']);
  }

  private mockDistance(): number {
    return parseFloat((Math.random() * 4.5 + 0.5).toFixed(1));
  }
}
