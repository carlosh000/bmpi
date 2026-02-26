import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ChangeDetectorRef, Component, ElementRef, Inject, NgZone, OnDestroy, OnInit, PLATFORM_ID, ViewChild } from '@angular/core';
import { AttendanceService, AttendanceRecord, EmbeddingResult, EmployeeStorageRecord, RegisterPhotosResponse } from './attendance.service';
import { finalize, firstValueFrom } from 'rxjs';
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
        <h2>Registro de Asistencia de la empresa BMPI</h2>
        <p class="description">
          Administra registros de asistencia y prepara embeddings faciales por empleado desde carpetas de fotos.
        </p>
      </header>

      <section class="panel" *ngIf="activeView === 'home'">
        <h3>Tabla de asistencias</h3>
        <div class="toolbar section-toolbar">
          <button type="button" class="section-toggle" (click)="openManualView()">Registro manual</button>
          <button type="button" class="section-toggle" (click)="openEmbeddingView()">Extraer embeddings</button>
        </div>

        <div class="toolbar compact">
          <button type="button" [disabled]="attendance.length === 0" (click)="exportAsExcel()">Exportar Excel (CSV)</button>
          <button type="button" (click)="openExcelImportPicker()">Importar Excel (CSV)</button>
          <button type="button" [disabled]="attendance.length === 0" (click)="exportAsPdf()">Exportar PDF</button>
        </div>

        <div class="toolbar compact">
          <label>
            Filtrar por fecha
            <input
              #attendanceDateInput
              type="date"
              [value]="selectedAttendanceDate"
              (input)="selectedAttendanceDate = readInputValue($event)"
            />
          </label>
          <button type="button" (mousedown)="$event.preventDefault(); applyAttendanceDateFilter()" (click)="$event.preventDefault()">Aplicar filtro</button>
          <button type="button" (mousedown)="$event.preventDefault(); setTodayAttendanceDate()" (click)="$event.preventDefault()">Hoy</button>
        </div>

        <input
          #excelImportInput
          class="hidden-input"
          type="file"
          accept=".csv,text/csv"
          (change)="onListImported($event)"
        />

        <div *ngIf="message" class="toast toast-success">{{ message }}</div>
        <div *ngIf="errorMessage" class="toast toast-error">{{ errorMessage }}</div>

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
              <td>{{ formatAttendanceTimestamp(record.timestamp) }}</td>
              <td class="actions">
                <button type="button" class="small" [disabled]="!isRecordFromToday(record)" [title]="isRecordFromToday(record) ? '' : 'Solo se permite editar registros de hoy'" (click)="editRecord(record)">Editar</button>
                <button type="button" class="small danger" [disabled]="!isRecordFromToday(record)" [title]="isRecordFromToday(record) ? '' : 'Solo se permite eliminar registros de hoy'" (click)="deleteRecord(record)">Eliminar</button>
                <small *ngIf="!isRecordFromToday(record)" class="row-lock-note">No editable (día anterior)</small>
              </td>
            </tr>
            <tr *ngIf="attendance.length === 0">
              <td colspan="4" class="empty">No hay registros para la fecha {{ selectedAttendanceDate }}.</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="panel" *ngIf="activeView === 'manual'">
        <h3>Registro manual</h3>
        <div class="toolbar compact">
          <button type="button" class="section-toggle" (click)="backToHome()">Volver</button>
          <button type="button" (click)="startCreateRecord()">Añadir registro</button>
        </div>

        <div *ngIf="message" class="toast toast-success">{{ message }}</div>
        <div *ngIf="errorMessage" class="toast toast-error">{{ errorMessage }}</div>

        <form *ngIf="isEditing || isCreating" class="record-form" (submit)="$event.preventDefault()">
          <div class="form-grid three">
            <label>
              ID Empleado
              <input
                #manualEmployeeIdField
                type="text"
                inputmode="numeric"
                pattern="[0-9]*"
                [value]="manualEmployeeIdInput"
                (input)="onManualEmployeeIdInput($event)"
                (change)="onManualEmployeeIdInput($event)"
              />
            </label>
            <label>
              Nombre
              <input
                #manualEmployeeNameField
                type="text"
                [value]="manualEmployeeNameInput"
                (input)="onManualEmployeeNameInput($event)"
                (change)="onManualEmployeeNameInput($event)"
                placeholder="Nombre empleado"
              />
            </label>
            <label>
              Fecha/Hora
              <input
                type="datetime-local"
                [value]="editingRecord.timestamp"
                [max]="getCurrentDateTimeLocal()"
                (input)="editingRecord.timestamp = readInputValue($event)"
              />
            </label>
          </div>
          <div class="toolbar compact">
            <button type="button" [disabled]="isSavingRecord" (click)="saveRecord()">Guardar</button>
            <button type="button" class="danger" (click)="cancelRecordEditor()">Cancelar</button>
          </div>
        </form>
      </section>

      <section class="panel" *ngIf="activeView === 'embedding'">
        <h3>Extraer embeddings</h3>
        <form class="assign-form" (submit)="$event.preventDefault()">
          <h4>Datos del empleado (obligatorios)</h4>
          <div class="form-grid">
            <label>
              Nombre del empleado
              <input
                type="text"
                [value]="embeddingNameInput"
                (input)="embeddingNameInput = readInputValue($event)"
                placeholder="Ej: Juan Pérez"
              />
            </label>
            <label>
              ID de empleado
              <input
                type="number"
                min="1"
                [value]="employeeIdInput"
                (input)="employeeIdInput = readInputNumber($event)"
                placeholder="Ej: 1001"
              />
            </label>
          </div>
        </form>

        <div class="toolbar">
          <button type="button" class="section-toggle" [disabled]="isExtracting || isSavingEmbeddings" (click)="backToHome()">Volver</button>
          <button type="button" (click)="openFolderPicker()">Cargar carpeta de fotos</button>
          <button type="button" class="danger" [disabled]="isExtracting || isSavingEmbeddings" (click)="clearEmbeddingState()">Limpiar estado</button>
          <button type="button" [disabled]="!canRetryFailedPhotos()" (click)="retryFailedPhotos()">
            Reintentar fallidas ({{ retryFailedPhotosQueue.length }})
          </button>
          <button type="button" [disabled]="!canRunEmbeddingExtraction()" (click)="confirmEmbeddingExtraction()">
            {{ isExtracting ? 'Procesando...' : 'Extraer y guardar embeddings' }}
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
        <p *ngIf="retryFailedPhotosQueue.length > 0" class="status">
          Fallidas detectadas: {{ retryFailedPhotosQueue.length }} (usa "Reintentar fallidas").
        </p>
        <p *ngIf="selectedPhotos.length > 0 && !embeddingsReadyToSave" class="status">
          Completa nombre + ID y luego usa "Extraer y guardar embeddings" para terminar en un solo paso.
        </p>

        <div *ngIf="message" class="toast toast-success">{{ message }}</div>
        <div *ngIf="errorMessage" class="toast toast-error">{{ errorMessage }}</div>
        <div *ngIf="qualityWarningsMessage" class="toast toast-warning">{{ qualityWarningsMessage }}</div>
        <p *ngIf="embeddingProgressTotal > 0" class="status">
          Progreso: {{ embeddingProgressCurrent }}/{{ embeddingProgressTotal }} · {{ embeddingProgressStage }}
        </p>
        <p *ngIf="embeddingFinalStatus" class="status">
          Estado final: <strong>{{ embeddingFinalStatus }}</strong>
        </p>
        <div *ngIf="embeddingProgressTotal > 0" class="progress-wrap" aria-live="polite">
          <div class="progress-track">
            <div
              class="progress-fill"
              [class.complete]="isEmbeddingProgressComplete()"
              [class.error]="isEmbeddingProgressError()"
              [style.width.%]="getEmbeddingProgressPercent()"
            ></div>
          </div>
          <small>{{ getEmbeddingProgressPercent() }}%</small>
        </div>

        <div *ngIf="processedEmbeddings.length > 0" class="embedding-results">
          <h4>Resultado de extracción</h4>
          <ul>
            <li *ngFor="let embedding of processedEmbeddings">
              <strong>{{ embedding.fileName }}</strong>
              <span>dim={{ embedding.dimensions }} · listo para guardar</span>
            </li>
          </ul>
        </div>

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
      .section-toolbar { margin-bottom: 0.35rem; }
      button { background: #2563eb; border: none; border-radius: 6px; color: #fff; cursor: pointer; font-size: 0.92rem; padding: 0.55rem 0.85rem; }
      button.small { padding: 0.35rem 0.6rem; font-size: 0.84rem; }
      button.section-toggle { font-size: 1rem; font-weight: 600; padding: 0.75rem 1.1rem; }
      button.danger { background: #dc2626; }
      button:disabled { background: #94a3b8; cursor: not-allowed; }
      .hidden-input { display: none; }
      .status { margin: 0.35rem 0; color: #0f172a; }
      .progress-wrap { display: flex; align-items: center; gap: 0.6rem; margin: 0.4rem 0 0.7rem; }
      .progress-track { flex: 1; height: 10px; border-radius: 999px; background: #dbeafe; overflow: hidden; }
      .progress-fill { height: 100%; background: #2563eb; transition: width 180ms ease; }
      .progress-fill.complete { background: #16a34a; }
      .progress-fill.error { background: #dc2626; }
      .error { margin: 0.35rem 0; color: #b91c1c; }
      .toast { border-radius: 8px; font-size: 0.9rem; margin: 0.55rem 0; padding: 0.6rem 0.75rem; }
      .toast-success { background: #dcfce7; border: 1px solid #86efac; color: #166534; }
      .toast-error { background: #fee2e2; border: 1px solid #fca5a5; color: #991b1b; }
      .toast-warning { background: #fef3c7; border: 1px solid #fcd34d; color: #92400e; }
      .form-grid { display: grid; gap: 0.75rem; grid-template-columns: 2fr auto; align-items: end; }
      .form-grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      label { display: grid; gap: 0.35rem; font-size: 0.88rem; color: #334155; }
      small { font-size: 0.78rem; }
      .hint-valid { color: #166534; }
      .hint-invalid { color: #b91c1c; }
      input { border: 1px solid #cbd5e1; border-radius: 6px; padding: 0.5rem; }
      table { border-collapse: collapse; width: 100%; margin-top: 0.75rem; }
      th, td { border: 1px solid #d1d5db; padding: 0.65rem; }
      th { background: #eff6ff; text-align: left; }
      .actions { display: flex; gap: 0.5rem; }
      .row-lock-note { align-self: center; color: #6b7280; font-size: 0.75rem; }
      .empty { color: #6b7280; text-align: center; }
      .embedding-results { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; margin-top: 1rem; padding: 0.75rem; }
      .embedding-results ul { list-style: none; margin: 0; padding: 0; }
      .embedding-results li { align-items: baseline; display: flex; gap: 0.75rem; padding: 0.25rem 0; }
      .embedding-results span { color: #475569; font-family: 'Courier New', monospace; }
      .mini-table { margin-top: 1rem; }
    `,
  ],
})
export class AttendanceListComponent implements OnInit, OnDestroy {
  @ViewChild('manualEmployeeIdField') manualEmployeeIdField?: ElementRef<HTMLInputElement>;
  @ViewChild('manualEmployeeNameField') manualEmployeeNameField?: ElementRef<HTMLInputElement>;
  @ViewChild('photoFolderInput') photoFolderInput?: ElementRef<HTMLInputElement>;
  @ViewChild('excelImportInput') excelImportInput?: ElementRef<HTMLInputElement>;
  @ViewChild('attendanceDateInput') attendanceDateInput?: ElementRef<HTMLInputElement>;

  attendance: AttendanceRecord[] = [];
  selectedAttendanceDate = '';
  selectedPhotos: File[] = [];
  processedEmbeddings: EmbeddingResult[] = [];
  embeddingAssignments: EmbeddingAssignment[] = [];
  employeeStorageRecords: EmployeeStorageRecord[] = [];
  manualEmployeeIdInput = '';
  manualEmployeeNameInput = '';
  embeddingNameInput = '';
  employeeIdInput = 0;
  embeddingsReadyToSave = false;
  embeddingProgressCurrent = 0;
  embeddingProgressTotal = 0;
  embeddingProgressStage = '';
  embeddingFinalStatus = '';
  retryFailedPhotosQueue: File[] = [];
  private isRetryFailedFlow = false;

  isExtracting = false;
  isSavingEmbeddings = false;
  isSavingRecord = false;
  private _message = '';
  private _errorMessage = '';
  qualityWarningsMessage = '';
  private messageTimer: ReturnType<typeof setTimeout> | null = null;
  private errorMessageTimer: ReturnType<typeof setTimeout> | null = null;
  private embeddingWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly uploadMaxDimension = 1280;
  private readonly uploadJpegQuality = 0.82;

  get message(): string {
    return this._message;
  }

  set message(value: string) {
    this._message = value;
    this.resetMessageTimer(value);
  }

  get errorMessage(): string {
    return this._errorMessage;
  }

  set errorMessage(value: string) {
    this._errorMessage = value;
    this.resetErrorMessageTimer(value);
  }

  isEditing = false;
  isCreating = false;
  activeView: 'home' | 'manual' | 'embedding' = 'home';
  editingRecord: AttendanceRecord = this.emptyRecord();
  editingOriginalRowId: number | null = null;

  constructor(
    private attendanceService: AttendanceService,
    private ngZone: NgZone,
    private cdr: ChangeDetectorRef,
    @Inject(PLATFORM_ID) private platformId: object,
  ) {}

  ngOnDestroy(): void {
    if (this.messageTimer) {
      clearTimeout(this.messageTimer);
      this.messageTimer = null;
    }
    if (this.errorMessageTimer) {
      clearTimeout(this.errorMessageTimer);
      this.errorMessageTimer = null;
    }
    if (this.embeddingWatchdogTimer) {
      clearTimeout(this.embeddingWatchdogTimer);
      this.embeddingWatchdogTimer = null;
    }
  }

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.selectedAttendanceDate = this.getTodayDate();
      this.loadAttendance();
      this.loadEmployeesFromDb();
      this.loadEmployeeStorage();
    }
  }

  loadAttendance(dateOverride?: string): void {
    const requestedDate = (dateOverride ?? this.selectedAttendanceDate).trim();

    if (requestedDate) {
      this.selectedAttendanceDate = requestedDate;
    }

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
    const selectedFromInput = this.attendanceDateInput?.nativeElement.value?.trim() ?? this.selectedAttendanceDate;
    this.loadAttendance(selectedFromInput);
  }

  setTodayAttendanceDate(): void {
    const today = this.getTodayDate();
    if (this.attendanceDateInput?.nativeElement) {
      this.attendanceDateInput.nativeElement.value = today;
    }
    this.loadAttendance(today);
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

  openExcelImportPicker(): void {
    this.excelImportInput?.nativeElement.click();
  }

  openManualView(): void {
    this.errorMessage = '';
    this.activeView = 'manual';
  }

  openEmbeddingView(): void {
    this.errorMessage = '';
    this.activeView = 'embedding';
  }

  backToHome(): void {
    this.errorMessage = '';
    this.activeView = 'home';
  }

  onPhotoFolderSelected(event: Event): void {
    const files = (event.target as HTMLInputElement).files;
    this.selectedPhotos = files ? Array.from(files).filter((file) => file.type.startsWith('image/')) : [];
    this.retryFailedPhotosQueue = [];
    this.isRetryFailedFlow = false;
    this.processedEmbeddings = [];
    this.embeddingsReadyToSave = false;
    this.message = '';
    this.errorMessage = '';
    this.embeddingFinalStatus = '';
    this.resetEmbeddingProgress();
    (event.target as HTMLInputElement).value = '';
  }

  onManualEmployeeIdInput(event: Event): void {
    this.manualEmployeeIdInput = this.readInputValue(event);
    const parsed = this.toPositiveEmployeeId(this.manualEmployeeIdInput);
    this.editingRecord.id = parsed ?? 0;
  }

  onManualEmployeeNameInput(event: Event): void {
    this.manualEmployeeNameInput = this.readInputValue(event);
    this.editingRecord.name = this.manualEmployeeNameInput;
  }

  async confirmEmbeddingExtraction(): Promise<void> {
    if (this.isExtracting) {
      return;
    }

    const minPhotosRequired = this.isRetryFailedFlow ? 1 : 5;
    if (this.selectedPhotos.length < minPhotosRequired || this.selectedPhotos.length > 10) {
      this.errorMessage = this.isRetryFailedFlow
        ? 'Para reintento se requiere entre 1 y 10 fotos fallidas.'
        : 'Para precisión, cada empleado debe tener entre 5 y 10 fotos.';
      this.message = '';
      return;
    }

    const name = this.embeddingNameInput.trim();
    const employeeId = Number(this.employeeIdInput);
    if (!name || !Number.isFinite(employeeId) || employeeId <= 0) {
      this.errorMessage = 'Debes completar nombre e ID válidos antes de extraer.';
      this.message = '';
      return;
    }

    this.isExtracting = true;
    this.isSavingEmbeddings = true;
    this.embeddingsReadyToSave = false;
    this.errorMessage = '';
    this.embeddingFinalStatus = '';
    this.message = 'Validando y preparando lote de fotos...';
    this.embeddingProgressTotal = this.selectedPhotos.length;
    this.embeddingProgressCurrent = 0;
    this.embeddingProgressStage = 'Validando';
    this.embeddingFinalStatus = 'Procesando fotos...';
    const startedAt = Date.now();

    if (this.embeddingWatchdogTimer) {
      clearTimeout(this.embeddingWatchdogTimer);
      this.embeddingWatchdogTimer = null;
    }
    this.embeddingWatchdogTimer = setTimeout(() => {
      if (!this.isExtracting) {
        return;
      }
      this.isExtracting = false;
      this.isSavingEmbeddings = false;
      this.embeddingProgressStage = 'Error';
      this.embeddingFinalStatus = 'Error al guardar (tiempo excedido)';
      this.errorMessage = 'La operación tardó demasiado y fue detenida. Intenta con fotos más ligeras o reintenta.';
      this.message = '';
      this.cdr.detectChanges();
    }, 50000);

    try {
      this.embeddingProgressStage = 'Procesando fotos';
      this.message = 'Procesando fotos...';
      const conversion = await this.filesToBase64ResilientWithProgress(this.selectedPhotos);
      const filesPayload = conversion.payloads;

      if (conversion.failedFiles.length > 0) {
        this.errorMessage = `No se pudieron leer ${conversion.failedFiles.length} foto(s): ${conversion.failedFiles.join(', ')}`;
      }

      if (filesPayload.length === 0) {
        this.embeddingProgressStage = 'Error';
        this.embeddingFinalStatus = 'Error al guardar (ninguna foto válida)';
        this.message = '';
        return;
      }

      if (!this.isRetryFailedFlow && filesPayload.length < 5) {
        this.embeddingProgressStage = 'Error';
        this.embeddingFinalStatus = `Error al guardar (solo ${filesPayload.length} foto(s) válidas)`;
        this.errorMessage = `Se requieren entre 5 y 10 fotos válidas por empleado. Solo quedaron ${filesPayload.length}.`;
        this.message = '';
        return;
      }

      this.embeddingProgressTotal = filesPayload.length;

      this.embeddingProgressCurrent = Math.max(this.embeddingProgressTotal - 1, 0);
      this.embeddingProgressStage = 'Guardando datos faciales';
      this.message = 'Guardando datos faciales...';
      this.embeddingFinalStatus = 'Guardando datos faciales...';

      this.cdr.detectChanges();

      const response = await this.registerEmployeePhotosWithTimeout(
        {
          employeeName: name,
          employeeId: String(employeeId),
          files: filesPayload,
        },
        45000,
      );

      this.embeddingProgressCurrent = this.embeddingProgressTotal;

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
      const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      const processedPhotos = response.saved.reduce((sum, item) => sum + item.photosProcessed, 0);
      const failedPhotos = response.saved.reduce((sum, item) => sum + item.failedPhotos, 0);
      const failedNames = this.extractFailedPhotoNames(response.errors);
      const warningNames = this.extractPhotoNamesFromEntries(response.qualityWarnings ?? []);
      const retryNames = Array.from(new Set([...failedNames, ...warningNames]));
      this.retryFailedPhotosQueue = this.buildRetryPhotoQueue(retryNames, this.selectedPhotos);
      this.isRetryFailedFlow = false;

      const failedSet = new Set(failedNames.map((name) => name.toLocaleLowerCase()));
      const successfulPhotos = this.selectedPhotos.filter((file) => !failedSet.has(file.name.toLocaleLowerCase()));

      this.processedEmbeddings = successfulPhotos.map((file) => ({
        fileName: file.name,
        dimensions: 128,
        embedding: [],
      }));
      this.embeddingsReadyToSave = false;

      if (response.saved.length > 0 && failedPhotos === 0) {
        this.showMessageForDuration(
          `✅ Datos faciales guardados con éxito: empleado ${response.saved[0].employeeId}, ${processedPhotos} foto(s), ${elapsedSeconds}s.`,
          5000,
        );
        this.embeddingProgressStage = 'Guardado exitoso';
        this.embeddingFinalStatus = `Guardado exitoso (${processedPhotos} foto(s), ${elapsedSeconds}s)`;
        this.retryFailedPhotosQueue = [];
      } else if (response.saved.length > 0) {
        this.showMessageForDuration(
          `⚠ Guardado parcial: empleado ${response.saved[0].employeeId}, ${processedPhotos} procesadas, ${failedPhotos} fallidas, ${elapsedSeconds}s.`,
          5000,
        );
        this.embeddingProgressStage = 'Guardado parcial';
        this.embeddingFinalStatus = `Guardado parcial (${processedPhotos} OK / ${failedPhotos} fallidas, ${elapsedSeconds}s)`;
      } else {
        this.showMessageForDuration(
          `❌ No se guardaron datos faciales. Revisa el error y vuelve a intentar. (${elapsedSeconds}s)`,
          6000,
        );
        this.embeddingProgressStage = 'Error';
        this.embeddingFinalStatus = `Error al guardar (0 guardadas, ${elapsedSeconds}s)`;
      }

      const nonBlockingErrors = this.filterNonBlockingDuplicateErrors(response.errors);
      this.errorMessage = nonBlockingErrors.length > 0 ? nonBlockingErrors.join(' | ') : '';
      this.qualityWarningsMessage = this.formatQualityWarnings(response.qualityWarnings);

      if (response.saved.length > 0 && failedPhotos === 0) {
        this.embeddingNameInput = '';
        this.employeeIdInput = 0;
        this.selectedPhotos = [];
        this.processedEmbeddings = [];
        this.loadEmployeesFromDb();
        this.attendanceService.getEmployeeStorage().subscribe({
          next: (rows) => {
            this.employeeStorageRecords = rows;
          },
        });
      }
    } catch (err) {
      this.embeddingsReadyToSave = false;
      const asError = err as Error;
      if ((asError?.message ?? '').toLowerCase().includes('timeout')) {
        this.errorMessage = 'Tiempo de espera agotado al guardar datos faciales (45s).';
        this.embeddingFinalStatus = 'Error: tiempo agotado (45s)';
      } else {
        const backendMsg = this.extractBackendErrorMessage(err);
        this.errorMessage = backendMsg || 'No se pudo completar el guardado de datos faciales.';
        this.embeddingFinalStatus = 'Error al guardar (falló conexión o backend)';
      }
      this.message = '';
      this.embeddingProgressStage = 'Error';
      this.embeddingProgressCurrent = Math.max(this.embeddingProgressCurrent, this.embeddingProgressTotal - 1);
    } finally {
      if (this.embeddingWatchdogTimer) {
        clearTimeout(this.embeddingWatchdogTimer);
        this.embeddingWatchdogTimer = null;
      }
      this.isExtracting = false;
      this.isSavingEmbeddings = false;
      this.cdr.detectChanges();
    }
  }

  canRunEmbeddingExtraction(): boolean {
    if (this.isExtracting || this.isSavingEmbeddings) {
      return false;
    }

    const minPhotosRequired = this.isRetryFailedFlow ? 1 : 5;
    if (this.selectedPhotos.length < minPhotosRequired || this.selectedPhotos.length > 10) {
      return false;
    }

    if (!this.embeddingNameInput.trim()) {
      return false;
    }

    return Number.isFinite(this.employeeIdInput) && this.employeeIdInput > 0;
  }

  canRetryFailedPhotos(): boolean {
    if (this.isExtracting || this.isSavingEmbeddings) {
      return false;
    }

    if (this.retryFailedPhotosQueue.length < 1 || this.retryFailedPhotosQueue.length > 10) {
      return false;
    }

    if (!this.embeddingNameInput.trim()) {
      return false;
    }

    return Number.isFinite(this.employeeIdInput) && this.employeeIdInput > 0;
  }

  retryFailedPhotos(): void {
    if (!this.canRetryFailedPhotos()) {
      return;
    }

    this.selectedPhotos = [...this.retryFailedPhotosQueue];
    this.isRetryFailedFlow = true;
    this.errorMessage = '';
    this.message = `Reintento preparado con ${this.selectedPhotos.length} foto(s) fallidas.`;
    this.embeddingFinalStatus = `Listo para reintentar (${this.selectedPhotos.length} foto(s) fallidas)`;
    this.resetEmbeddingProgress();
    this.cdr.detectChanges();
    void this.confirmEmbeddingExtraction();
  }

  clearEmbeddingState(): void {
    this.resetEmbeddingWorkflowState();
    this.message = '';
    this.errorMessage = '';
    this.qualityWarningsMessage = '';
  }

  getEmbeddingProgressPercent(): number {
    if (this.embeddingProgressTotal <= 0) {
      return 0;
    }

    const percent = Math.round((this.embeddingProgressCurrent / this.embeddingProgressTotal) * 100);
    if (percent < 0) {
      return 0;
    }
    if (percent > 100) {
      return 100;
    }
    return percent;
  }

  isEmbeddingProgressComplete(): boolean {
    return (
      this.embeddingProgressStage === 'Completado' ||
      this.embeddingProgressStage === 'Guardado exitoso' ||
      this.embeddingProgressStage === 'Guardado parcial' ||
      this.getEmbeddingProgressPercent() >= 100
    );
  }

  isEmbeddingProgressError(): boolean {
    return this.embeddingProgressStage === 'Error';
  }

  async assignCurrentEmbedding(): Promise<void> {
    if (!this.embeddingsReadyToSave || this.processedEmbeddings.length === 0 || !this.embeddingNameInput.trim()) {
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
    this.message = 'Preparando imágenes para extracción...';
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

      const employeeId = Number(this.employeeIdInput);
      if (!Number.isFinite(employeeId) || employeeId <= 0) {
        this.errorMessage = 'El ID de empleado es obligatorio y debe ser mayor a 0.';
        this.message = '';
        this.isSavingEmbeddings = false;
        return;
      }

          this.message = 'Convirtiendo fotos y enviando al backend...';
          this.embeddingProgressTotal = filesToPersist.length;
          this.embeddingProgressCurrent = 0;
          this.embeddingProgressStage = 'Convirtiendo fotos';

          const filesPayload = await this.filesToBase64WithProgress(filesToPersist);

          this.message = 'Extrayendo y guardando embeddings en base de datos...';
          this.embeddingProgressCurrent = this.embeddingProgressTotal;
          this.embeddingProgressStage = 'Enviando al backend';
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

      const nonBlockingErrors = this.filterNonBlockingDuplicateErrors(response.errors);
      this.errorMessage = nonBlockingErrors.length > 0 ? nonBlockingErrors.join(' | ') : '';
      this.qualityWarningsMessage = this.formatQualityWarnings(response.qualityWarnings);

      this.embeddingNameInput = '';
      this.employeeIdInput = 0;
      this.processedEmbeddings = [];
      this.selectedPhotos = [];
      this.embeddingsReadyToSave = false;
      this.isSavingEmbeddings = false;
      this.embeddingProgressStage = 'Completado';
    } catch {
      this.errorMessage = 'No se pudo preparar el guardado de embeddings.';
      this.message = '';
      this.isSavingEmbeddings = false;
      this.embeddingProgressStage = 'Error';
    }
  }

  startCreateRecord(): void {
    this.isCreating = true;
    this.isEditing = false;
    this.editingOriginalRowId = null;
    this.manualEmployeeIdInput = '';
    this.manualEmployeeNameInput = '';
    this.editingRecord = {
      id: 0,
      name: '',
      timestamp: this.toDateTimeLocal(new Date().toISOString()),
    };
  }

  editRecord(record: AttendanceRecord): void {
    if (!this.isRecordFromToday(record)) {
      this.errorMessage = 'Solo se permite editar registros de hoy.';
      return;
    }

    this.activeView = 'manual';
    this.isEditing = true;
    this.isCreating = false;
    this.editingOriginalRowId = record.row_id ?? null;
    this.manualEmployeeIdInput = String(record.id ?? '');
    this.manualEmployeeNameInput = record.name ?? '';
    this.editingRecord = {
      row_id: record.row_id,
      id: record.id,
      name: record.name,
      timestamp: this.toDateTimeLocal(record.timestamp),
    };
  }

  saveRecord(): void {
    if (this.isSavingRecord) {
      return;
    }

    const handleAsCreate =
      this.isCreating ||
      !this.isEditing ||
      this.editingOriginalRowId === null ||
      this.editingOriginalRowId <= 0;

    if (handleAsCreate) {
      const parsedEmployeeId = this.resolveManualEmployeeId();
      if (parsedEmployeeId === null) {
        this.errorMessage = 'El ID de empleado es obligatorio y debe ser un número entero mayor a 0.';
        return;
      }
      const employeeId = String(parsedEmployeeId);

      const name = this.resolveManualEmployeeName();
      if (!name) {
        this.errorMessage = 'El nombre es obligatorio.';
        return;
      }

      const normalizedName = this.normalizeName(name);
      const conflictSameIdDifferentName = this.attendance.some(
        (record) => record.id === parsedEmployeeId && this.normalizeName(record.name) !== normalizedName,
      );
      if (conflictSameIdDifferentName) {
        this.errorMessage = `No se permite registrar el ID ${parsedEmployeeId} con un nombre diferente.`;
        return;
      }

      const conflictDifferentIdSameName = this.attendance.some(
        (record) => this.normalizeName(record.name) === normalizedName && record.id !== parsedEmployeeId,
      );
      if (conflictDifferentIdSameName) {
        this.errorMessage = `No se permite registrar el nombre ${name} con un ID diferente.`;
        return;
      }

      const timestamp = this.normalizeManualTimestamp(this.editingRecord.timestamp);
      if (this.editingRecord.timestamp && !timestamp) {
        this.errorMessage = 'Fecha/Hora inválida. Usa un valor válido.';
        return;
      }
      if (this.editingRecord.timestamp && !this.isTodayDateTime(this.editingRecord.timestamp)) {
        this.errorMessage = 'Solo se permite registrar asistencia con fecha de hoy.';
        return;
      }
      if (this.editingRecord.timestamp && this.isFutureDateTime(this.editingRecord.timestamp)) {
        this.errorMessage = 'Hora futura no permitida: debe ser menor o igual a la hora actual.';
        return;
      }

      this.isSavingRecord = true;
      this.message = 'Guardando registro...';
      this.errorMessage = '';

      this.attendanceService
        .createAttendance({ employee_id: employeeId, name, timestamp })
        .pipe(
          finalize(() => {
            this.ngZone.run(() => {
              this.isSavingRecord = false;
              this.cdr.detectChanges();
            });
          }),
        )
        .subscribe({
          next: () => {
            this.ngZone.run(() => {
              const selectedDate = (this.editingRecord.timestamp || '').slice(0, 10) || this.getTodayDate();
              this.selectedAttendanceDate = selectedDate;
              this.message = `Asistencia registrada para empleado ${employeeId}.`;
              this.errorMessage = '';
              this.cancelRecordEditor();
              this.loadAttendance();
              this.cdr.detectChanges();
            });
          },
          error: (error: HttpErrorResponse) => {
            this.ngZone.run(() => {
              this.message = '';
              const backendMessage = typeof error.error === 'string' ? error.error.trim() : '';
              this.errorMessage = backendMessage || 'No se pudo registrar asistencia en backend.';
              this.cdr.detectChanges();
            });
          },
        });
      return;
    }

    const parsedEmployeeId = this.resolveManualEmployeeId();
    const normalized: AttendanceRecord = {
      id: parsedEmployeeId ?? 0,
      name: this.resolveManualEmployeeName(),
      timestamp: this.editingRecord.timestamp || this.toDateTimeLocal(new Date().toISOString()),
    };

    if (parsedEmployeeId === null) {
      this.errorMessage = 'El ID de empleado es obligatorio y debe ser un número entero mayor a 0.';
      return;
    }

    if (!normalized.name) {
      this.errorMessage = 'El nombre es obligatorio.';
      return;
    }

    const normalizedName = this.normalizeName(normalized.name);
    const conflictSameIdDifferentName = this.attendance.some(
      (record) =>
        record.id === normalized.id &&
        record.row_id !== this.editingOriginalRowId &&
        this.normalizeName(record.name) !== normalizedName,
    );
    if (conflictSameIdDifferentName) {
      this.errorMessage = `No se permite usar el mismo ID ${normalized.id} con un nombre diferente.`;
      return;
    }

    const conflictDifferentIdSameName = this.attendance.some(
      (record) =>
        this.normalizeName(record.name) === normalizedName &&
        record.id !== normalized.id &&
        record.row_id !== this.editingOriginalRowId,
    );
    if (conflictDifferentIdSameName) {
      this.errorMessage = `No se permite usar el nombre ${normalized.name} con un ID diferente.`;
      return;
    }

    const timestamp = this.normalizeManualTimestamp(this.editingRecord.timestamp);
    if (!timestamp) {
      this.errorMessage = 'Fecha/Hora inválida. Usa un valor válido.';
      return;
    }
    if (!this.isTodayDateTime(this.editingRecord.timestamp)) {
      this.errorMessage = 'Solo se permite registrar asistencia con fecha de hoy.';
      return;
    }
    if (this.isFutureDateTime(this.editingRecord.timestamp)) {
      this.errorMessage = 'Hora futura no permitida: debe ser menor o igual a la hora actual.';
      return;
    }

    const editingRowId = this.editingOriginalRowId as number;

    this.isSavingRecord = true;
    this.message = 'Guardando cambios...';
    this.errorMessage = '';

    this.attendanceService
      .updateAttendance(editingRowId, {
        employee_id: String(normalized.id),
        name: normalized.name,
        timestamp,
      })
      .pipe(
        finalize(() => {
          this.ngZone.run(() => {
            this.isSavingRecord = false;
            this.cdr.detectChanges();
          });
        }),
      )
      .subscribe({
        next: () => {
          this.ngZone.run(() => {
            this.selectedAttendanceDate = (this.editingRecord.timestamp || '').slice(0, 10) || this.selectedAttendanceDate;
            this.message = `Registro ${normalized.id} actualizado.`;
            this.errorMessage = '';
            this.cancelRecordEditor();
            this.loadAttendance();
            this.cdr.detectChanges();
          });
        },
        error: (error: HttpErrorResponse) => {
          this.ngZone.run(() => {
            this.message = '';
            const backendMessage = typeof error.error === 'string' ? error.error.trim() : '';
            this.errorMessage = backendMessage || 'No se pudo actualizar asistencia en backend.';
            this.cdr.detectChanges();
          });
        },
      });
  }

  deleteRecord(record?: AttendanceRecord): void {
    if (!record) {
      this.errorMessage = 'No se puede eliminar: recarga la lista de asistencia e intenta de nuevo.';
      return;
    }

    if (!this.isRecordFromToday(record)) {
      this.errorMessage = 'Solo se permite eliminar registros de hoy.';
      return;
    }

    const rowId = record.row_id;
    if (!rowId || rowId <= 0) {
      this.errorMessage = 'No se puede eliminar: recarga la lista de asistencia e intenta de nuevo.';
      return;
    }

    const displayId = record.id ?? rowId;
    const confirmed = window.confirm(`¿Seguro que deseas eliminar el registro ${displayId}?`);
    if (!confirmed) {
      return;
    }

    this.attendanceService.deleteAttendance(rowId).subscribe({
      next: () => {
        this.message = `Registro ${displayId} eliminado.`;
        this.errorMessage = '';
        this.loadAttendance();
      },
      error: (error: HttpErrorResponse) => {
        const backendMessage = typeof error.error === 'string' ? error.error.trim() : '';
        this.errorMessage = backendMessage || 'No se pudo eliminar asistencia en backend.';
      },
    });
  }

  cancelRecordEditor(): void {
    this.isSavingRecord = false;
    this.isCreating = false;
    this.isEditing = false;
    this.editingOriginalRowId = null;
    this.manualEmployeeIdInput = '';
    this.manualEmployeeNameInput = '';
    this.editingRecord = this.emptyRecord();
  }

  exportAsExcel(): void {
    const headers = ['id', 'name', 'timestamp'];
    const rows = this.attendance.map((record) => [record.id, record.name, this.formatAttendanceTimestamp(record.timestamp)]);
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
                `<tr><td>${record.id}</td><td>${record.name}</td><td>${this.formatAttendanceTimestamp(record.timestamp)}</td></tr>`,
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
      this.ngZone.run(() => {
        const csv = `${reader.result ?? ''}`;
        const imported = this.parseCsv(csv);
        if (imported.length > 0) {
          this.applyImportedAttendance(imported, 'CSV');
        } else {
          this.errorMessage = 'CSV inválido: verifica encabezados y columnas.';
        }
      });
    };

    reader.readAsText(file);
    input.value = '';
  }

  readInputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  readInputNumber(event: Event): number {
    const rawValue = (event.target as HTMLInputElement).value;
    if (!rawValue.trim()) {
      return 0;
    }

    const value = Number(rawValue);
    return Number.isFinite(value) && value > 0 ? value : 0;
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

  private toPositiveEmployeeId(value: number | string | undefined): number | null {
    const asString = String(value ?? '').trim();
    if (!asString) {
      return null;
    }
    if (!/^\d+$/.test(asString)) {
      return null;
    }
    const parsed = Number(asString);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return null;
    }
    return parsed;
  }

  private resolveManualEmployeeId(): number | null {
    const fromInput = this.toPositiveEmployeeId(this.manualEmployeeIdInput);
    if (fromInput !== null) {
      return fromInput;
    }

    const fromVisibleField = this.toPositiveEmployeeId(this.manualEmployeeIdField?.nativeElement?.value);
    if (fromVisibleField !== null) {
      this.manualEmployeeIdInput = String(fromVisibleField);
      this.editingRecord.id = fromVisibleField;
      return fromVisibleField;
    }

    return this.toPositiveEmployeeId(this.editingRecord.id);
  }

  private resolveManualEmployeeName(): string {
    const fromInput = this.manualEmployeeNameInput.trim();
    if (fromInput) {
      this.editingRecord.name = fromInput;
      return fromInput;
    }

    const fromVisibleField = this.manualEmployeeNameField?.nativeElement?.value?.trim() ?? '';
    if (fromVisibleField) {
      this.manualEmployeeNameInput = fromVisibleField;
      this.editingRecord.name = fromVisibleField;
      return fromVisibleField;
    }

    return (this.editingRecord.name ?? '').trim();
  }

  isManualEmployeeIdValid(): boolean {
    return this.toPositiveEmployeeId(this.manualEmployeeIdInput) !== null;
  }

  private normalizeName(value: string): string {
    return value.trim().toLocaleLowerCase();
  }

  private filterNonBlockingDuplicateErrors(errors: string[]): string[] {
    return errors.filter((item) => !item.toLocaleLowerCase().includes('duplicate prevented'));
  }

  private formatQualityWarnings(warnings?: string[]): string {
    if (!warnings || warnings.length === 0) {
      return '';
    }

    const cleaned = warnings
      .map((item) => (item ?? '').trim())
      .filter((item) => item.length > 0)
      .slice(0, 6);

    if (cleaned.length === 0) {
      return '';
    }

    const payload = cleaned.join(' | ');
    if (warnings.length > cleaned.length) {
      return `⚠ Calidad de foto: ${payload} | +${warnings.length - cleaned.length} más`;
    }

    return `⚠ Calidad de foto: ${payload}`;
  }

  private extractPhotoNamesFromEntries(entries: string[]): string[] {
    const names: string[] = [];
    for (const entry of entries) {
      const text = (entry ?? '').trim();
      if (!text) {
        continue;
      }
      const separatorIndex = text.indexOf(':');
      if (separatorIndex <= 0) {
        continue;
      }
      const fileName = text.slice(0, separatorIndex).trim();
      if (!fileName) {
        continue;
      }
      names.push(fileName);
    }

    return Array.from(new Set(names));
  }

  private showMessageForDuration(value: string, durationMs: number): void {
    if (this.messageTimer) {
      clearTimeout(this.messageTimer);
      this.messageTimer = null;
    }

    this._message = value;
    if (!value.trim()) {
      return;
    }

    this.messageTimer = setTimeout(() => {
      this._message = '';
      this.messageTimer = null;
    }, durationMs);
  }

  private resetMessageTimer(value: string): void {
    if (this.messageTimer) {
      clearTimeout(this.messageTimer);
      this.messageTimer = null;
    }
    if (!value.trim()) {
      return;
    }
    this.messageTimer = setTimeout(() => {
      this._message = '';
      this.messageTimer = null;
    }, 2000);
  }

  private resetErrorMessageTimer(value: string): void {
    if (this.errorMessageTimer) {
      clearTimeout(this.errorMessageTimer);
      this.errorMessageTimer = null;
    }
    if (!value.trim()) {
      return;
    }
    this.errorMessageTimer = setTimeout(() => {
      this._errorMessage = '';
      this.errorMessageTimer = null;
    }, 2000);
  }

  private isTodayDateTime(value: string): boolean {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return false;
    }

    const now = new Date();
    return (
      parsed.getFullYear() === now.getFullYear() &&
      parsed.getMonth() === now.getMonth() &&
      parsed.getDate() === now.getDate()
    );
  }

  isRecordFromToday(record: AttendanceRecord): boolean {
    return this.isTodayDateTime(record.timestamp);
  }

  private isFutureDateTime(value: string): boolean {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return false;
    }

    return parsed.getTime() > Date.now();
  }

  getCurrentDateTimeLocal(): string {
    return this.toDateTimeLocal(new Date().toISOString());
  }

  formatAttendanceTimestamp(value: string): string {
    const local = this.toDateTimeLocal(value);
    if (!local) {
      return value;
    }

    return local.replace('T', ' ');
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

  private applyImportedAttendance(imported: AttendanceRecord[], source: 'CSV'): void {
    this.attendance = [...imported];
    this.errorMessage = '';
    this.message = `✅ ${source} cargado: ${imported.length} registro(s) importado(s).`;
    this.cdr.detectChanges();
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
      this.normalizeImageForUpload(file)
        .then((normalized) => {
          const reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result !== 'string') {
              reject(new Error('invalid file payload'));
              return;
            }
            resolve({ name: file.name, data: reader.result });
          };
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(normalized);
        })
        .catch((err) => reject(err));
    });
  }

  private async normalizeImageForUpload(file: File): Promise<Blob> {
    if (!file.type.startsWith('image/')) {
      return file;
    }

    const imageElement = await this.loadImageElement(file);
    const originalWidth = imageElement.naturalWidth || imageElement.width;
    const originalHeight = imageElement.naturalHeight || imageElement.height;

    if (!originalWidth || !originalHeight) {
      return file;
    }

    const scale = Math.min(1, this.uploadMaxDimension / Math.max(originalWidth, originalHeight));
    const targetWidth = Math.max(1, Math.round(originalWidth * scale));
    const targetHeight = Math.max(1, Math.round(originalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const context = canvas.getContext('2d');
    if (!context) {
      return file;
    }

    context.drawImage(imageElement, 0, 0, targetWidth, targetHeight);

    const blob = await this.canvasToBlob(canvas, 'image/jpeg', this.uploadJpegQuality);
    if (!blob) {
      return file;
    }

    if (blob.size >= file.size && scale === 1) {
      return file;
    }

    return blob;
  }

  private loadImageElement(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result !== 'string') {
          reject(new Error('invalid image reader result'));
          return;
        }

        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('cannot decode image'));
        image.src = reader.result;
      };
      reader.onerror = () => reject(reader.error ?? new Error('cannot read image'));
      reader.readAsDataURL(file);
    });
  }

  private canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), type, quality);
    });
  }

  private async filesToBase64WithProgress(files: File[]): Promise<{ name: string; data: string }[]> {
    let completed = 0;

    return Promise.all(
      files.map((file) =>
        this.fileToBase64(file).then((payload) => {
          completed += 1;
          this.embeddingProgressCurrent = completed;
          this.embeddingProgressStage = 'Convirtiendo fotos';
          this.embeddingFinalStatus = `Procesando fotos (${completed}/${files.length})`;
          this.cdr.detectChanges();
          return payload;
        }),
      ),
    );
  }

  private async filesToBase64ResilientWithProgress(
    files: File[],
  ): Promise<{ payloads: { name: string; data: string }[]; failedFiles: string[] }> {
    let completed = 0;

    const settled = await Promise.all(
      files.map((file) =>
        this.fileToBase64(file)
          .then((payload) => ({ ok: true as const, payload }))
          .catch(() => ({ ok: false as const, fileName: file.name }))
          .finally(() => {
            completed += 1;
            this.embeddingProgressCurrent = completed;
            this.embeddingProgressStage = 'Convirtiendo fotos';
            this.embeddingFinalStatus = `Procesando fotos (${completed}/${files.length})`;
            this.cdr.detectChanges();
          }),
      ),
    );

    const payloads: { name: string; data: string }[] = [];
    const failedFiles: string[] = [];

    for (const item of settled) {
      if (item.ok) {
        payloads.push(item.payload);
      } else {
        failedFiles.push(item.fileName);
      }
    }

    return { payloads, failedFiles };
  }

  private async registerEmployeePhotosWithTimeout(
    payload: { employeeName: string; employeeId: string; files: { name: string; data: string }[] },
    timeoutMs: number,
  ): Promise<RegisterPhotosResponse> {
    const runAttempt = async (): Promise<RegisterPhotosResponse> => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      try {
        const requestPromise = firstValueFrom(this.attendanceService.registerEmployeePhotos(payload));
        const timeoutPromise = new Promise<RegisterPhotosResponse>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
        });

        return await Promise.race([requestPromise, timeoutPromise]);
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
      }
    }

    try {
      return await runAttempt();
    } catch (firstErr) {
      const firstMsg = this.extractBackendErrorMessage(firstErr).toLowerCase();
      const transient =
        firstMsg.includes('network') ||
        firstMsg.includes('connection') ||
        firstMsg.includes('unavailable') ||
        firstMsg.includes('status 0') ||
        firstMsg.includes('status 502') ||
        firstMsg.includes('status 503');

      if (!transient) {
        throw firstErr;
      }

      this.embeddingProgressStage = 'Reintentando guardado';
      this.embeddingFinalStatus = 'Reintentando guardado...';
      this.cdr.detectChanges();
      return runAttempt();
    }
  }

  private extractBackendErrorMessage(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 0) {
        return 'Sin conexión con backend/proxy. Verifica que el stack esté arriba (frontend 4200 y backend 8080).';
      }
      const statusPart = err.status ? `status ${err.status}` : 'sin status';
      if (typeof err.error === 'string' && err.error.trim()) {
        return `${err.error.trim()} (${statusPart})`;
      }
      if (err.error && typeof err.error.message === 'string' && err.error.message.trim()) {
        return `${err.error.message.trim()} (${statusPart})`;
      }
      if (err.message?.trim()) {
        return `${err.message.trim()} (${statusPart})`;
      }
      return `Error de backend (${statusPart})`;
    }

    const asError = err as Error;
    if (asError?.message?.trim()) {
      return asError.message.trim();
    }
    return '';
  }

  private extractFailedPhotoNames(errors: string[]): string[] {
    return this.extractPhotoNamesFromEntries(errors);
  }

  private buildRetryPhotoQueue(failedNames: string[], sourcePhotos: File[]): File[] {
    if (failedNames.length === 0 || sourcePhotos.length === 0) {
      return [];
    }

    const failedSet = new Set(failedNames.map((name) => name.toLocaleLowerCase()));
    return sourcePhotos.filter((file) => failedSet.has(file.name.toLocaleLowerCase()));
  }

  private resetEmbeddingProgress(): void {
    this.embeddingProgressCurrent = 0;
    this.embeddingProgressTotal = 0;
    this.embeddingProgressStage = '';
  }

  private resetEmbeddingWorkflowState(): void {
    if (this.embeddingWatchdogTimer) {
      clearTimeout(this.embeddingWatchdogTimer);
      this.embeddingWatchdogTimer = null;
    }
    this.selectedPhotos = [];
    this.processedEmbeddings = [];
    this.embeddingsReadyToSave = false;
    this.isExtracting = false;
    this.isSavingEmbeddings = false;
    this.embeddingNameInput = '';
    this.employeeIdInput = 0;
    this.embeddingFinalStatus = '';
    this.retryFailedPhotosQueue = [];
    this.isRetryFailedFlow = false;
    this.qualityWarningsMessage = '';
    this.resetEmbeddingProgress();
  }
}
