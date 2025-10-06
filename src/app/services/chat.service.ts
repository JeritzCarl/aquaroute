import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, timer } from 'rxjs';

export type MessageStatus = 'sent' | 'delivered' | 'seen';
export interface AttachmentMeta { name: string; type?: string; url?: string; }
export interface ChatMessage {
  id: string;
  stationId: string;
  sender: 'user' | 'station';
  text: string;
  createdAt: number;   // epoch ms
  status: MessageStatus;
  attachment?: AttachmentMeta | null;
}

export interface DayBlock {
  label: string;       // 'Today', 'Yesterday', 'Aug 10'
  items: ChatMessage[];
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private streams = new Map<string, BehaviorSubject<ChatMessage[]>>();
  private typingStreams = new Map<string, BehaviorSubject<boolean>>();

  initForStation(stationId: string) {
    if (!this.streams.has(stationId)) {
      const seed = this.load(stationId);
      this.streams.set(stationId, new BehaviorSubject<ChatMessage[]>(seed));
    }
    if (!this.typingStreams.has(stationId)) {
      this.typingStreams.set(stationId, new BehaviorSubject<boolean>(false));
    }
  }

  messages$(stationId: string): Observable<ChatMessage[]> {
    return this.ensureStream(stationId).asObservable();
  }

  typing$(stationId: string): Observable<boolean> {
    return this.ensureTypingStream(stationId).asObservable();
  }

  async send(stationId: string, payload: { text: string; sender: 'user' | 'station'; attachment?: AttachmentMeta | null }) {
    const list = this.ensureStream(stationId).value.slice();
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      stationId,
      sender: payload.sender,
      text: payload.text ?? '',
      createdAt: Date.now(),
      status: payload.sender === 'user' ? 'sent' : 'delivered',
      attachment: payload.attachment ?? null,
    };
    list.push(msg);
    this.setAndPersist(stationId, list);

    // simulate delivery/seen after short delays
    if (msg.sender === 'user') {
      timer(400).subscribe(() => this.bumpStatus(stationId, msg.id, 'delivered'));
      timer(1200).subscribe(() => this.bumpStatus(stationId, msg.id, 'seen'));
    }
  }

  simulateAutoReply(stationId: string, text?: string) {
    const typing$ = this.ensureTypingStream(stationId);
    typing$.next(true);
    const reply = text || this.pickReply();
    timer(1200).subscribe(() => {
      typing$.next(false);
      this.send(stationId, { text: reply, sender: 'station' });
    });
  }

  toDayBlocks(list: ChatMessage[]): DayBlock[] {
    const byDay = new Map<string, ChatMessage[]>();
    for (const m of list.sort((a,b)=>a.createdAt-b.createdAt)) {
      const key = new Date(m.createdAt).toDateString();
      byDay.set(key, [...(byDay.get(key)||[]), m]);
    }
    const todayStr = new Date().toDateString();
    const ydayStr = new Date(Date.now()-86400000).toDateString();

    return Array.from(byDay.entries()).map(([key, items]) => {
      const label = key === todayStr ? 'Today' : key === ydayStr ? 'Yesterday' :
        new Date(key).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      return { label, items };
    });
  }

  // ------- internals -------
  private ensureStream(stationId: string) {
    if (!this.streams.has(stationId)) this.initForStation(stationId);
    return this.streams.get(stationId)!;
    }

  private ensureTypingStream(stationId: string) {
    if (!this.typingStreams.has(stationId)) this.initForStation(stationId);
    return this.typingStreams.get(stationId)!;
  }

  private setAndPersist(stationId: string, list: ChatMessage[]) {
    this.ensureStream(stationId).next(list);
    localStorage.setItem(this.key(stationId), JSON.stringify(list));
  }

  private load(stationId: string): ChatMessage[] {
    try {
      const raw = localStorage.getItem(this.key(stationId));
      return raw ? JSON.parse(raw) as ChatMessage[] : this.seed();
    } catch { return this.seed(); }
  }

  private key(stationId: string) { return `aquaroute:chat:${stationId}`; }

  private bumpStatus(stationId: string, id: string, status: MessageStatus) {
    const list = this.ensureStream(stationId).value.slice();
    const idx = list.findIndex(m => m.id === id);
    if (idx >= 0) {
      list[idx] = { ...list[idx], status };
      this.setAndPersist(stationId, list);
    }
  }

    private seed(): ChatMessage[] {
    return []; // start with no messages
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
}
