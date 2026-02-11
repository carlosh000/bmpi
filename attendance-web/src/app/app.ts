
import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AttendanceListComponent } from './attendance-list.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, AttendanceListComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('attendance-web');
}
