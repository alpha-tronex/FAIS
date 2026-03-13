import { Component } from '@angular/core';

const ASSET = (n: number) => `assets/images/demo-attorneys-clients-${n}.gif`;
const PLACEHOLDER = (n: number) =>
  `https://placehold.co/400x300/1a3a4f/efe9e2?text=Attorneys+%26+clients+${n}`;

@Component({
  standalone: false,
  selector: 'app-demo-landing-page',
  templateUrl: './demo-landing.page.html',
  styleUrl: './demo-landing.page.css'
})
export class DemoLandingPage {
  gif1Src = ASSET(1);
  gif2Src = ASSET(2);
  gif3Src = ASSET(3);

  onGifError(n: 1 | 2 | 3): void {
    if (n === 1) this.gif1Src = PLACEHOLDER(1);
    else if (n === 2) this.gif2Src = PLACEHOLDER(2);
    else this.gif3Src = PLACEHOLDER(3);
  }
}
