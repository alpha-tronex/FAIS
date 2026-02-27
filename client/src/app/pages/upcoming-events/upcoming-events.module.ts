import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { UpcomingEventsPage } from './upcoming-events.page';
import { UPCOMING_EVENTS_ROUTES } from './upcoming-events.routes';

@NgModule({
  declarations: [UpcomingEventsPage],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild(UPCOMING_EVENTS_ROUTES),
    SharedModule,
  ],
})
export class UpcomingEventsModule {}
