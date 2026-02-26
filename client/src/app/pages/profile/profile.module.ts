import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { ProfilePage } from './profile.page';

const ROUTES = [{ path: '', component: ProfilePage }];

@NgModule({
  declarations: [ProfilePage],
  exports: [ProfilePage],
  imports: [CommonModule, FormsModule, RouterModule.forChild(ROUTES)]
})
export class ProfileModule {}
