import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  standalone: false,
  selector: 'app-admin-page',
  templateUrl: './admin.page.html',
  styleUrl: './admin.page.css'
})
export class AdminPage {
  constructor(
    private readonly auth: AuthService,
    private readonly router: Router
  ) {}

  logout() {
    this.auth.logout();
    void this.router.navigateByUrl('/login');
  }
}
