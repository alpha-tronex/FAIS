import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { LandingPage } from './landing.page';

const ROUTES = [{ path: '', component: LandingPage }];

@NgModule({
  declarations: [LandingPage],
  imports: [CommonModule, RouterModule.forChild(ROUTES)]
})
export class LandingModule {}
