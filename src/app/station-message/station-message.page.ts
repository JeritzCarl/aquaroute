import { Component, ViewChild, OnDestroy, OnInit } from '@angular/core';
import { IonContent, ToastController, IonicModule } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';   // ✅ add Router
import { Location } from '@angular/common';                 // ✅ add Location
import { Subscription } from 'rxjs';
import { ChatMessage, ChatService, DayBlock } from '../services/chat.service';

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
  stationName = 'Pengue Pure Water Station';
  stationLogo = '';
  isOnline = true;

  draft = '';
  typingFromStation = false;

  messages: ChatMessage[] = [];
  dayBlocks: DayBlock[] = [];

  private sub?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private chat: ChatService,
    private toastCtrl: ToastController,
    private location: Location,     // ✅ inject Location
    private router: Router          // ✅ inject Router
  ) {}

  ngOnInit() {
    this.stationId = this.route.snapshot.paramMap.get('id') || 'demo-station';
    this.stationName = this.route.snapshot.queryParamMap.get('name') || this.stationName;
    this.stationLogo = this.route.snapshot.queryParamMap.get('logo') || this.stationLogo;

    this.chat.initForStation(this.stationId);

    this.sub = this.chat.messages$(this.stationId).subscribe((list: ChatMessage[]) => {
      this.messages = list;
      this.dayBlocks = this.chat.toDayBlocks(list);
      this.scrollToBottomSoon();
    });

    this.chat.typing$(this.stationId).subscribe((isTyping: boolean) => {
      this.typingFromStation = isTyping;
      if (isTyping) this.scrollToBottomSoon();
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  canSend(): boolean {
    return (this.draft?.trim()?.length || 0) > 0;
  }

  async send() {
    if (!this.canSend()) return;
    const text = this.draft.trim();
    this.draft = '';
    await this.chat.send(this.stationId, { text, sender: 'user' });
    this.scrollToBottomSoon();

    this.chat.simulateAutoReply(this.stationId);
  }

  // ✅ now works without cast in HTML
  maybeSend(ev: KeyboardEvent | any) {
    if (!ev.shiftKey) {
      ev.preventDefault();
      this.send();
    }
  }

  pickAttachment() {
    (document.querySelector('input[type=file]') as HTMLInputElement)?.click();
  }

  async onFileChosen(ev: Event) {
    const input = ev.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];

    await this.chat.send(this.stationId, {
      text: '',
      sender: 'user',
      attachment: { name: file.name, type: file.type }
    });

    const t = await this.toastCtrl.create({ message: 'Attachment added (demo)', duration: 1500 });
    t.present();

    input.value = '';
    this.scrollToBottomSoon();
    this.chat.simulateAutoReply(this.stationId, 'Attachment received 👍');
  }

  private async scrollToBottomSoon() {
    setTimeout(() => this.content?.scrollToBottom(250), 30);
  }

  // ✅ Back button handler (works after refresh)
  goBack() {
    if (window.history.length > 1) {
      this.location.back();
    } else {
      this.router.navigate(['/station']); // fallback route
    }
  }
}
