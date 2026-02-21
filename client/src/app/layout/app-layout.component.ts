import { Component } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  standalone: false,
  selector: 'app-layout',
  templateUrl: './app-layout.component.html',
  styleUrl: './app-layout.component.css'
})
export class AppLayoutComponent {
  constructor(private readonly router: Router) {}

  /** Show header and footer only when not on login/register/reset (or root redirect). */
  get showChrome(): boolean {
    const url = this.router.url;
    const path = url.split('?')[0];
    return path !== '/login' && path !== '/register' && path !== '/reset' && path !== '';
  }
}
