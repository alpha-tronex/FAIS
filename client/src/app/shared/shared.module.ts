import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConfirmPopupComponent } from './confirm-popup/confirm-popup.component';
import { SessionExpiryModalComponent } from './session-expiry-modal/session-expiry-modal.component';

@NgModule({
  declarations: [ConfirmPopupComponent, SessionExpiryModalComponent],
  exports: [ConfirmPopupComponent, SessionExpiryModalComponent],
  imports: [CommonModule]
})
export class SharedModule {}
