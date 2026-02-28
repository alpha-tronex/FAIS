import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ConfirmPopupComponent } from './confirm-popup/confirm-popup.component';
import { SessionExpiryModalComponent } from './session-expiry-modal/session-expiry-modal.component';
import { AppointmentPickerComponent } from './appointment-picker/appointment-picker.component';
import { AppointmentAvailabilityGridComponent } from './appointment-availability-grid/appointment-availability-grid.component';
import { SchedulePopupComponent } from './schedule-popup/schedule-popup.component';

@NgModule({
  declarations: [
    ConfirmPopupComponent,
    SessionExpiryModalComponent,
    AppointmentPickerComponent,
    AppointmentAvailabilityGridComponent,
    SchedulePopupComponent,
  ],
  exports: [
    ConfirmPopupComponent,
    SessionExpiryModalComponent,
    AppointmentPickerComponent,
    AppointmentAvailabilityGridComponent,
    SchedulePopupComponent,
  ],
  imports: [CommonModule, FormsModule]
})
export class SharedModule {}
