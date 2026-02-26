import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { ResetPasswordPage } from './reset-password.page';

const ROUTES = [{ path: '', component: ResetPasswordPage }];

@NgModule({
  declarations: [ResetPasswordPage],
  imports: [CommonModule, FormsModule, RouterModule.forChild(ROUTES)]
})
export class ResetPasswordModule {}
