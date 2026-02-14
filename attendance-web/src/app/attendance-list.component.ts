import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { AttendanceService, AttendanceRecord, EmbeddingResult } from './attendance.service';

interface EmbeddingAssignment {
  employeeId: number;
  employeeName: string;
  fileName: string;
  dimensions: number;
  createdAt: string;
}

@Component({
  selector: 'app-attendance-list',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="attendance-container">
      <header>
        <h2>Gestión de Asistencia y Embeddings</h2>
        <p class="description">
          Administra registros de asistencia y prepara embeddings faciales por empleado desde carpetas de fotos.
        </p>
      </header>

      <section class="panel">
        <h3>1) Embeddings por carpeta</h3>
        <div class="toolbar">
          <button type="button" (click)="openFolderPicker()">Cargar carpeta de fotos</button>
          <button type="button" [disabled]="selectedPhotos.length === 0 || isExtracting" (click)="confirmEmbeddingExtraction()">
            {{ isExtracting ? 'Extrayendo...' : 'Extraer embeddings' }}
          </button>
        </div>

        <input
          #photoFolderInput
          class="hidden-input"
          type="file"
          multiple
          accept="image/*"
          (change)="onPhotoFolderSelected($event)"
          webkitdirectory
          directory
        />

        <p *ngIf="selectedPhotos.length > 0" class="status">
          {{ selectedPhotos.length }} foto(s) listas para procesar.
        </p>
        <p *ngIf="message" class="status">{{ message }}</p>
        <p *ngIf="errorMessage" class="error">{{ errorMessage }}</p>

        <div *ngIf="processedEmbeddings.length > 0" class="embedding-results">
          <h4>Resultado de extracción</h4>
          <ul>
            <li *ngFor="let embedding of processedEmbeddings">
              <strong>{{ embedding.fileName }}</strong>
              <span>dim={{ embedding.dimensions }} · [{{ embedding.embedding.slice(0, 5).join(', ') }}...]</span>
            </li>
          </ul>
        </div>

        <form class="assign-form" (submit)="$event.preventDefault(); assignCurrentEmbedding()">
          <h4>Asignar embedding a empleado</h4>
          <div class="form-grid">
            <label>
              Nombre del embedding / empleado
              <input
                type="text"
                [value]="embeddingNameInput"
                (input)="embeddingNameInput = readInputValue($event)"
                placeholder="Ej: Juan Pérez"
              />
            </label>
            <button type="submit" [disabled]="processedEmbeddings.length === 0 || !embeddingNameInput.trim()">
              Asignar ID y guardar
            </button>
          </div>
        </form>

        <table class="mini-table" *ngIf="embeddingAssignments.length > 0">
          <thead>
            <tr>
              <th>ID</th>
              <th>Nombre</th>
              <th>Archivo</th>
              <th>Dimensiones</th>
              <th>Creado</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let item of embeddingAssignments">
              <td>{{ item.employeeId }}</td>
              <td>{{ item.employeeName }}</td>
              <td>{{ item.fileName }}</td>
              <td>{{ item.dimensions }}</td>
              <td>{{ item.createdAt }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="panel">
        <h3>2) Registros de asistencia (CRUD)</h3>
        <div class="toolbar compact">
          <button type="button" (click)="startCreateRecord()">Añadir registro</button>
          <button type="button" [disabled]="attendance.length === 0" (click)="exportAsExcel()">Exportar Excel (CSV)</button>
          <button type="button" [disabled]="attendance.length === 0" (click)="exportAsPdf()">Exportar PDF</button>
          <button type="button" (click)="openImportPicker()">Importar lista (CSV)</button>
        </div>

        <input
          #listImportInput
          class="hidden-input"
          type="file"
          accept=".csv,text/csv"
          (change)="onListImported($event)"
        />

        <form *ngIf="isEditing || isCreating" class="record-form" (submit)="$event.preventDefault(); saveRecord()">
          <div class="form-grid three">
            <label>
              ID
              <input
                type="number"
                [disabled]="isEditing"
                [value]="editingRecord.id"
                (input)="editingRecord.id = readInputNumber($event, editingRecord.id)"
              />
            </label>
            <label>
              Nombre
              <input
                type="text"
                [value]="editingRecord.name"
                (input)="editingRecord.name = readInputValue($event)"
                placeholder="Nombre empleado"
              />
            </label>
            <label>
              Fecha/Hora
              <input
                type="datetime-local"
                [value]="editingRecord.timestamp"
                (input)="editingRecord.timestamp = readInputValue($event)"
              />
            </label>
          </div>
          <div class="toolbar compact">
            <button type="submit">Guardar</button>
            <button type="button" class="danger" (click)="cancelRecordEditor()">Cancelar</button>
          </div>
        </form>

        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Nombre</th>
              <th>Fecha/Hora</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let record of attendance">
              <td>{{ record.id }}</td>
              <td>{{ record.name }}</td>
              <td>{{ record.timestamp }}</td>
              <td class="actions">
                <button type="button" class="small" (click)="editRecord(record)">Editar</button>
                <button type="button" class="small danger" (click)="deleteRecord(record.id)">Eliminar</button>
              </td>
            </tr>
            <tr *ngIf="attendance.length === 0">
              <td colspan="4" class="empty">Sin registros disponibles.</td>
            </tr>
          </tbody>
        </table>
      </section>
    </section>
  `,
  styles: [
    `
      .attendance-container { margin: 2rem auto; max-width: 1040px; font-family: Arial, sans-serif; display: grid; gap: 1.5rem; }
      .description { color: #4b5563; margin-top: 0.25rem; }
      .panel { border: 1px solid #dbeafe; border-radius: 10px; padding: 1rem; background: #f8fbff; }
      .toolbar { display: flex; flex-wrap: wrap; gap: 0.75rem; margin: 1rem 0; }
      .toolbar.compact { margin: 0.75rem 0; }
      button { background: #2563eb; border: none; border-radius: 6px; color: #fff; cursor: pointer; font-size: 0.92rem; padding: 0.55rem 0.85rem; }
      button.small { padding: 0.35rem 0.6rem; font-size: 0.84rem; }
      button.danger { background: #dc2626; }
      button:disabled { background: #94a3b8; cursor: not-allowed; }
      .hidden-input { display: none; }
      .status { margin: 0.35rem 0; color: #0f172a; }
      .error { margin: 0.35rem 0; color: #b91c1c; }
      .form-grid { display: grid; gap: 0.75rem; grid-template-columns: 2fr auto; align-items: end; }
      .form-grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      label { display: grid; gap: 0.35rem; font-size: 0.88rem; color: #334155; }
      input { border: 1px solid #cbd5e1; border-radius: 6px; padding: 0.5rem; }
      table { border-collapse: collapse; width: 100%; margin-top: 0.75rem; }
      th, td { border: 1px solid #d1d5db; padding: 0.65rem; }
      th { background: #eff6ff; text-align: left; }
      .actions { display: flex; gap: 0.5rem; }
      .empty { color: #6b7280; text-align: center; }
      .embedding-results { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; margin-top: 1rem; padding: 0.75rem; }
      .embedding-results ul { list-style: none; margin: 0; padding: 0; }
      .embedding-results li { align-items: baseline; display: flex; gap: 0.75rem; padding: 0.25rem 0; }
      .embedding-results span { color: #475569; font-family: 'Courier New', monospace; }
      .mini-table { margin-top: 1rem; }
    `,
  ],
})
export class AttendanceListComponent implements OnInit {
  @ViewChild('photoFolderInput') photoFolderInput?: ElementRef<HTMLInputElement>;
  @ViewChild('listImportInput') listImportInput?: ElementRef<HTMLInputElement>;

  attendance: AttendanceRecord[] = [];
  selectedPhotos: File[] = [];
  processedEmbeddings: EmbeddingResult[] = [];
  embeddingAssignments: EmbeddingAssignment[] = [];
  embeddingNameInput = '';

  isExtracting = false;
  message = '';
  errorMessage = '';

  isEditing = false;
  isCreating = false;
  editingRecord: AttendanceRecord = this.emptyRecord();

  constructor(private attendanceService: AttendanceService) {}

  ngOnInit(): void {
    this.loadAttendance();
  }

  loadAttendance(): void {
    this.attendanceService.getAttendance().subscribe({
      next: (data) => {
        this.attendance = data;
        this.errorMessage = '';
      },
      error: () => {
        this.attendance = [];
        this.errorMessage = 'No se pudo cargar asistencia desde backend. Puedes gestionar registros localmente.';
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
    this.errorMessage = '';
    (event.target as HTMLInputElement).value = '';
  }

  async confirmEmbeddingExtraction(): Promise<void> {
    const shouldProcess = window.confirm(
      `Se encontraron ${this.selectedPhotos.length} foto(s). ¿Confirmas iniciar la extracción de embeddings?`,
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
          this.message = `Embeddings procesados: ${response.results.length}. Ahora asigna nombre para registrar ID.`;
          if (response.errors.length > 0) {
            this.errorMessage = response.errors.join(' | ');
          }
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

  assignCurrentEmbedding(): void {
    if (this.processedEmbeddings.length === 0 || !this.embeddingNameInput.trim()) {
      return;
    }

    const name = this.embeddingNameInput.trim();
    const createdAt = new Date().toLocaleString();
    const currentMaxId = this.embeddingAssignments.reduce((max, item) => Math.max(max, item.employeeId), 0);

    this.processedEmbeddings.forEach((embedding, index) => {
      this.embeddingAssignments.unshift({
        employeeId: currentMaxId + index + 1,
        employeeName: name,
        fileName: embedding.fileName,
        dimensions: embedding.dimensions,
        createdAt,
      });
    });

    this.message = `Se registraron ${this.processedEmbeddings.length} embedding(s) para ${name}.`;
    this.embeddingNameInput = '';
    this.processedEmbeddings = [];
    this.selectedPhotos = [];
  }

  startCreateRecord(): void {
    this.isCreating = true;
    this.isEditing = false;
    this.editingRecord = {
      id: this.getNextAttendanceId(),
      name: '',
      timestamp: this.toDateTimeLocal(new Date().toISOString()),
    };
  }

  editRecord(record: AttendanceRecord): void {
    this.isEditing = true;
    this.isCreating = false;
    this.editingRecord = {
      id: record.id,
      name: record.name,
      timestamp: this.toDateTimeLocal(record.timestamp),
    };
  }

  saveRecord(): void {
    const normalized: AttendanceRecord = {
      id: Number(this.editingRecord.id) || this.getNextAttendanceId(),
      name: this.editingRecord.name.trim() || 'Sin nombre',
      timestamp: this.editingRecord.timestamp || this.toDateTimeLocal(new Date().toISOString()),
    };

    if (this.isEditing) {
      this.attendance = this.attendance.map((record) => (record.id === normalized.id ? normalized : record));
      this.message = `Registro ${normalized.id} actualizado.`;
    } else {
      this.attendance = [normalized, ...this.attendance];
      this.message = `Registro ${normalized.id} agregado.`;
    }

    this.cancelRecordEditor();
  }

  deleteRecord(id: number): void {
    const shouldDelete = window.confirm(`¿Eliminar registro ${id}? Esta acción no se puede deshacer.`);
    if (!shouldDelete) {
      return;
    }

    this.attendance = this.attendance.filter((record) => record.id !== id);
    this.message = `Registro ${id} eliminado.`;
  }

  cancelRecordEditor(): void {
    this.isCreating = false;
    this.isEditing = false;
    this.editingRecord = this.emptyRecord();
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

  readInputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  readInputNumber(event: Event, fallback: number): number {
    const value = Number((event.target as HTMLInputElement).value);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private emptyRecord(): AttendanceRecord {
    return {
      id: 0,
      name: '',
      timestamp: '',
    };
  }

  private getNextAttendanceId(): number {
    return this.attendance.reduce((max, record) => Math.max(max, record.id), 0) + 1;
  }

  private toDateTimeLocal(dateValue: string): string {
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
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
