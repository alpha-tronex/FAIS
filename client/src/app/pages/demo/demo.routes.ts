import { Routes } from '@angular/router';
import { DemoLandingPage } from './demo-landing.page';
import { DemoOverviewPage } from './demo-overview.page';
import { DemoRequestPage } from './demo-request.page';

export const DEMO_ROUTES: Routes = [
  { path: '', component: DemoLandingPage },
  { path: 'overview', component: DemoOverviewPage },
  { path: 'request', component: DemoRequestPage }
];
