import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from 'src/environments/environment';

@Injectable({ providedIn: 'root' })
export class RouteService {
  private apiKey = environment.googleMapsApiKey;

  constructor(private http: HttpClient) {}

  // Get optimized route
  getOptimizedRoute(start: string, waypoints: string[], end: string) {
    const wp = waypoints.join('|');
    const url =
      `https://maps.googleapis.com/maps/api/directions/json?` +
      `origin=${encodeURIComponent(start)}` +
      `&destination=${encodeURIComponent(end)}` +
      `&waypoints=optimize:true|${encodeURIComponent(wp)}` +
      `&key=${this.apiKey}`;
    return this.http.get(url);
  }
}
