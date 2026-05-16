import { Injectable } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  setDoc,
  addDoc,
  serverTimestamp,
  query,
  orderBy,
  onSnapshot,
  getDoc,
  updateDoc,
  deleteDoc, // ✅ added
} from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { BehaviorSubject, Observable } from 'rxjs';
import { NotificationService } from './notification.service';

export type MessageStatus = 'sent' | 'delivered' | 'seen';

export interface AttachmentMeta {
  name: string;
  type?: string;
  url?: string;
}

export interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'station';
  createdAt: any;
  status: MessageStatus;
  attachment?: AttachmentMeta | null;
}

export interface DayBlock {
  label: string;
  items: ChatMessage[];
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private streams = new Map<string, BehaviorSubject<ChatMessage[]>>();
  private typingStreams = new Map<string, BehaviorSubject<boolean>>();

  constructor(
    private firestore: Firestore,
    private auth: Auth,
    private notifications: NotificationService
  ) {}

  // ────────────────────────────────
  // ✅ Init Stream for a Station
  // ────────────────────────────────
  initForStation(stationId: string) {
    if (!this.streams.has(stationId)) {
      this.streams.set(stationId, new BehaviorSubject<ChatMessage[]>([]));
      this.listenForMessages(stationId);
    }
    if (!this.typingStreams.has(stationId)) {
      this.typingStreams.set(stationId, new BehaviorSubject<boolean>(false));
    }
  }

  // ────────────────────────────────
  // 🔥 Real-time Listener
  // ────────────────────────────────
  private listenForMessages(stationId: string) {
    const user = this.auth.currentUser;
    if (!user) return;

    const messagesRef = collection(
      this.firestore,
      `users/${user.uid}/chats/${stationId}/messages`
    );
    const q = query(messagesRef, orderBy('createdAt'));
    onSnapshot(q, (snap) => {
      const list: ChatMessage[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      }));
      this.ensureStream(stationId).next(list);
    });
  }

  messages$(stationId: string): Observable<ChatMessage[]> {
    return this.ensureStream(stationId).asObservable();
  }

  typing$(stationId: string): Observable<boolean> {
    return this.ensureTypingStream(stationId).asObservable();
  }

  // ────────────────────────────────
  // ✉️ Send Message (User or Station)
  // ────────────────────────────────
  async send(
    stationId: string,
    payload: { text: string; sender: 'user' | 'station'; attachment?: AttachmentMeta | null }
  ) {
    const user = this.auth.currentUser;
    if (!user) throw new Error('Not authenticated');

    const msg: ChatMessage = {
      id: '',
      text: payload.text || '',
      sender: payload.sender,
      createdAt: serverTimestamp(),
      status: payload.sender === 'user' ? 'sent' : 'delivered',
      attachment: payload.attachment ?? null,
    };

    // Paths
    const userPath = `users/${user.uid}/chats/${stationId}/messages`;
    const stationPath = `stations/${stationId}/chats/${user.uid}/messages`;

    // Add message to both
    const userMsgRef = await addDoc(collection(this.firestore, userPath), msg);
    const stationMsgRef = doc(this.firestore, stationPath, userMsgRef.id);
    await setDoc(stationMsgRef, msg, { merge: true });

    // Update meta (chat preview)
    await this.updateChatMeta(user.uid, stationId, payload.text, 'user');
    await this.updateChatMeta(stationId, user.uid, payload.text, 'station');

    // Notify manager if from user
    if (payload.sender === 'user' && payload.text) {
      try {
        const stationDoc = await getDoc(doc(this.firestore, `stations/${stationId}`));
        const stationData = stationDoc.data() as any;
        const managerId = stationData?.managerId || stationId;
        await this.notifications.notifyManagerUserMessage(
          managerId,
          user.displayName || 'Customer',
          payload.text
        );
        console.log(`📨 Notified manager ${managerId} of new user message`);
      } catch (err) {
        console.error('⚠️ Failed to send manager notification:', err);
      }
    }
  }

  // ────────────────────────────────
  // 🗨️ Update Chat Meta
  // ────────────────────────────────
  private async updateChatMeta(
    ownerId: string,
    partnerId: string,
    lastText: string,
    ownerType: 'user' | 'station'
  ) {
    try {
      const basePath =
        ownerType === 'user'
          ? `users/${ownerId}/chats/${partnerId}`
          : `stations/${ownerId}/chats/${partnerId}`;

      const metaRef = doc(this.firestore, basePath);
      await setDoc(
        metaRef,
        {
          lastMessage: lastText,
          lastUpdated: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (err) {
      console.warn('⚠️ Failed to update chat meta:', err);
    }
  }

  // ────────────────────────────────
  // 💬 Simulate Auto-Reply (Demo Only)
  // ────────────────────────────────
  simulateAutoReply(stationId: string, text?: string) {
    const typing$ = this.ensureTypingStream(stationId);
    typing$.next(true);
    const reply = text || this.pickReply();
    setTimeout(async () => {
      typing$.next(false);
      await this.send(stationId, { text: reply, sender: 'station' });
    }, 1200);
  }

  // ────────────────────────────────
  // 🗑️ Delete Message (User or Station)
  // ────────────────────────────────
  async deleteMessage(stationId: string, messageId: string): Promise<void> {
    const userId = this.getCurrentUserId();
    if (!userId) {
      console.warn('⚠️ No authenticated user found. Cannot delete message.');
      return;
    }

    try {
      const paths = [
        `users/${userId}/chats/${stationId}/messages/${messageId}`,
        `stations/${stationId}/chats/${userId}/messages/${messageId}`,
      ];

      for (const path of paths) {
        const ref = doc(this.firestore, path);
        await deleteDoc(ref).catch(() => {}); // ignore if missing
      }

      console.log(`🗑️ Deleted message ${messageId} for station ${stationId}`);
    } catch (err) {
      console.error('⚠️ Failed to delete message:', err);
    }
  }

  // ────────────────────────────────
  // 🗓️ Group by Day (UI Helper)
  // ────────────────────────────────
  toDayBlocks(list: ChatMessage[]): DayBlock[] {
    const byDay = new Map<string, ChatMessage[]>();
    for (const m of list.sort((a, b) => mToTime(a.createdAt) - mToTime(b.createdAt))) {
      const key = new Date(mToTime(m.createdAt)).toDateString();
      byDay.set(key, [...(byDay.get(key) || []), m]);
    }

    const todayStr = new Date().toDateString();
    const ydayStr = new Date(Date.now() - 86400000).toDateString();

    return Array.from(byDay.entries()).map(([key, items]) => {
      const label =
        key === todayStr
          ? 'Today'
          : key === ydayStr
          ? 'Yesterday'
          : new Date(key).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            });
      return { label, items };
    });
  }

  // ────────────────────────────────
  // 🔧 Internals
  // ────────────────────────────────
  private ensureStream(stationId: string) {
    if (!this.streams.has(stationId)) this.initForStation(stationId);
    return this.streams.get(stationId)!;
  }

  private ensureTypingStream(stationId: string) {
    if (!this.typingStreams.has(stationId)) this.initForStation(stationId);
    return this.typingStreams.get(stationId)!;
  }

  private pickReply(): string {
    const replies = [
      'Yes, we have stock. When would you like it delivered?',
      'We can deliver within 45 minutes in your area.',
      'Kindly send your location pin and preferred time.',
      'Got it! We’ll prepare the containers now.',
    ];
    return replies[Math.floor(Math.random() * replies.length)];
  }

  private getCurrentUserId(): string | null {
    return this.auth.currentUser?.uid || null;
  }
}

// ─────────────── Helper ───────────────
function mToTime(val: any): number {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  if (val.toDate) return val.toDate().getTime();
  return Date.now();
}
