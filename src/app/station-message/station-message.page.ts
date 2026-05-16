import { Component, ViewChild, OnDestroy, OnInit, ElementRef } from '@angular/core';
import { IonContent, ToastController, AlertController, IonicModule } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import {
  Firestore,
  collection,
  collectionData,
  query,
  orderBy,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  getDoc,
  getDocs,
  where,
  writeBatch,
} from '@angular/fire/firestore';
import { Subscription } from 'rxjs';
import { Auth } from '@angular/fire/auth';
import { NotificationService } from '../services/notification.service';

interface Message {
  id?: string;
  text: string;
  sender: 'user' | 'station';
  createdAt?: any;
  read?: boolean;
  status?: string;
}

@Component({
  selector: 'app-station-message',
  standalone: true,
  templateUrl: './station-message.page.html',
  styleUrls: ['./station-message.page.scss'],
  imports: [IonicModule, CommonModule, FormsModule],
})
export class StationMessagePage implements OnInit, OnDestroy {
  @ViewChild('content', { static: false }) content?: IonContent;

  stationId!: string;
  stationName = 'Water Station';
  stationLogo = '';
  isOnline = true;

  draft = '';
  typingFromStation = false;
  messages: Message[] = [];
  dayBlocks: any[] = [];

  private sub?: Subscription;
  private managerId?: string;
  private userId?: string;
  private userName = '';

  constructor(
    private route: ActivatedRoute,
    private toastCtrl: ToastController,
    private location: Location,
    private router: Router,
    private auth: Auth,
    private firestore: Firestore,
    private notifications: NotificationService,
    private alertCtrl: AlertController
  ) {}

  async ngOnInit() {
    // 🔹 Initialize
    this.stationId = this.route.snapshot.paramMap.get('id') || 'demo-station';
    this.stationName = this.route.snapshot.queryParamMap.get('name') || this.stationName;
    this.stationLogo = this.route.snapshot.queryParamMap.get('logo') || this.stationLogo;

    const user = this.auth.currentUser;
    if (!user) {
      console.warn('⚠️ No authenticated user found.');
      return;
    }
    this.userId = user.uid;
    this.userName = user.displayName || 'Customer';

    // 🔹 Fetch managerId from station
    try {
      const stationRef = doc(this.firestore, `stations/${this.stationId}`);
      const snap = await getDoc(stationRef);
      const data = snap.data() as any;
      this.managerId = data?.managerId || this.stationId;
    } catch (err) {
      console.error('⚠️ Failed to fetch managerId:', err);
    }

    // 🔹 Real-time listener for messages
    const convoRef = collection(
      this.firestore,
      `stations/${this.stationId}/messages/${this.userId}/conversation`
    );
    const qy = query(convoRef, orderBy('createdAt', 'asc'));

    this.sub = collectionData(qy, { idField: 'id' }).subscribe((msgs: any[]) => {
      this.messages = msgs;
      this.groupMessagesByDate();
      this.scrollToBottomSoon();

      // ✅ Mark station messages as read when viewing
      this.markMessagesAsRead();
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  // 🔹 Group messages by date (for day divider)
  private groupMessagesByDate() {
    const grouped: { [key: string]: Message[] } = {};
    for (const msg of this.messages) {
      const date = msg.createdAt?.toDate?.()?.toDateString?.() || 'Today';
      if (!grouped[date]) grouped[date] = [];
      grouped[date].push(msg);
    }

    this.dayBlocks = Object.keys(grouped).map((date) => ({
      label: date,
      items: grouped[date],
    }));
  }

  canSend(): boolean {
    return (this.draft?.trim()?.length || 0) > 0;
  }

  // 🔹 Send message
  async send() {
    if (!this.canSend() || !this.userId) return;
    const text = this.draft.trim();
    this.draft = '';

    const msgData: Message = {
      text,
      sender: 'user',
      createdAt: serverTimestamp(),
      read: false,
      status: 'sent',
    };

    try {
      const convoRef = collection(
        this.firestore,
        `stations/${this.stationId}/messages/${this.userId}/conversation`
      );
      await addDoc(convoRef, msgData);
      this.scrollToBottomSoon();

      // 🔹 Notify manager
      if (this.managerId && text) {
        await this.notifications.notifyManagerUserMessage(this.managerId, this.userName, text);
        console.log(`📨 Manager notified: ${this.managerId} — ${text}`);
      }

      // ✅ Optional toast
      const toast = await this.toastCtrl.create({
        message: 'Message sent ✅',
        duration: 1000,
        position: 'bottom',
      });
      toast.present();
    } catch (err) {
      console.error('⚠️ Failed to send message:', err);
    }
  }

  maybeSend(ev: KeyboardEvent | any) {
    if (!ev.shiftKey) {
      ev.preventDefault();
      this.send();
    }
  }

  // 🔹 Auto-scroll helper
  private async scrollToBottomSoon() {
    setTimeout(() => this.content?.scrollToBottom(250), 50);
  }

  // 🔹 Mark unread messages as read
  private async markMessagesAsRead() {
    if (!this.userId || !this.stationId) return;
    const convoRef = collection(
      this.firestore,
      `stations/${this.stationId}/messages/${this.userId}/conversation`
    );

    const snap = await getDocs(query(convoRef, where('sender', '==', 'station'), where('read', '==', false)));
    if (snap.empty) return;

    const batch = writeBatch(this.firestore);
    snap.forEach((d) => batch.update(d.ref, { read: true }));
    await batch.commit();
  }

  pickAttachment() {
    (document.querySelector('input[type=file]') as HTMLInputElement)?.click();
  }

  async onFileChosen(ev: Event) {
    const input = ev.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];

    const msgData: Message = {
      text: `📎 ${file.name}`,
      sender: 'user',
      createdAt: serverTimestamp(),
      read: false,
      status: 'sent',
    };

    try {
      const convoRef = collection(
        this.firestore,
        `stations/${this.stationId}/messages/${this.userId}/conversation`
      );
      await addDoc(convoRef, msgData);

      const toast = await this.toastCtrl.create({
        message: 'Attachment sent ✅',
        duration: 1500,
        position: 'bottom',
      });
      toast.present();
    } catch (err) {
      console.error('⚠️ Failed to send attachment:', err);
    }

    input.value = '';
    this.scrollToBottomSoon();
  }

  async confirmDelete(messageId: string) {
    const alert = await this.alertCtrl.create({
      header: 'Delete Message',
      message: 'Are you sure you want to delete this message?',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: () => this.deleteMessage(messageId),
        },
      ],
    });
    await alert.present();
  }

  async deleteMessage(messageId: string) {
    const ref = doc(
      this.firestore,
      `stations/${this.stationId}/messages/${this.userId}/conversation/${messageId}`
    );
    await updateDoc(ref, { text: '🗑️ Message deleted', deleted: true });
  }

  goBack() {
    if (window.history.length > 1) this.location.back();
    else this.router.navigate(['/station']);
  }
}
