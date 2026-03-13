import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { NgbCarouselModule } from '@ng-bootstrap/ng-bootstrap';
import { DemoLandingPage } from './demo-landing.page';
import { DemoOverviewPage } from './demo-overview.page';
import { DemoRequestPage } from './demo-request.page';
import { DEMO_ROUTES } from './demo.routes';

@NgModule({
  declarations: [DemoLandingPage, DemoOverviewPage, DemoRequestPage],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild(DEMO_ROUTES),
    NgbCarouselModule
  ]
})
export class DemoModule {}
// Default export for loadChildren in case the chunk exposes it as default
export default DemoModule;
