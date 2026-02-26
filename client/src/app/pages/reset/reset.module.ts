import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { ResetPage } from './reset.page';

const ROUTES = [{ path: '', component: ResetPage }];

@NgModule({
  declarations: [ResetPage],
  imports: [CommonModule, FormsModule, RouterModule.forChild(ROUTES)]
})
export class ResetModule {}
