import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Subject } from 'rxjs';
import type { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type MessageRecipient = {
  id: string;
  uname: string;
  firstName?: string;
  lastName?: string;
  roleTypeId?: number;
};

export type Message = {
  id: string;
  senderId: string;
  recipientId: string;
  body: string;
  readAt: string | null;
  createdAt: string | null;
};

export type ConversationItem = {
  otherUser: MessageRecipient | null;
  lastMessage: Message | null;
  unreadCount: number;
};

const POLL_INTERVAL_MS = 20000;

@Injectable({ providedIn: 'root' })
export class MessagesService {
  private readonly apiBase = environment.apiUrl;
  private readonly unreadCountRefresh$ = new Subject<void>();
  private readonly pollingTick$ = new Subject<void>();
  private pollingIntervalId: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly http: HttpClient) {}

  /** Emit when the header badge should refetch unread count. */
  getUnreadCountRefresh(): Observable<void> {
    return this.unreadCountRefresh$.asObservable();
  }

  requestUnreadCountRefresh(): void {
    this.unreadCountRefresh$.next();
  }

  /** Emits every POLL_INTERVAL_MS while polling is active. Subscribe to refetch conversations/thread. */
  getPollingTick(): Observable<void> {
    return this.pollingTick$.asObservable();
  }

  startPolling(): void {
    if (this.pollingIntervalId != null) return;
    this.pollingIntervalId = setInterval(() => {
      this.unreadCountRefresh$.next();
      this.pollingTick$.next();
    }, POLL_INTERVAL_MS);
  }

  stopPolling(): void {
    if (this.pollingIntervalId != null) {
      clearInterval(this.pollingIntervalId);
      this.pollingIntervalId = null;
    }
  }

  async getUnreadCount(): Promise<{ count: number }> {
    return await firstValueFrom(
      this.http.get<{ count: number }>(`${this.apiBase}/messages/unread-count`)
    );
  }

  async getRecipients(): Promise<MessageRecipient[]> {
    return await firstValueFrom(
      this.http.get<MessageRecipient[]>(`${this.apiBase}/messages/recipients`)
    );
  }

  async getConversations(): Promise<ConversationItem[]> {
    return await firstValueFrom(
      this.http.get<ConversationItem[]>(`${this.apiBase}/messages/conversations`)
    );
  }

  async getConversation(
    withUserId: string,
    options?: { limit?: number; before?: string }
  ): Promise<Message[]> {
    const params = new URLSearchParams();
    params.set('withUserId', withUserId);
    if (options?.limit != null) params.set('limit', String(options.limit));
    if (options?.before) params.set('before', options.before);
    const qs = params.toString();
    return await firstValueFrom(
      this.http.get<Message[]>(`${this.apiBase}/messages?${qs}`)
    );
  }

  async send(recipientId: string, body: string): Promise<Message> {
    const res = await firstValueFrom(
      this.http.post<Message>(`${this.apiBase}/messages`, { recipientId, body })
    );
    this.unreadCountRefresh$.next();
    return res;
  }

  async markAsRead(messageId: string): Promise<void> {
    await firstValueFrom(
      this.http.patch<void>(`${this.apiBase}/messages/${messageId}/read`, {})
    );
    this.unreadCountRefresh$.next();
  }

  async markConversationAsRead(withUserId: string): Promise<{ updated: number }> {
    const res = await firstValueFrom(
      this.http.post<{ updated: number }>(`${this.apiBase}/messages/mark-read`, {
        conversationWithUserId: withUserId,
      })
    );
    this.unreadCountRefresh$.next();
    return res;
  }

  async markAllAsRead(): Promise<{ updated: number }> {
    const res = await firstValueFrom(
      this.http.post<{ updated: number }>(`${this.apiBase}/messages/mark-read`, {})
    );
    this.unreadCountRefresh$.next();
    return res;
  }
}
