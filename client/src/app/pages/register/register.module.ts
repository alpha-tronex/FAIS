import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { RegisterPage } from './register.page';

const ROUTES = [{ path: '', component: RegisterPage }];

@NgModule({
  declarations: [RegisterPage],
  imports: [CommonModule, FormsModule, RouterModule.forChild(ROUTES)]
})
export class RegisterModule {}
