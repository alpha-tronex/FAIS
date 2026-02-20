import { NgModule, provideZoneChangeDetection } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { App } from './app';
import { routes } from './app.routes';
import { authInterceptor } from './core/auth.interceptor';

import { LoginPage } from './pages/login/login.page';
import { RegisterPage } from './pages/register/register.page';
import { ResetPage } from './pages/reset/reset.page';
import { UsersPage } from './pages/users/users.page';
import { CasesPage } from './pages/cases/cases.page';
import { MyCasesPage } from './pages/my-cases/my-cases.page';
import { AffidavitPage } from './pages/affidavit/affidavit.page';
import { AffidavitEditPage } from './pages/affidavit-edit/affidavit-edit.page';
import { ProfilePage } from './pages/profile/profile.page';
import { AdminPage } from './pages/admin/admin.page';
import { AdminAffidavitPage } from './pages/admin-affidavit/admin-affidavit.page';
import { AffidavitEmploymentSectionComponent } from './pages/affidavit-edit/sections/affidavit-employment-section.component';
import { AffidavitMonthlyLinesSectionComponent } from './pages/affidavit-edit/sections/affidavit-monthly-lines-section.component';
import { AffidavitAssetsSectionComponent } from './pages/affidavit-edit/sections/affidavit-assets-section.component';
import { AffidavitLiabilitiesSectionComponent } from './pages/affidavit-edit/sections/affidavit-liabilities-section.component';
import { ConfirmPopupComponent } from './shared/confirm-popup/confirm-popup.component';

@NgModule({
  declarations: [
    App,
    LoginPage,
    RegisterPage,
    ResetPage,
    UsersPage,
    CasesPage,
    MyCasesPage,
    AffidavitPage,
    AffidavitEditPage,
    ProfilePage,
    AffidavitEmploymentSectionComponent,
    AffidavitMonthlyLinesSectionComponent,
    AffidavitAssetsSectionComponent,
    AffidavitLiabilitiesSectionComponent,
    AdminPage,
    AdminAffidavitPage,
    ConfirmPopupComponent
  ],
  imports: [BrowserModule, FormsModule, RouterModule.forRoot(routes)],
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideHttpClient(withInterceptors([authInterceptor]))
  ],
  bootstrap: [App]
})
export class AppModule {}
