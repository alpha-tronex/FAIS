import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ConfirmPopupComponent } from './confirm-popup/confirm-popup.component';
import { SessionExpiryModalComponent } from './session-expiry-modal/session-expiry-modal.component';
import { AppointmentPickerComponent } from './appointment-picker/appointment-picker.component';

@NgModule({
  declarations: [ConfirmPopupComponent, SessionExpiryModalComponent, AppointmentPickerComponent],
  exports: [ConfirmPopupComponent, SessionExpiryModalComponent, AppointmentPickerComponent],
  imports: [CommonModule, FormsModule]
})
export class SharedModule {}
