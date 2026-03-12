import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { DemoPage } from './demo.page';
import { DEMO_ROUTES } from './demo.routes';

@NgModule({
  declarations: [DemoPage],
  imports: [CommonModule, FormsModule, RouterModule.forChild(DEMO_ROUTES)]
})
export class DemoModule {}
