import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { HomePage } from './home.page';
import { HOME_ROUTES } from './home.routes';

@NgModule({
  declarations: [HomePage],
  imports: [
    CommonModule,
    RouterModule.forChild(HOME_ROUTES)
  ]
})
export class HomeModule {}
