import { Component } from '@angular/core';
import { SessionIdleService } from '../../services/session-idle.service';

@Component({
  standalone: false,
  selector: 'app-session-expiry-modal',
  templateUrl: './session-expiry-modal.component.html',
  styleUrl: './session-expiry-modal.component.css'
})
export class SessionExpiryModalComponent {
  constructor(protected readonly sessionIdle: SessionIdleService) {}

  formatCountdown(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  stayLoggedIn(): void {
    void this.sessionIdle.stayLoggedIn();
  }

  logOut(): void {
    this.sessionIdle.logOut();
  }
}
