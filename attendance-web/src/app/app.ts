
import { Component, signal } from '@angular/core';
import { AttendanceListComponent } from './attendance-list.component';

@Component({
  selector: 'app-root',
  imports: [AttendanceListComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('attendance-web');
}
