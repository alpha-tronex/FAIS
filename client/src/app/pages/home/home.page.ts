import { Component } from '@angular/core';
import { AuthService } from '../../services/auth.service';

export type HomeTile = {
  label: string;
  route: string | null;
  comingSoon?: boolean;
  icon?: string;
};

@Component({
  standalone: false,
  selector: 'app-home-page',
  templateUrl: './home.page.html',
  styleUrl: './home.page.css'
})
export class HomePage {
  tiles: HomeTile[] = [];

  constructor(private readonly auth: AuthService) {
    this.tiles = this.buildTiles();
  }

  private buildTiles(): HomeTile[] {
    const role = this.auth.getRoleTypeIdFromToken();
    if (role === null) return [];

    // 5 = Admin, 1 = Petitioner, 3 = Petitioner Attorney, 6 = Legal Assistant, 2 = Respondent, 4 = Respondent Attorney
    switch (role) {
      case 5:
        return [
          { label: 'Manage users', route: '/admin/users' },
          { label: 'Cases', route: '/admin/cases' },
          { label: 'Appointments', route: '/upcoming-events' },
          { label: 'Messages', route: '/messages' },
          { label: 'AI reports', route: '/reports/structured' },
          { label: 'Documents', route: null, comingSoon: true }
        ];
      case 1:
        return [
          { label: 'Manage my profile', route: '/profile' },
          { label: 'My cases', route: '/my-cases' },
          { label: 'Appointments', route: '/upcoming-events' },
          { label: 'Messages', route: '/messages' },
          { label: 'Documents', route: null, comingSoon: true }
        ];
      case 3:
      case 6:
        return [
          { label: 'Manage my profile', route: '/profile' },
          { label: 'My cases', route: '/my-cases' },
          { label: 'Appointments', route: '/upcoming-events' },
          { label: 'Messages', route: '/messages' },
          { label: 'AI reports', route: '/reports/structured' },
          { label: 'Documents', route: null, comingSoon: true }
        ];
      case 2:
      case 4:
        return [
          { label: 'My profile', route: '/profile' },
          { label: 'My cases', route: '/my-cases' }
        ];
      default:
        return [
          { label: 'My profile', route: '/profile' },
          { label: 'My cases', route: '/my-cases' }
        ];
    }
  }

}
