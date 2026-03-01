import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { MessagesPage } from './messages.page';
import { MESSAGES_ROUTES } from './messages.routes';

@NgModule({
  declarations: [MessagesPage],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild(MESSAGES_ROUTES),
    SharedModule,
  ],
})
export class MessagesModule {}
