import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { SplashPage } from './splash.page';

const ROUTES = [{ path: '', component: SplashPage }];

@NgModule({
  declarations: [SplashPage],
  imports: [CommonModule, RouterModule.forChild(ROUTES)]
})
export class SplashModule {}
