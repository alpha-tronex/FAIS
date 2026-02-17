import { Component, signal } from '@angular/core';
import { environment } from '../environments/environment';

@Component({
  standalone: false,
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('client');

  constructor() {
    const theme = environment.theme;
    document.documentElement.dataset['theme'] = theme;
  }
}
