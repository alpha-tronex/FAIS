import { Component } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { map, Observable } from 'rxjs';
import { DEFAULT_LAYOUT_VERSION } from '../../core/layout-version.config';

const ASSET = (n: number) => `assets/images/demo-attorneys-clients-${n}.gif`;
const PLACEHOLDER = (n: number) =>
  `https://placehold.co/400x300/0d2137/f5f6f8?text=Attorneys+%26+clients+${n}`;

@Component({
  standalone: false,
  selector: 'app-demo-landing-page',
  templateUrl: './demo-landing.page.html',
  styleUrl: './demo-landing.page.css'
})
export class DemoLandingPage {
  /** Layout version from query param v=1, v=2, v=3...; falls back to DEFAULT_LAYOUT_VERSION. */
  readonly layoutVersion$: Observable<number>;

  constructor(private readonly route: ActivatedRoute) {
    this.layoutVersion$ = this.route.queryParamMap.pipe(
      map((q) => {
        const v = q.get('v');
        const n = v ? +v : DEFAULT_LAYOUT_VERSION;
        return Number.isFinite(n) && n >= 1 ? n : DEFAULT_LAYOUT_VERSION;
      })
    );
  }

  gif1Src = ASSET(1);
  gif2Src = ASSET(2);
  gif3Src = ASSET(3);

  onGifError(n: 1 | 2 | 3): void {
    if (n === 1) this.gif1Src = PLACEHOLDER(1);
    else if (n === 2) this.gif2Src = PLACEHOLDER(2);
    else this.gif3Src = PLACEHOLDER(3);
  }
}
