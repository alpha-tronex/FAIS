import { NgModule, provideZoneChangeDetection } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { App } from './app';
import { routes } from './app.routes';
import { authInterceptor } from './core/auth.interceptor';
import { unauthInterceptor } from './core/unauth.interceptor';

import { SharedModule } from './shared/shared.module';
import { AppLayoutComponent } from './layout/app-layout.component';
import { HeaderComponent } from './layout/header/header.component';
import { FooterComponent } from './layout/footer/footer.component';

@NgModule({
  declarations: [App, AppLayoutComponent, HeaderComponent, FooterComponent],
  imports: [BrowserModule, FormsModule, RouterModule.forRoot(routes), SharedModule],
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideHttpClient(withInterceptors([authInterceptor, unauthInterceptor]))
  ],
  bootstrap: [App]
})
export class AppModule {}
