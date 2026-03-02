import { Component, OnInit, OnDestroy } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { AppointmentsService } from '../../services/appointments.service';
import { MessagesService } from '../../services/messages.service';
import type { Subscription } from 'rxjs';

/** 24x24 outline icon paths (Heroicons-style) */
const TILE_ICONS: Record<string, string> = {
  users:
    'M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z',
  cases:
    'M2.25 12.75V12a2.25 2.25 0 0 1 2.25-2.25h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 19.5 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z',
  calendar:
    'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5',
  messages:
    'M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z',
  reports:
    'M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z',
  documents:
    'M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z',
  profile:
    'M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z',
  currency:
    'M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z'
};

export type HomeTile = {
  label: string;
  route: string | null;
  comingSoon?: boolean;
  icon: string;
};

@Component({
  standalone: false,
  selector: 'app-home-page',
  templateUrl: './home.page.html',
  styleUrl: './home.page.css'
})
export class HomePage implements OnInit, OnDestroy {
  tiles: HomeTile[] = [];
  readonly iconPaths = TILE_ICONS;
  /** Count of pending actions for the Appointments tile badge. */
  pendingActionsCount = 0;
  /** Count of unread messages for the Messages tile badge. */
  unreadMessagesCount = 0;
  private refreshSub: Subscription | null = null;
  private messagesRefreshSub: Subscription | null = null;

  constructor(
    private readonly auth: AuthService,
    private readonly appointmentsApi: AppointmentsService,
    private readonly messagesApi: MessagesService
  ) {
    this.tiles = this.buildTiles();
  }

  ngOnInit(): void {
    if (this.auth.hasRole(1, 3, 5, 6)) {
      this.loadPendingActionsCount();
      this.loadUnreadMessagesCount();
    }
    this.refreshSub = this.appointmentsApi.getPendingActionsRefresh().subscribe(() => {
      if (this.auth.hasRole(1, 3, 5, 6)) this.loadPendingActionsCount();
    });
    this.messagesRefreshSub = this.messagesApi.getUnreadCountRefresh().subscribe(() => {
      if (this.auth.hasRole(1, 3, 5, 6)) this.loadUnreadMessagesCount();
    });
  }

  ngOnDestroy(): void {
    this.refreshSub?.unsubscribe();
    this.messagesRefreshSub?.unsubscribe();
  }

  getIconPath(icon: string): string {
    return this.iconPaths[icon] ?? this.iconPaths['profile'];
  }

  /** Badge count for tile (pending actions or unread messages); 0 if none. */
  getBadgeCount(tile: HomeTile): number {
    if (!tile.route) return 0;
    if (tile.route === '/upcoming-events') return this.pendingActionsCount;
    if (tile.route === '/messages') return this.unreadMessagesCount;
    return 0;
  }

  private loadPendingActionsCount(): void {
    this.appointmentsApi.getPendingActionsCount()
      .then((res) => { this.pendingActionsCount = res.count; })
      .catch(() => { this.fallbackPendingActionsCount(); });
  }

  private loadUnreadMessagesCount(): void {
    this.messagesApi.getUnreadCount()
      .then((res) => { this.unreadMessagesCount = res.count; })
      .catch(() => { this.unreadMessagesCount = 0; });
  }

  private fallbackPendingActionsCount(): void {
    const role = this.auth.getRoleTypeIdFromToken();
    if (role === null) {
      this.pendingActionsCount = 0;
      return;
    }
    this.appointmentsApi.list()
      .then((items) => {
        const needPending = role === 1 ? 'pending' : 'reschedule_requested';
        this.pendingActionsCount = items.filter((a) => a.status === needPending).length;
      })
      .catch(() => { this.pendingActionsCount = 0; });
  }

  private buildTiles(): HomeTile[] {
    const role = this.auth.getRoleTypeIdFromToken();
    if (role === null) return [];

    // 5 = Admin, 1 = Petitioner, 3 = Petitioner Attorney, 6 = Legal Assistant, 2 = Respondent, 4 = Respondent Attorney
    switch (role) {
      case 5:
        return [
          { label: 'Manage users', route: '/admin/users', icon: 'users' },
          { label: 'Cases', route: '/admin/cases', icon: 'cases' },
          { label: 'Appointments', route: '/upcoming-events', icon: 'calendar' },
          { label: 'Messages', route: '/messages', icon: 'messages' },
          { label: 'AI Query', route: '/admin/query', icon: 'reports' },
          { label: 'Documents', route: null, comingSoon: true, icon: 'documents' }
        ];
      case 1:
        return [
          { label: 'Manage my profile', route: '/profile', icon: 'profile' },
          { label: 'My cases', route: '/my-cases', icon: 'cases' },
          { label: 'Appointments', route: '/upcoming-events', icon: 'calendar' },
          { label: 'Messages', route: '/messages', icon: 'messages' },
          { label: 'Pay a Bill', route: null, comingSoon: true, icon: 'currency' },
          { label: 'Documents', route: null, comingSoon: true, icon: 'documents' }
        ];
      case 3:
      case 6:
        return [
          { label: 'Manage my profile', route: '/profile', icon: 'profile' },
          { label: 'My cases', route: '/my-cases', icon: 'cases' },
          { label: 'Appointments', route: '/upcoming-events', icon: 'calendar' },
          { label: 'Messages', route: '/messages', icon: 'messages' },
          { label: 'Documents', route: null, comingSoon: true, icon: 'documents' }
        ];
      case 2:
      case 4:
        return [
          { label: 'My profile', route: '/profile', icon: 'profile' },
          { label: 'My cases', route: '/my-cases', icon: 'cases' }
        ];
      default:
        return [
          { label: 'My profile', route: '/profile', icon: 'profile' },
          { label: 'My cases', route: '/my-cases', icon: 'cases' }
        ];
    }
  }

}
