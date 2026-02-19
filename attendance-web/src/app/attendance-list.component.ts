import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Component, ElementRef, Inject, OnInit, PLATFORM_ID, ViewChild } from '@angular/core';
import { AttendanceService, AttendanceRecord, EmbeddingResult, EmployeeStorageRecord } from './attendance.service';
import { firstValueFrom } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';

interface EmbeddingAssignment {
  employeeId: number;
  employeeName: string;
  fileName: string;
  dimensions: number;
  createdAt: string;
  source?: 'db' | 'session';
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
        <div *ngIf="message" class="toast toast-success">{{ message }}</div>
        <div *ngIf="errorMessage" class="toast toast-error">{{ errorMessage }}</div>

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
            <label>
              ID de empleado (editable)
              <input
                type="number"
                min="1"
                [value]="employeeIdInput"
                (input)="employeeIdInput = readInputNumber($event, employeeIdInput)"
                placeholder="Ej: 1001"
              />
            </label>
            <button
              type="submit"
              [disabled]="processedEmbeddings.length === 0 || !embeddingNameInput.trim() || isSavingEmbeddings || employeeIdInput <= 0"
            >
              {{ isSavingEmbeddings ? 'Guardando...' : 'Asignar ID y guardar' }}
            </button>
          </div>
        </form>

      </section>

      <section class="panel">
        <h3>2) Registros de asistencia (CRUD)</h3>
        <div class="toolbar compact">
          <button type="button" (click)="startCreateRecord()">Añadir registro</button>
          <button type="button" [disabled]="attendance.length === 0" (click)="exportAsExcel()">Exportar Excel (CSV)</button>
          <button type="button" [disabled]="attendance.length === 0" (click)="exportAsPdf()">Exportar PDF</button>
          <button type="button" (click)="openImportPicker()">Importar lista (CSV)</button>
        </div>

        <div class="toolbar compact">
          <label>
            Filtrar por fecha
            <input
              type="date"
              [value]="selectedAttendanceDate"
              (input)="selectedAttendanceDate = readInputValue($event)"
            />
          </label>
          <button type="button" (click)="applyAttendanceDateFilter()">Aplicar filtro</button>
          <button type="button" (click)="setTodayAttendanceDate()">Hoy</button>
        </div>

        <input
          #listImportInput
          class="hidden-input"
          type="file"
          accept=".csv,text/csv,.pdf,application/pdf"
          (change)="onListImported($event)"
        />

        <form *ngIf="isEditing || isCreating" class="record-form" (submit)="$event.preventDefault(); saveRecord()">
          <div class="form-grid three">
            <label>
              ID Empleado
              <input
                type="number"
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
                <button type="button" class="small" disabled title="Edición no habilitada aún en backend">Editar</button>
                <button type="button" class="small danger" disabled title="Eliminación no habilitada aún en backend">Eliminar</button>
              </td>
            </tr>
            <tr *ngIf="attendance.length === 0">
              <td colspan="4" class="empty">No hay registros para la fecha {{ selectedAttendanceDate }}.</td>
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
      .toast { border-radius: 8px; font-size: 0.9rem; margin: 0.55rem 0; padding: 0.6rem 0.75rem; }
      .toast-success { background: #dcfce7; border: 1px solid #86efac; color: #166534; }
      .toast-error { background: #fee2e2; border: 1px solid #fca5a5; color: #991b1b; }
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
  selectedAttendanceDate = '';
  selectedPhotos: File[] = [];
  processedEmbeddings: EmbeddingResult[] = [];
  embeddingAssignments: EmbeddingAssignment[] = [];
  employeeStorageRecords: EmployeeStorageRecord[] = [];
  embeddingNameInput = '';
  employeeIdInput = 1;

  isExtracting = false;
  isSavingEmbeddings = false;
  message = '';
  errorMessage = '';

  isEditing = false;
  isCreating = false;
  editingRecord: AttendanceRecord = this.emptyRecord();
  editingOriginalId: number | null = null;

  constructor(
    private attendanceService: AttendanceService,
    @Inject(PLATFORM_ID) private platformId: object,
  ) {}

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.selectedAttendanceDate = this.getTodayDate();
      this.loadAttendance();
      this.loadEmployeesFromDb();
      this.loadEmployeeStorage();
    }
  }

  loadAttendance(): void {
    const requestedDate = this.selectedAttendanceDate;

    if (!requestedDate) {
      this.errorMessage = 'Debes seleccionar una fecha para consultar asistencia.';
      this.attendance = [];
      return;
    }

    if (this.isFutureDate(requestedDate)) {
      this.errorMessage = 'Solo se permiten fechas de hoy o pasadas.';
      this.attendance = [];
      return;
    }

    this.attendanceService.getAttendance(requestedDate).subscribe({
      next: (data) => {
        this.attendance = data;
        this.errorMessage = '';
      },
      error: () => {
        this.attendance = [];
        this.errorMessage = 'No se pudo cargar asistencia desde backend para la fecha seleccionada.';
      },
    });
  }

  applyAttendanceDateFilter(): void {
    this.loadAttendance();
  }

  setTodayAttendanceDate(): void {
    this.selectedAttendanceDate = this.getTodayDate();
    this.loadAttendance();
  }

  loadEmployeesFromDb(): void {
    this.attendanceService.getEmployees().subscribe({
      next: (employees) => {
        const dbAssignments: EmbeddingAssignment[] = employees.map((employee) => ({
          employeeId: Number(employee.employee_id) || 0,
          employeeName: employee.name,
          fileName: 'DB',
          dimensions: 128,
          createdAt: 'Persistido en PostgreSQL',
          source: 'db',
        }));

        this.embeddingAssignments = dbAssignments.sort((a, b) => b.employeeId - a.employeeId);
        const maxId = this.embeddingAssignments.reduce((max, item) => Math.max(max, item.employeeId), 0);
        this.employeeIdInput = Math.max(1, maxId + 1);
      },
      error: () => {
        this.errorMessage = 'No se pudo cargar empleados desde base de datos.';
      },
    });
  }

  loadEmployeeStorage(): void {
    this.attendanceService.getEmployeeStorage().subscribe({
      next: (rows) => {
        this.employeeStorageRecords = rows;
      },
      error: () => {
        this.errorMessage = 'No se pudo cargar detalle de embeddings/fotos desde base de datos.';
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
    if (this.selectedPhotos.length < 5 || this.selectedPhotos.length > 10) {
      this.errorMessage = 'Para precisión, cada empleado debe tener entre 5 y 10 fotos.';
      this.message = '';
      return;
    }

    this.isExtracting = true;
    this.errorMessage = '';
    this.message = 'Procesando imágenes en backend...';
    const startedAt = Date.now();

    try {
      const files = await Promise.all(this.selectedPhotos.map((file) => this.fileToBase64(file)));
      this.attendanceService.extractEmbeddings(files).subscribe({
        next: (response) => {
          this.processedEmbeddings = response.results;
          const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
          this.message = `Embedding extraído: ${response.results.length} en ${elapsedSeconds}s. Ahora asigna ID y guarda en base de datos.`;
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

  async assignCurrentEmbedding(): Promise<void> {
    if (this.processedEmbeddings.length === 0 || !this.embeddingNameInput.trim()) {
      return;
    }

    if (this.processedEmbeddings.length < 5 || this.processedEmbeddings.length > 10) {
      this.errorMessage = `Se requieren entre 5 y 10 embeddings válidos por empleado. Actualmente: ${this.processedEmbeddings.length}.`;
      this.message = '';
      return;
    }

    if (this.isSavingEmbeddings) {
      return;
    }

    const name = this.embeddingNameInput.trim();

    this.isSavingEmbeddings = true;
    this.errorMessage = '';
    this.message = 'Guardando embeddings en base de datos...';
    const startedAt = Date.now();

    try {
      const processedFileNames = new Set(this.processedEmbeddings.map((item) => item.fileName));
      const filesToPersist = this.selectedPhotos.filter((photo) => processedFileNames.has(photo.name));

      if (filesToPersist.length === 0) {
        this.errorMessage = 'No hay fotos válidas para guardar en base de datos.';
        this.message = '';
        this.isSavingEmbeddings = false;
        return;
      }

      const employees = await firstValueFrom(this.attendanceService.getEmployees());
      const maxEmployeeIdInDb = employees.reduce((max, employee) => {
        const parsed = Number(employee.employee_id);
        return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
      }, 0);

      const employeeId = Math.max(this.employeeIdInput, 1);
      if (maxEmployeeIdInDb > 0 && employeeId > maxEmployeeIdInDb+1) {
        // permitido, solo informativo en mensaje final
      }
      const filesPayload = await Promise.all(filesToPersist.map((file) => this.fileToBase64(file)));

      const response = await firstValueFrom(
        this.attendanceService.registerEmployeePhotos({
          employeeName: name,
          employeeId: String(employeeId),
          files: filesPayload,
        }),
      );

      const createdAt = new Date().toLocaleString();

      response.saved.forEach((savedItem) => {
        this.embeddingAssignments.unshift({
          employeeId: Number(savedItem.employeeId),
          employeeName: savedItem.employeeName,
          fileName: `${savedItem.photosProcessed} foto(s) procesadas`,
          dimensions: 128,
          createdAt,
          source: 'session',
        });
      });

      const storageRows = await firstValueFrom(this.attendanceService.getEmployeeStorage());
      this.employeeStorageRecords = storageRows;

      const savedIds = new Set(response.saved.map((item) => item.employeeId));
      const confirmedCount = storageRows.filter((row) => savedIds.has(row.employee_id)).length;
      const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);

      const processedPhotos = response.saved.reduce((sum, item) => sum + item.photosProcessed, 0);
      if (response.saved.length > 0 && confirmedCount === response.saved.length) {
        this.message = `✅ Confirmación BD: empleado ${response.saved[0].employeeId} guardado con ${processedPhotos} foto(s) en ${elapsedSeconds}s.`;
      } else if (response.saved.length > 0) {
        this.message = `⚠ Guardado parcial: empleado ${response.saved[0].employeeId}, confirmados en BD ${confirmedCount}/${response.saved.length} en ${elapsedSeconds}s.`;
      } else {
        this.message = '';
      }

      this.errorMessage = response.errors.length > 0 ? response.errors.join(' | ') : '';

      const maxSavedId = response.saved.reduce((max, item) => Math.max(max, Number(item.employeeId) || 0), 0);
      if (maxSavedId > 0) {
        this.employeeIdInput = maxSavedId + 1;
      }

      this.embeddingNameInput = '';
      this.processedEmbeddings = [];
      this.selectedPhotos = [];
      this.isSavingEmbeddings = false;
    } catch {
      this.errorMessage = 'No se pudo preparar el guardado de embeddings.';
      this.message = '';
      this.isSavingEmbeddings = false;
    }
  }

  startCreateRecord(): void {
    this.isCreating = true;
    this.isEditing = false;
    this.editingOriginalId = null;
    this.editingRecord = {
      id: this.getNextAttendanceId(),
      name: '',
      timestamp: this.toDateTimeLocal(new Date().toISOString()),
    };
  }

  editRecord(record: AttendanceRecord): void {
    this.isEditing = true;
    this.isCreating = false;
    this.editingOriginalId = record.id;
    this.editingRecord = {
      id: record.id,
      name: record.name,
      timestamp: this.toDateTimeLocal(record.timestamp),
    };
  }

  saveRecord(): void {
    if (this.isCreating) {
      const employeeId = String(Number(this.editingRecord.id) || 0);
      if (employeeId === '0') {
        this.errorMessage = 'El ID de empleado es obligatorio.';
        return;
      }

      const name = this.editingRecord.name.trim();
      const timestamp = this.normalizeManualTimestamp(this.editingRecord.timestamp);
      if (this.editingRecord.timestamp && !timestamp) {
        this.errorMessage = 'Fecha/Hora inválida. Usa un valor válido.';
        return;
      }

      this.attendanceService.createAttendance({ employee_id: employeeId, name, timestamp }).subscribe({
        next: () => {
          this.selectedAttendanceDate = this.getTodayDate();
          this.message = `Asistencia registrada para empleado ${employeeId}.`;
          this.errorMessage = '';
          this.cancelRecordEditor();
          this.loadAttendance();
        },
        error: (error: HttpErrorResponse) => {
          const backendMessage = typeof error.error === 'string' ? error.error.trim() : '';
          this.errorMessage = backendMessage || 'No se pudo registrar asistencia en backend.';
        },
      });
      return;
    }

    const normalized: AttendanceRecord = {
      id: Number(this.editingRecord.id) || this.getNextAttendanceId(),
      name: this.editingRecord.name.trim() || 'Sin nombre',
      timestamp: this.editingRecord.timestamp || this.toDateTimeLocal(new Date().toISOString()),
    };

    const isDuplicateId = this.attendance.some(
      (record) =>
        record.id === normalized.id &&
        (!this.isEditing || this.editingOriginalId === null || record.id !== this.editingOriginalId),
    );
    if (isDuplicateId) {
      this.errorMessage = `Ya existe un registro con ID ${normalized.id}.`;
      return;
    }

    if (this.isEditing && this.editingOriginalId !== null) {
      this.attendance = this.attendance.map((record) =>
        record.id === this.editingOriginalId ? normalized : record,
      );
      this.message = `Registro ${normalized.id} actualizado.`;
    } else {
      this.attendance = [normalized, ...this.attendance];
      this.message = `Registro ${normalized.id} agregado.`;
    }

    this.cancelRecordEditor();
  }

  deleteRecord(id: number): void {
    this.attendance = this.attendance.filter((record) => record.id !== id);
    this.message = `Registro ${id} eliminado.`;
  }

  cancelRecordEditor(): void {
    this.isCreating = false;
    this.isEditing = false;
    this.editingOriginalId = null;
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

    if (file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf') {
      this.importFromPdf(file);
      input.value = '';
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

  private async importFromPdf(file: File): Promise<void> {
    try {
      const buffer = await file.arrayBuffer();
      const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const loadingTask = (pdfjsLib as any).getDocument({ data: buffer, disableWorker: true });
      const pdf = await loadingTask.promise;

      const textLines: string[] = [];
      for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
        const page = await pdf.getPage(pageIndex);
        const content = await page.getTextContent();
        const line = content.items
          .map((item: any) => ('str' in item ? item.str : ''))
          .join(' ')
          .trim();

        if (line.length > 0) {
          textLines.push(line);
        }
      }

      const candidateCsv = textLines.join('\n');
      let imported = this.parseCsv(candidateCsv);

      if (imported.length === 0) {
        const rowCandidates = textLines.filter((line) => line.includes(',') || line.includes('|'));
        imported = rowCandidates.map((line, index) => {
          const normalized = line.replace(/\|/g, ',');
          const parts = this.parseCsvRow(normalized);
          return {
            id: Number(parts[0]) || this.getNextAttendanceId() + index,
            name: (parts[1] || 'Sin nombre').trim(),
            timestamp: (parts[2] || new Date().toISOString()).trim(),
          };
        });
      }

      if (imported.length > 0) {
        this.attendance = imported;
        this.errorMessage = '';
        this.message = `Se importaron ${imported.length} registro(s) desde PDF.`;
      } else {
        this.errorMessage = 'PDF inválido: no se pudieron extraer registros en formato id,name,timestamp.';
      }
    } catch {
      this.errorMessage = 'No se pudo importar el archivo PDF.';
    }
  }

  private getTodayDate(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private isFutureDate(value: string): boolean {
    const selected = new Date(`${value}T00:00:00`);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return selected.getTime() > today.getTime();
  }

  private normalizeManualTimestamp(value: string): string | undefined {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      return undefined;
    }

    return parsed.toISOString();
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
