import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { LoginPage } from './login.page';

const ROUTES = [{ path: '', component: LoginPage }];

@NgModule({
  declarations: [LoginPage],
  imports: [CommonModule, FormsModule, RouterModule.forChild(ROUTES)]
})
export class LoginModule {}
