import { Component, OnInit } from '@angular/core';
import { AttendanceService, AttendanceRecord } from './attendance.service';

@Component({
  selector: 'app-attendance-list',
  template: `
    <h2>Lista de Asistencia</h2>
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Nombre</th>
          <th>Fecha/Hora</th>
        </tr>
      </thead>
      <tbody>
        <tr *ngFor="let record of attendance">
          <td>{{ record.id }}</td>
          <td>{{ record.name }}</td>
          <td>{{ record.timestamp }}</td>
        </tr>
      </tbody>
    </table>
  `,
  styles: [`
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #ccc; padding: 8px; }
    th { background: #f4f4f4; }
  `]
})
export class AttendanceListComponent implements OnInit {
  attendance: AttendanceRecord[] = [];

  constructor(private attendanceService: AttendanceService) {}

  ngOnInit() {
    this.attendanceService.getAttendance().subscribe(data => {
      this.attendance = data;
    });
  }
}
