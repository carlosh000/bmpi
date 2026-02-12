import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Component, ElementRef, Inject, OnInit, PLATFORM_ID, ViewChild } from '@angular/core';
import {
  AttendanceService,
  AttendanceRecord,
  EmbeddingResult,
  RegisterEmployeeResponse,
} from './attendance.service';

@Component({
  selector: 'app-attendance-list',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="attendance-container">
      <header>
        <h2>Tabla de Asistencia</h2>
        <p class="description">
          Carga fotos por carpeta para extraer embeddings reales desde backend e importa/exporta listas.
        </p>
      </header>

      <div class="toolbar">
        <button type="button" (click)="openFolderPicker()">Cargar fotos (carpeta)</button>
        <button type="button" [disabled]="selectedPhotos.length === 0 || isExtracting" (click)="confirmEmbeddingExtraction()">
          {{ isExtracting ? 'Extrayendo...' : 'Extraer embeddings' }}
        </button>
        <button type="button" [disabled]="attendance.length === 0" (click)="exportAsExcel()">
          Exportar Excel (CSV)
        </button>
        <button type="button" [disabled]="attendance.length === 0" (click)="exportAsPdf()">Exportar PDF</button>
        <button type="button" (click)="openImportPicker()">Importar lista (CSV)</button>
      </div>

      <input
        #photoFolderInput
        id="photo-folder-input"
        class="hidden-input"
        type="file"
        multiple
        accept="image/*"
        (change)="onPhotoFolderSelected($event)"
        webkitdirectory
        directory
      />

      <input
        #listImportInput
        id="list-import-input"
        class="hidden-input"
        type="file"
        accept=".csv,text/csv"
        (change)="onListImported($event)"
      />

      <p *ngIf="selectedPhotos.length > 0" class="status">
        {{ selectedPhotos.length }} foto(s) listas para procesar embeddings.
      </p>
      <p *ngIf="message" class="status">{{ message }}</p>
      <p *ngIf="errorMessage" class="error">{{ errorMessage }}</p>

      <section class="register-box">
        <h3>Registrar empleado (guarda embedding en DB)</h3>
        <p class="description">Usa la primera foto seleccionada para registrar al empleado en PostgreSQL.</p>
        <div class="register-form">
          <input #employeeNameInput type="text" placeholder="Nombre" />
          <input #employeeIdInput type="text" placeholder="ID empleado" />
          <button
            type="button"
            [disabled]="selectedPhotos.length === 0 || isRegistering"
            (click)="registerSelectedPhoto(employeeNameInput.value, employeeIdInput.value)"
          >
            {{ isRegistering ? 'Registrando...' : 'Registrar empleado' }}
          </button>
        </div>
        <p *ngIf="registerMessage" class="status">{{ registerMessage }}</p>
      </section>

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
          <tr *ngIf="attendance.length === 0">
            <td colspan="3" class="empty">Sin registros disponibles.</td>
          </tr>
        </tbody>
      </table>

      <section *ngIf="processedEmbeddings.length > 0" class="embedding-results">
        <h3>Embeddings generados (backend)</h3>
        <ul>
          <li *ngFor="let embedding of processedEmbeddings">
            <strong>{{ embedding.fileName }}</strong>
            <span>dim={{ embedding.dimensions }} · [{{ embedding.embedding.slice(0, 5).join(', ') }}...]</span>
          </li>
        </ul>
      </section>
    </section>
  `,
  styles: [
    `
      .attendance-container { margin: 2rem auto; max-width: 960px; font-family: Arial, sans-serif; }
      .description { color: #4b5563; margin-top: 0.25rem; }
      .toolbar { display: flex; flex-wrap: wrap; gap: 0.75rem; margin: 1.25rem 0; }
      button { background: #2563eb; border: none; border-radius: 6px; color: #fff; cursor: pointer; font-size: 0.92rem; padding: 0.6rem 0.9rem; }
      button:disabled { background: #94a3b8; cursor: not-allowed; }
      .hidden-input { display: none; }
      .status { margin: 0.35rem 0; color: #0f172a; }
      .error { margin: 0.35rem 0; color: #b91c1c; }
      table { border-collapse: collapse; width: 100%; margin-top: 0.75rem; }
      th, td { border: 1px solid #d1d5db; padding: 0.65rem; }
      th { background: #eff6ff; text-align: left; }
      .empty { color: #6b7280; text-align: center; }
      .register-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; margin-top: 1rem; padding: 1rem; }
      .register-form { display: flex; flex-wrap: wrap; gap: 0.6rem; margin-top: 0.75rem; }
      .register-form input { border: 1px solid #cbd5e1; border-radius: 6px; padding: 0.55rem 0.7rem; }
      .embedding-results { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; margin-top: 1.25rem; padding: 1rem; }
      .embedding-results ul { list-style: none; margin: 0; padding: 0; }
      .embedding-results li { align-items: baseline; display: flex; gap: 0.75rem; padding: 0.3rem 0; }
      .embedding-results span { color: #475569; font-family: 'Courier New', monospace; }
    `,
  ],
})
export class AttendanceListComponent implements OnInit {
  @ViewChild('photoFolderInput') photoFolderInput?: ElementRef<HTMLInputElement>;
  @ViewChild('listImportInput') listImportInput?: ElementRef<HTMLInputElement>;

  attendance: AttendanceRecord[] = [];
  selectedPhotos: File[] = [];
  processedEmbeddings: EmbeddingResult[] = [];
  isExtracting = false;
  isRegistering = false;
  message = '';
  registerMessage = '';
  errorMessage = '';

  constructor(
    private attendanceService: AttendanceService,
    @Inject(PLATFORM_ID) private platformId: object,
  ) {}

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.loadAttendance();
    }
  }

  loadAttendance(): void {
    this.attendanceService.getAttendance().subscribe({
      next: (data) => {
        this.attendance = data;
        this.errorMessage = '';
      },
      error: () => {
        this.attendance = [];
        this.errorMessage = 'No se pudo cargar asistencia desde backend.';
      },
    });
  }

  openFolderPicker(): void {
    this.photoFolderInput?.nativeElement.click();
  }

  openImportPicker(): void {
    this.listImportInput?.nativeElement.click();
  }

  onPhotoFolderSelected(event: Event): void {
    const files = (event.target as HTMLInputElement).files;
    this.selectedPhotos = files ? Array.from(files).filter((file) => file.type.startsWith('image/')) : [];
    this.processedEmbeddings = [];
    this.message = '';
    this.registerMessage = '';
    this.errorMessage = '';
    (event.target as HTMLInputElement).value = '';
  }

  async confirmEmbeddingExtraction(): Promise<void> {
    const shouldProcess = window.confirm(
      `Se encontraron ${this.selectedPhotos.length} foto(s). ¿Deseas extraer embeddings ahora?`,
    );

    if (!shouldProcess) {
      return;
    }

    this.isExtracting = true;
    this.errorMessage = '';
    this.message = 'Procesando imágenes en backend...';

    try {
      const files = await Promise.all(this.selectedPhotos.map((file) => this.fileToBase64(file)));
      this.attendanceService.extractEmbeddings(files).subscribe({
        next: (response) => {
          this.processedEmbeddings = response.results;
          if (response.errors.length > 0) {
            this.errorMessage = response.errors.join(' | ');
          }
          this.message = `Embeddings procesados: ${response.results.length}`;
          this.isExtracting = false;
        },
        error: () => {
          this.isExtracting = false;
          this.errorMessage = 'Falló la extracción de embeddings en backend.';
          this.message = '';
        },
      });
    } catch {
      this.isExtracting = false;
      this.errorMessage = 'No se pudieron leer las imágenes seleccionadas.';
      this.message = '';
    }
  }

  async registerSelectedPhoto(name: string, employeeId: string): Promise<void> {
    const normalizedName = name.trim();
    const normalizedId = employeeId.trim();

    if (!normalizedName || !normalizedId) {
      this.errorMessage = 'Nombre e ID de empleado son obligatorios.';
      return;
    }

    if (this.selectedPhotos.length === 0) {
      this.errorMessage = 'Selecciona al menos una foto para registrar.';
      return;
    }

    this.isRegistering = true;
    this.errorMessage = '';
    this.registerMessage = '';

    try {
      const firstPhoto = await this.fileToBase64(this.selectedPhotos[0]);
      this.attendanceService
        .registerEmployee({ name: normalizedName, employee_id: normalizedId, image: firstPhoto.data })
        .subscribe({
          next: (response: RegisterEmployeeResponse) => {
            this.isRegistering = false;
            this.registerMessage = response.message || 'Empleado registrado correctamente.';
            if (response.success) {
              this.loadAttendance();
            } else {
              this.errorMessage = response.message || 'No se pudo registrar el empleado.';
            }
          },
          error: () => {
            this.isRegistering = false;
            this.errorMessage = 'Error al registrar empleado en backend.';
          },
        });
    } catch {
      this.isRegistering = false;
      this.errorMessage = 'No se pudo leer la foto seleccionada.';
    }
  }

  exportAsExcel(): void {
    const headers = ['id', 'name', 'timestamp'];
    const rows = this.attendance.map((record) => [record.id, record.name, record.timestamp]);
    this.downloadCsv('asistencia.csv', [headers, ...rows]);
  }

  exportAsPdf(): void {
    const tableHtml = `
      <h2>Reporte de asistencia</h2>
      <table border="1" cellspacing="0" cellpadding="6">
        <thead><tr><th>ID</th><th>Nombre</th><th>Fecha/Hora</th></tr></thead>
        <tbody>
          ${this.attendance
            .map(
              (record) =>
                `<tr><td>${record.id}</td><td>${record.name}</td><td>${record.timestamp}</td></tr>`,
            )
            .join('')}
        </tbody>
      </table>
    `;

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      this.errorMessage = 'No se pudo abrir ventana de impresión para PDF.';
      return;
    }

    printWindow.document.write(`<html><body>${tableHtml}</body></html>`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }

  onListImported(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const csv = `${reader.result ?? ''}`;
      const imported = this.parseCsv(csv);
      if (imported.length > 0) {
        this.attendance = imported;
        this.errorMessage = '';
      } else {
        this.errorMessage = 'CSV inválido: verifica encabezados y columnas.';
      }
    };

    reader.readAsText(file);
    input.value = '';
  }

  private parseCsv(csv: string): AttendanceRecord[] {
    const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length <= 1) {
      return [];
    }

    const headers = this.parseCsvRow(lines[0]).map((value) => value.trim().toLowerCase());
    if (headers.length < 3 || headers[0] !== 'id' || headers[1] !== 'name' || headers[2] !== 'timestamp') {
      return [];
    }

    return lines.slice(1).map((line, index) => {
      const [id, name, timestamp] = this.parseCsvRow(line);
      return {
        id: Number(id) || index + 1,
        name: (name || 'Sin nombre').trim(),
        timestamp: (timestamp || new Date().toISOString()).trim(),
      };
    });
  }

  private parseCsvRow(line: string): string[] {
    const values: string[] = [];
    let value = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (char === '"' && inQuotes && nextChar === '"') {
        value += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(value);
        value = '';
      } else {
        value += char;
      }
    }

    values.push(value);
    return values;
  }

  private downloadCsv(fileName: string, rows: (string | number)[][]): void {
    const csvContent = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  private fileToBase64(file: File): Promise<{ name: string; data: string }> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result !== 'string') {
          reject(new Error('invalid file payload'));
          return;
        }
        resolve({ name: file.name, data: reader.result });
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }
}
