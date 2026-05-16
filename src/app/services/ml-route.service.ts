import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MLWeightService } from './ml-weight.service';

@Injectable({ providedIn: 'root' })
export class MLRouteService {
  constructor(private http: HttpClient, private weightSvc: MLWeightService) {}

  // Fetch optimized route using OSRM and ML weighting
  async getOptimizedRoute(points: { lat: number; lng: number; area?: string }[]) {
    const weights = await this.weightSvc.getWeights();

    // Sort by learned delivery efficiency (ML simulation)
    const ordered = [...points].sort(
      (a, b) => (weights[a.area || ''] ?? 1) - (weights[b.area || ''] ?? 1)
    );

    const coords = ordered.map(p => `${p.lng},${p.lat}`).join(';');
    const url = `https://router.project-osrm.org/trip/v1/driving/${coords}?roundtrip=false&source=first&destination=last&overview=full&geometries=geojson`;

    return this.http.get(url).toPromise();
  }
}
