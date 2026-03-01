import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import {
  MessagesService,
  ConversationItem,
  Message,
  MessageRecipient,
} from '../../services/messages.service';

const PAGE_SIZE = 50;

@Component({
  standalone: false,
  selector: 'app-messages-page',
  templateUrl: './messages.page.html',
  styleUrl: './messages.page.css',
})
export class MessagesPage implements OnInit, OnDestroy {
  conversations: ConversationItem[] = [];
  recipients: MessageRecipient[] = [];
  messages: Message[] = [];
  selectedUserId: string | null = null;
  selectedUser: MessageRecipient | null = null;
  hasMore = false;
  loadingMore = false;
  busy = false;
  sendBody = '';
  sendBusy = false;
  error: string | null = null;
  markReadBusy = false;

  private sub: Subscription | null = null;
  /** Current user id for template (isFromMe, read label). */
  myUserId: string | null = null;

  constructor(
    private readonly auth: AuthService,
    private readonly messagesService: MessagesService
  ) {}

  ngOnInit(): void {
    this.myUserId = this.auth.getUserIdFromToken();
    this.messagesService.startPolling();
    this.loadConversations();
    this.loadRecipients();
    this.sub = this.messagesService.getPollingTick().subscribe(() => {
      this.loadConversations();
      if (this.selectedUserId) this.loadThread(false);
    });
  }

  ngOnDestroy(): void {
    this.messagesService.stopPolling();
    this.sub?.unsubscribe();
  }

  displayName(u: MessageRecipient | null): string {
    if (!u) return '—';
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
    return name || u.uname || u.id || '—';
  }

  selectConversation(item: ConversationItem): void {
    const id = item.otherUser?.id;
    if (!id) return;
    this.selectedUserId = id;
    this.selectedUser = item.otherUser;
    this.messages = [];
    this.hasMore = false;
    this.loadThread(true);
  }

  selectRecipient(recipient: MessageRecipient): void {
    this.selectedUserId = recipient.id;
    this.selectedUser = recipient;
    this.messages = [];
    this.hasMore = false;
    this.loadThread(true);
  }

  loadConversations(): void {
    this.busy = true;
    this.error = null;
    this.messagesService
      .getConversations()
      .then((list) => {
        this.conversations = list;
      })
      .catch((e) => {
        this.error = (e as { error?: { error?: string } })?.error?.error ?? 'Failed to load conversations';
      })
      .finally(() => {
        this.busy = false;
      });
  }

  loadRecipients(): void {
    this.messagesService
      .getRecipients()
      .then((list) => {
        this.recipients = list;
      })
      .catch(() => {
        // non-blocking
      });
  }

  loadThread(reset: boolean): void {
    if (!this.selectedUserId) return;
    if (reset) {
      this.messages = [];
      this.hasMore = false;
    }
    this.loadingMore = true;
    const before =
      this.messages.length > 0 ? this.messages[this.messages.length - 1]?.id : undefined;
    this.messagesService
      .getConversation(this.selectedUserId, {
        limit: PAGE_SIZE,
        before,
      })
      .then((list) => {
        if (reset) {
          this.messages = list;
        } else {
          this.messages = [...this.messages, ...list];
        }
        this.hasMore = list.length >= PAGE_SIZE;
      })
      .catch((e) => {
        this.error = (e as { error?: { error?: string } })?.error?.error ?? 'Failed to load messages';
      })
      .finally(() => {
        this.loadingMore = false;
      });
  }

  loadMore(): void {
    if (!this.selectedUserId || this.loadingMore || !this.hasMore) return;
    this.loadThread(false);
  }

  send(): void {
    if (!this.selectedUserId || !this.sendBody.trim() || this.sendBusy) return;
    this.sendBusy = true;
    this.error = null;
    this.messagesService
      .send(this.selectedUserId, this.sendBody.trim())
      .then((msg) => {
        this.sendBody = '';
        this.messages = [msg, ...this.messages];
        this.loadConversations();
      })
      .catch((e) => {
        this.error = (e as { error?: { error?: string } })?.error?.error ?? 'Failed to send';
      })
      .finally(() => {
        this.sendBusy = false;
      });
  }

  markCurrentAsRead(): void {
    if (!this.selectedUserId || this.markReadBusy) return;
    this.markReadBusy = true;
    this.messagesService
      .markConversationAsRead(this.selectedUserId)
      .then(() => {
        this.loadConversations();
        this.messages = this.messages.map((m) =>
          m.recipientId === this.myUserId ? { ...m, readAt: new Date().toISOString() } : m
        );
      })
      .finally(() => {
        this.markReadBusy = false;
      });
  }

  markAllAsRead(): void {
    if (this.markReadBusy) return;
    this.markReadBusy = true;
    this.messagesService
      .markAllAsRead()
      .then(() => {
        this.loadConversations();
        if (this.selectedUserId) {
          this.messages = this.messages.map((m) =>
            m.recipientId === this.myUserId ? { ...m, readAt: new Date().toISOString() } : m
          );
        }
      })
      .finally(() => {
        this.markReadBusy = false;
      });
  }

  isFromMe(msg: Message): boolean {
    return msg.senderId === this.myUserId;
  }
}
