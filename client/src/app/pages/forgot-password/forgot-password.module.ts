import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { ForgotPasswordPage } from './forgot-password.page';

const ROUTES = [{ path: '', component: ForgotPasswordPage }];

@NgModule({
  declarations: [ForgotPasswordPage],
  imports: [CommonModule, FormsModule, RouterModule.forChild(ROUTES)]
})
export class ForgotPasswordModule {}
