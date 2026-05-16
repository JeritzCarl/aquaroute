import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Firestore, collection, collectionData, query, orderBy } from '@angular/fire/firestore';
import { Observable } from 'rxjs';

interface AdminLog {
  id: string;
  action: string;
  stationName: string;
  timestamp: any;
  adminEmail: string;
}

@Component({
  selector: 'app-admin-logs',
  standalone: true,
  templateUrl: './admin-logs.page.html',
  styleUrls: ['./admin-logs.page.scss'],
  imports: [CommonModule, IonicModule],
})
export class AdminLogsPage implements OnInit {
  logs$!: Observable<AdminLog[]>;

  constructor(private firestore: Firestore) {}

  ngOnInit() {
    const adminUid = localStorage.getItem('adminUid');
    if (!adminUid) return;

    const logsRef = collection(this.firestore, `adminLogs/${adminUid}/actions`);
    const q = query(logsRef, orderBy('timestamp', 'desc'));
    this.logs$ = collectionData(q, { idField: 'id' }) as Observable<AdminLog[]>;
  }

  formatDate(ts: any): string {
    if (!ts) return 'No date';
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    return date.toLocaleString();
  }
}
