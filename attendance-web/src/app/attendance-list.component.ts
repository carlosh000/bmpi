import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ChangeDetectorRef, Component, ElementRef, Inject, NgZone, OnDestroy, OnInit, PLATFORM_ID, ViewChild } from '@angular/core';
import { AttendanceService } from './attendance.service';
import { finalize, firstValueFrom, timeout } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import {
  AttendanceRecord,
  AuthUser,
  EmployeeStorageRecord,
  RegisterPhotosResponse,
  EmbeddingResult,
  RecognizeBurstResponse,
} from './core/dto';
import { extractHttpErrorMessage } from './core/helpers';
import { UiButtonComponent } from './shared/ui';

interface EmbeddingAssignment {
  employeeId: number;
  employeeName: string;
  fileName: string;
  dimensions: number;
  createdAt: string;
  source?: 'db' | 'session';
}

interface UserEditState {
  role: string;
  active: boolean;
  password: string;
}

@Component({
  selector: 'app-attendance-list',
  standalone: true,
  imports: [CommonModule, UiButtonComponent],
  templateUrl: './attendance-list.component.html',
  styleUrl: './attendance-list.component.scss',
})
export class AttendanceListComponent implements OnInit, OnDestroy {
  @ViewChild('manualEmployeeIdField') manualEmployeeIdField?: ElementRef<HTMLInputElement>;
  @ViewChild('photoFolderInput') photoFolderInput?: ElementRef<HTMLInputElement>;
  @ViewChild('excelImportInput') excelImportInput?: ElementRef<HTMLInputElement>;
  @ViewChild('attendanceDateInput') attendanceDateInput?: ElementRef<HTMLInputElement>;
  @ViewChild('loginUsernameField') loginUsernameField?: ElementRef<HTMLInputElement>;
  @ViewChild('recognitionVideo') recognitionVideo?: ElementRef<HTMLVideoElement>;
  @ViewChild('recognitionCanvas') recognitionCanvas?: ElementRef<HTMLCanvasElement>;

  attendance: AttendanceRecord[] = [];
  selectedAttendanceDate = '';
  selectedPhotos: File[] = [];
  processedEmbeddings: EmbeddingResult[] = [];
  embeddingAssignments: EmbeddingAssignment[] = [];
  employeeStorageRecords: EmployeeStorageRecord[] = [];
  manualEmployeeIdInput = '';
  embeddingNameInput = '';
  employeeIdInput = 0;
  deleteEmployeeIdInput = 0;
  showDeleteEmployeePanel = false;
  embeddingsReadyToSave = false;
  embeddingProgressCurrent = 0;
  embeddingProgressTotal = 0;
  embeddingProgressStage = '';
  embeddingFinalStatus = '';
  retryFailedPhotosQueue: File[] = [];
  private isRetryFailedFlow = false;
  recognitionStatus = '';
  burstFrameCount = 4;
  burstFrameDelayMs = 220;
  burstMinVotes = 2;
  burstMinConfidence = 0.35;
  autoRecognitionEnabled = true;
  isCameraRunning = false;
  isRecognizingBurst = false;
  loginUsername = '';
  loginPassword = '';
  rememberLogin = true;
  isCapsLockOn = false;
  authRole = '';
  authUsername = '';
  authStatus = '';
  authToken = '';
  authExpiresAt = '';
  isLoggingIn = false;
  showLoginPassword = false;
  currentPasswordInput = '';
  newPasswordInput = '';
  confirmPasswordInput = '';
  showCurrentPassword = false;
  showNewPassword = false;
  showConfirmPassword = false;
  isUpdatingPassword = false;
  passwordStatus = '';
  passwordError = '';
  showIntroSplash = false;
  uiRevealPulse = false;
  isLogoutSplash = false;
  showSessionMenu = false;
  private introTimer: ReturnType<typeof setTimeout> | null = null;
  private revealStartTimer: ReturnType<typeof setTimeout> | null = null;
  private revealEndTimer: ReturnType<typeof setTimeout> | null = null;
  private inactivityTimer: ReturnType<typeof setInterval> | null = null;
  private authRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private authHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly inactivityLimitMs = 60 * 60 * 1000;
  private readonly lastActivityKey = 'bmpi_last_activity';
  private readonly selectedDateKey = 'bmpi_selected_date';
  private readonly rememberLoginKey = 'bmpi_auth_remember';
  private readonly activityHandler = () => this.recordActivity();
  authView: 'login' = 'login';
  authInfo = '';
  authError = '';
  private authInfoTimer: ReturnType<typeof setTimeout> | null = null;
  authUsers: AuthUser[] = [];
  userAdminStatus = '';
  userAdminError = '';
  isLoadingUsers = false;
  isCreatingUser = false;
  isUpdatingUserId: number | null = null;
  isDeletingUserId: number | null = null;
  newUserUsername = '';
  newUserPassword = '';
  newUserRole = 'vigilante';
  newUserActive = true;
  private userEdits: Record<string, UserEditState> = {};
  private readonly authTokenStorageKey = 'bmpi_auth_token';
  private readonly authRoleStorageKey = 'bmpi_auth_role';
  private readonly authUsernameStorageKey = 'bmpi_auth_username';
  private readonly authExpiresStorageKey = 'bmpi_auth_expires';
  private authStorage: Storage | null = null;
  private recognitionStream: MediaStream | null = null;
  private autoRecognitionTimer: ReturnType<typeof setInterval> | null = null;

  isExtracting = false;
  isSavingEmbeddings = false;
  isDeletingEmployee = false;
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

  get isLoggedIn(): boolean {
    return Boolean(this.authToken && this.authRole && this.authUsername);
  }

  isEditing = false;
  isCreating = false;
  activeView: 'home' | 'manual' | 'embedding' | 'recognition' | 'admin' | 'account' = 'home';
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
    if (this.inactivityTimer) {
      clearInterval(this.inactivityTimer);
      this.inactivityTimer = null;
    }
    if (this.authRefreshTimer) {
      clearTimeout(this.authRefreshTimer);
      this.authRefreshTimer = null;
    }
    if (this.authHeartbeatTimer) {
      clearInterval(this.authHeartbeatTimer);
      this.authHeartbeatTimer = null;
    }
    if (this.authInfoTimer) {
      clearTimeout(this.authInfoTimer);
      this.authInfoTimer = null;
    }
    if (this.authInfoTimer) {
      clearTimeout(this.authInfoTimer);
      this.authInfoTimer = null;
    }
    if (this.introTimer) {
      clearTimeout(this.introTimer);
      this.introTimer = null;
    }
    if (this.revealStartTimer) {
      clearTimeout(this.revealStartTimer);
      this.revealStartTimer = null;
    }
    if (this.revealEndTimer) {
      clearTimeout(this.revealEndTimer);
      this.revealEndTimer = null;
    }
    this.removeActivityListeners();
    this.stopRecognitionCamera();
  }

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.selectedAttendanceDate = this.loadSelectedDate() || this.getTodayDate();
      this.setupActivityListeners();
      this.setupInactivityWatcher();
      void this.loadAuth().then(() => {
        if (!this.isLoggedIn) {
          this.focusLoginInput();
        }
      });
    }
  }

  loadAttendance(dateOverride?: string): void {
    if (!this.canAccessAttendanceRead()) {
      return;
    }
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
    this.persistSelectedDate(selectedFromInput);
    this.loadAttendance(selectedFromInput);
  }

  setTodayAttendanceDate(): void {
    const today = this.getTodayDate();
    if (this.attendanceDateInput?.nativeElement) {
      this.attendanceDateInput.nativeElement.value = today;
    }
    this.persistSelectedDate(today);
    this.loadAttendance(today);
  }

  loadEmployeesFromDb(): void {
    if (!this.canAccessEmbedding()) {
      return;
    }
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
    if (!this.canAccessEmbedding()) {
      return;
    }
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
    if (!this.canAccessAttendanceWrite()) {
      this.errorMessage = 'No tienes permisos para registro manual.';
      return;
    }
    this.errorMessage = '';
    this.activeView = 'manual';
  }

  openEmbeddingView(): void {
    if (!this.canAccessEmbedding()) {
      this.errorMessage = 'No tienes permisos para gestionar embeddings.';
      return;
    }
    this.errorMessage = '';
    this.activeView = 'embedding';
  }

  openRecognitionView(): void {
    if (!this.canAccessRecognition()) {
      this.errorMessage = 'No tienes permisos para reconocimiento en entrada.';
      return;
    }
    this.errorMessage = '';
    this.activeView = 'recognition';
    this.message = '';
    this.recognitionStatus = 'Listo para iniciar camara.';
  }

  openAdminView(): void {
    if (!this.canAccessUserPanel()) {
      this.errorMessage = 'No tienes permisos para gestionar usuarios.';
      return;
    }
    this.errorMessage = '';
    this.activeView = 'admin';
    this.userAdminStatus = '';
    this.userAdminError = '';
    this.loadUsers();
  }

  canSubmitLogin(): boolean {
    return Boolean(this.loginUsername.trim() && this.loginPassword.trim());
  }

  async submitLogin(): Promise<void> {
    if (this.isLoggingIn || !this.canSubmitLogin()) {
      return;
    }
    this.isLoggingIn = true;
    this.authStatus = '';
    this.authError = '';
    try {
      const response = await firstValueFrom(
        this.attendanceService.login({
          username: this.loginUsername.trim(),
          password: this.loginPassword,
        }).pipe(timeout(12000)),
      );
      this.persistAuth(response.token, response.role, response.username, response.expiresAt);
      this.recordActivity();
      this.authToken = response.token;
      this.authRole = response.role;
      this.authUsername = response.username;
      this.authExpiresAt = response.expiresAt;
      this.loginPassword = '';
      this.isCapsLockOn = false;
      this.authStatus = 'Sesion iniciada correctamente.';
      this.authInfo = '';
      this.activeView = ['rh', 'jefe'].includes(response.role) ? 'account' : 'home';
      this.scheduleTokenRefresh();
      this.startAuthHeartbeat();
      this.playLoginIntro();
      if (this.canAccessAttendanceRead()) {
        this.loadAttendance();
      }
      if (this.canAccessEmbedding()) {
        this.loadEmployeesFromDb();
        this.loadEmployeeStorage();
      }
    } catch (err) {
      this.clearAuthState();
      if (err instanceof HttpErrorResponse) {
        if (err.status === 401 || err.status === 403) {
          this.authError = 'Usuario o password incorrectos, o cuenta inactiva.';
        } else if (err.status === 429) {
          this.authError = 'Demasiados intentos. Espera unos minutos e intenta de nuevo.';
        } else {
          this.authError = this.extractBackendErrorMessage(err) || 'No se pudo iniciar sesion.';
        }
      } else if (err && typeof err === 'object' && 'name' in err && (err as { name?: string }).name === 'TimeoutError') {
        this.authError = 'Tiempo de espera agotado. Revisa que el backend este en linea.';
      } else {
        this.authError = this.extractBackendErrorMessage(err) || 'No se pudo iniciar sesion.';
      }
      this.focusLoginInput();
    } finally {
      this.isLoggingIn = false;
      this.cdr.detectChanges();
    }
  }

  private playLoginIntro(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    this.isLogoutSplash = false;
    if (this.introTimer) {
      clearTimeout(this.introTimer);
      this.introTimer = null;
    }
    if (this.revealStartTimer) {
      clearTimeout(this.revealStartTimer);
      this.revealStartTimer = null;
    }
    if (this.revealEndTimer) {
      clearTimeout(this.revealEndTimer);
      this.revealEndTimer = null;
    }
    this.showIntroSplash = true;
    this.uiRevealPulse = false;
    this.revealStartTimer = setTimeout(() => {
      this.uiRevealPulse = true;
      this.cdr.detectChanges();
    }, 40);
    this.introTimer = setTimeout(() => {
      this.showIntroSplash = false;
      this.cdr.detectChanges();
    }, 1650);
    this.revealEndTimer = setTimeout(() => {
      this.uiRevealPulse = false;
      this.cdr.detectChanges();
    }, 1900);
  }

  private playLogoutOutro(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    this.isLogoutSplash = true;
    if (this.introTimer) {
      clearTimeout(this.introTimer);
      this.introTimer = null;
    }
    this.showIntroSplash = true;
    this.uiRevealPulse = false;
    this.introTimer = setTimeout(() => {
      this.showIntroSplash = false;
      this.cdr.detectChanges();
    }, 900);
  }

  private focusLoginInput(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    if (this.isLoggedIn) {
      return;
    }
    setTimeout(() => {
      this.loginUsernameField?.nativeElement.focus();
    }, 50);
  }

  onPasswordKeydown(event: KeyboardEvent): void {
    this.isCapsLockOn = event.getModifierState ? event.getModifierState('CapsLock') : false;
  }

  private scheduleTokenRefresh(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    if (this.authRefreshTimer) {
      clearTimeout(this.authRefreshTimer);
      this.authRefreshTimer = null;
    }
    if (!this.authExpiresAt) {
      return;
    }
    const expiryMs = new Date(this.authExpiresAt).getTime();
    if (!Number.isFinite(expiryMs)) {
      return;
    }
    const msUntilExpiry = expiryMs - Date.now();
    if (msUntilExpiry <= 0) {
      return;
    }
    const refreshInMs = Math.max(60_000, msUntilExpiry - 2 * 60_000);
    this.authRefreshTimer = setTimeout(() => {
      this.refreshAuthToken();
    }, refreshInMs);
  }

  private startAuthHeartbeat(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    if (this.authHeartbeatTimer) {
      clearInterval(this.authHeartbeatTimer);
    }
    this.authHeartbeatTimer = setInterval(() => {
      void this.checkAuthHeartbeat();
    }, 2 * 60 * 1000);
  }

  private async checkAuthHeartbeat(): Promise<void> {
    if (!this.isLoggedIn) {
      return;
    }
    try {
      await firstValueFrom(this.attendanceService.getMe().pipe(timeout(8000)));
    } catch (err) {
      if (err instanceof HttpErrorResponse && (err.status === 401 || err.status === 403)) {
        this.authStatus = 'Sesion cerrada por administrador.';
        this.clearAuthState();
        this.focusLoginInput();
      }
    }
  }

  private async refreshAuthToken(): Promise<void> {
    if (!this.isLoggedIn) {
      return;
    }
    try {
      const response = await firstValueFrom(this.attendanceService.refreshToken().pipe(timeout(12000)));
      this.authToken = response.token;
      this.authRole = response.role;
      this.authUsername = response.username;
      this.authExpiresAt = response.expiresAt;
      this.persistAuth(response.token, response.role, response.username, response.expiresAt);
      this.recordActivity();
      this.scheduleTokenRefresh();
      this.authInfo = 'Sesion renovada automaticamente.';
      if (this.authInfoTimer) {
        clearTimeout(this.authInfoTimer);
      }
      this.authInfoTimer = setTimeout(() => {
        this.authInfo = '';
        this.cdr.detectChanges();
      }, 6000);
    } catch (err) {
      if (err instanceof HttpErrorResponse && (err.status === 401 || err.status === 403)) {
        this.authStatus = 'Sesion expirada. Inicia sesion de nuevo.';
        this.clearAuthState();
        this.focusLoginInput();
      }
    }
  }

  formatAuthExpiry(expiresAt: string): string {
    if (!expiresAt) {
      return 'No disponible';
    }
    const parsed = new Date(expiresAt);
    if (Number.isNaN(parsed.getTime())) {
      return expiresAt;
    }
    return parsed.toLocaleString('es-MX', { hour12: false });
  }

  togglePasswordVisibility(kind: 'current' | 'new' | 'confirm'): void {
    if (kind === 'current') {
      this.showCurrentPassword = !this.showCurrentPassword;
    } else if (kind === 'new') {
      this.showNewPassword = !this.showNewPassword;
    } else {
      this.showConfirmPassword = !this.showConfirmPassword;
    }
  }

  openAccountView(): void {
    this.activeView = 'account';
    this.message = '';
    this.errorMessage = '';
  }

  toggleSessionMenu(): void {
    this.showSessionMenu = !this.showSessionMenu;
  }

  canUpdatePassword(): boolean {
    const current = this.currentPasswordInput.trim();
    const next = this.newPasswordInput.trim();
    const confirm = this.confirmPasswordInput.trim();
    return Boolean(current && next && confirm && next === confirm && next.length >= 8);
  }

  async updateOwnPassword(): Promise<void> {
    if (!this.canUpdatePassword() || this.isUpdatingPassword) {
      return;
    }
    this.isUpdatingPassword = true;
    this.passwordStatus = '';
    this.passwordError = '';
    try {
      await firstValueFrom(
        this.attendanceService.changePassword({
          currentPassword: this.currentPasswordInput,
          newPassword: this.newPasswordInput,
        }).pipe(timeout(12000)),
      );
      this.currentPasswordInput = '';
      this.newPasswordInput = '';
      this.confirmPasswordInput = '';
      this.passwordStatus = 'Password actualizado.';
      this.authInfo = '';
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 401) {
        this.passwordError = 'Password actual incorrecto.';
      } else {
        this.passwordError = this.extractBackendErrorMessage(err) || 'No se pudo actualizar el password.';
      }
    } finally {
      this.isUpdatingPassword = false;
      this.cdr.detectChanges();
    }
  }


  async loadAuth(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    this.loadAuthFromStorage();
    if (!this.authToken) {
      this.focusLoginInput();
      return;
    }
    if (this.isInactiveSession()) {
      this.clearAuthState();
      this.focusLoginInput();
      return;
    }
    try {
      const me = await firstValueFrom(this.attendanceService.getMe());
      this.authRole = me.role;
      this.authUsername = me.username;
      this.authStatus = 'Sesion activa.';
      this.persistAuth(this.authToken, me.role, me.username, this.authExpiresAt);
      this.recordActivity();
      this.startAuthHeartbeat();
      this.scheduleTokenRefresh();
      if (this.canAccessAttendanceRead()) {
        this.loadAttendance();
      }
      if (this.canAccessEmbedding()) {
        this.loadEmployeesFromDb();
        this.loadEmployeeStorage();
      }
    } catch {
      this.authStatus = 'Sesion no valida. Inicia sesion de nuevo.';
      this.clearAuthState();
      this.focusLoginInput();
    } finally {
      this.cdr.detectChanges();
    }
  }

  async logout(): Promise<void> {
    if (!this.isLoggedIn) {
      return;
    }
    if (isPlatformBrowser(this.platformId)) {
      const confirmed = window.confirm('Seguro que deseas cerrar sesion?');
      if (!confirmed) {
        return;
      }
    }
    // Cierre inmediato en UI
    this.playLogoutOutro();
    this.backToHome();
    this.clearAuthState();
    this.authStatus = 'Sesion cerrada.';
    this.showSessionMenu = false;
    this.focusLoginInput();
    try {
      await firstValueFrom(this.attendanceService.logout());
    } catch {
      // ignore backend logout errors
    }
  }

  private loadAuthFromStorage(): void {
    try {
      const rememberFlag = window.localStorage.getItem(this.rememberLoginKey);
      if (rememberFlag === '1') {
        this.rememberLogin = true;
      }
      const localToken = window.localStorage.getItem(this.authTokenStorageKey)?.trim() ?? '';
      if (localToken) {
        this.authStorage = window.localStorage;
        this.rememberLogin = true;
        this.authToken = localToken;
        this.authRole = window.localStorage.getItem(this.authRoleStorageKey)?.trim() ?? '';
        this.authUsername = window.localStorage.getItem(this.authUsernameStorageKey)?.trim() ?? '';
        this.authExpiresAt = window.localStorage.getItem(this.authExpiresStorageKey)?.trim() ?? '';
        return;
      }
      const sessionToken = window.sessionStorage.getItem(this.authTokenStorageKey)?.trim() ?? '';
      if (sessionToken) {
        this.authStorage = window.sessionStorage;
        this.rememberLogin = false;
        this.authToken = sessionToken;
        this.authRole = window.sessionStorage.getItem(this.authRoleStorageKey)?.trim() ?? '';
        this.authUsername = window.sessionStorage.getItem(this.authUsernameStorageKey)?.trim() ?? '';
        this.authExpiresAt = window.sessionStorage.getItem(this.authExpiresStorageKey)?.trim() ?? '';
        return;
      }
      this.authToken = '';
      this.authRole = '';
      this.authUsername = '';
      this.authExpiresAt = '';
      this.authStorage = null;
    } catch {
      this.authToken = '';
      this.authRole = '';
      this.authUsername = '';
      this.authExpiresAt = '';
      this.authStorage = null;
    }
  }

  private persistAuth(token: string, role: string, username: string, expiresAt: string): void {
    try {
      const storage = this.rememberLogin ? window.localStorage : window.sessionStorage;
      this.authStorage = storage;
      if (this.rememberLogin) {
        window.localStorage.setItem(this.rememberLoginKey, '1');
        window.sessionStorage.removeItem(this.authTokenStorageKey);
        window.sessionStorage.removeItem(this.authRoleStorageKey);
        window.sessionStorage.removeItem(this.authUsernameStorageKey);
        window.sessionStorage.removeItem(this.authExpiresStorageKey);
      } else {
        window.localStorage.removeItem(this.rememberLoginKey);
        window.localStorage.removeItem(this.authTokenStorageKey);
        window.localStorage.removeItem(this.authRoleStorageKey);
        window.localStorage.removeItem(this.authUsernameStorageKey);
        window.localStorage.removeItem(this.authExpiresStorageKey);
      }
      storage.setItem(this.authTokenStorageKey, token);
      storage.setItem(this.authRoleStorageKey, role);
      storage.setItem(this.authUsernameStorageKey, username);
      if (expiresAt) {
        storage.setItem(this.authExpiresStorageKey, expiresAt);
      }
    } catch {
      // ignore storage errors
    }
  }

  private clearAuthState(): void {
    this.authToken = '';
    this.authRole = '';
    this.authUsername = '';
    this.authExpiresAt = '';
    this.authStorage = null;
    if (this.authRefreshTimer) {
      clearTimeout(this.authRefreshTimer);
      this.authRefreshTimer = null;
    }
    if (this.authHeartbeatTimer) {
      clearInterval(this.authHeartbeatTimer);
      this.authHeartbeatTimer = null;
    }
    this.attendance = [];
    this.embeddingAssignments = [];
    this.employeeStorageRecords = [];
    this.authUsers = [];
    this.userAdminStatus = '';
    this.userAdminError = '';
    this.userEdits = {};
    this.authView = 'login';
    this.loginPassword = '';
    this.currentPasswordInput = '';
    this.newPasswordInput = '';
    this.confirmPasswordInput = '';
    this.passwordStatus = '';
    this.passwordError = '';
    this.authInfo = '';
    this.showSessionMenu = false;
    try {
      window.sessionStorage.removeItem(this.authTokenStorageKey);
      window.sessionStorage.removeItem(this.authRoleStorageKey);
      window.sessionStorage.removeItem(this.authUsernameStorageKey);
      window.sessionStorage.removeItem(this.authExpiresStorageKey);
      window.sessionStorage.removeItem(this.lastActivityKey);
      window.localStorage.removeItem(this.authTokenStorageKey);
      window.localStorage.removeItem(this.authRoleStorageKey);
      window.localStorage.removeItem(this.authUsernameStorageKey);
      window.localStorage.removeItem(this.authExpiresStorageKey);
      window.localStorage.removeItem(this.lastActivityKey);
    } catch {
      // ignore storage errors
    }
  }

  private resolveActivityStorage(): Storage | null {
    if (!isPlatformBrowser(this.platformId)) {
      return null;
    }
    if (this.authStorage) {
      return this.authStorage;
    }
    return this.rememberLogin ? window.localStorage : window.sessionStorage;
  }

  private recordActivity(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    try {
      const storage = this.resolveActivityStorage();
      storage?.setItem(this.lastActivityKey, String(Date.now()));
    } catch {
      // ignore storage errors
    }
  }

  private isInactiveSession(): boolean {
    if (!isPlatformBrowser(this.platformId)) {
      return false;
    }
    try {
      const storage = this.resolveActivityStorage();
      const raw = storage?.getItem(this.lastActivityKey);
      if (!raw) {
        return false;
      }
      const last = Number(raw);
      if (!Number.isFinite(last)) {
        return false;
      }
      return Date.now() - last > this.inactivityLimitMs;
    } catch {
      return false;
    }
  }

  private setupActivityListeners(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    window.addEventListener('click', this.activityHandler, { passive: true });
    window.addEventListener('keydown', this.activityHandler, { passive: true });
    window.addEventListener('mousemove', this.activityHandler, { passive: true });
    window.addEventListener('touchstart', this.activityHandler, { passive: true });
  }

  private removeActivityListeners(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    window.removeEventListener('click', this.activityHandler);
    window.removeEventListener('keydown', this.activityHandler);
    window.removeEventListener('mousemove', this.activityHandler);
    window.removeEventListener('touchstart', this.activityHandler);
  }

  private setupInactivityWatcher(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    if (this.inactivityTimer) {
      clearInterval(this.inactivityTimer);
    }
    this.inactivityTimer = setInterval(() => {
      if (this.isLoggedIn && this.isInactiveSession()) {
        this.logout();
      }
    }, 60000);
  }

  private persistSelectedDate(value: string): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    try {
      window.localStorage.setItem(this.selectedDateKey, value);
    } catch {
      // ignore storage errors
    }
  }

  private loadSelectedDate(): string {
    if (!isPlatformBrowser(this.platformId)) {
      return '';
    }
    try {
      return window.localStorage.getItem(this.selectedDateKey) ?? '';
    } catch {
      return '';
    }
  }

  private hasRole(roles: string[]): boolean {
    if (!this.isLoggedIn) {
      return false;
    }
    return roles.includes(this.authRole);
  }

  canAccessAttendanceRead(): boolean {
    return this.hasRole(['admin', 'rh', 'jefe', 'vigilante', 'operator']);
  }

  canAccessAttendanceWrite(): boolean {
    return this.hasRole(['admin', 'operator', 'vigilante']);
  }

  canAccessEmbedding(): boolean {
    return this.hasRole(['admin', 'rh']);
  }

  canAccessRecognition(): boolean {
    return this.hasRole(['admin', 'operator', 'vigilante']);
  }

  canAccessExports(): boolean {
    return this.hasRole(['admin', 'rh', 'jefe', 'vigilante', 'operator']);
  }

  canAccessEmployeeDelete(): boolean {
    return this.hasRole(['admin']);
  }

  canAccessUserAdmin(): boolean {
    return this.hasRole(['admin']);
  }

  canAccessUserPanel(): boolean {
    return this.hasRole(['admin', 'rh']);
  }

  canAccessUserDelete(): boolean {
    return this.hasRole(['admin', 'rh']);
  }

  backToHome(): void {
    this.errorMessage = '';
    this.stopRecognitionCamera();
    this.activeView = 'home';
  }

  async startRecognitionCamera(): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || this.isCameraRunning) {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      this.errorMessage = 'Este navegador no soporta acceso a camara.';
      return;
    }

    this.errorMessage = '';
    this.message = '';

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });

      this.recognitionStream = stream;
      const video = this.recognitionVideo?.nativeElement;
      if (!video) {
        this.errorMessage = 'No se pudo inicializar el visor de camara.';
        this.stopRecognitionCamera();
        return;
      }

      video.srcObject = stream;
      await video.play();
      this.isCameraRunning = true;
      this.recognitionStatus = 'Camara activa. Esperando rostro...';
      this.configureAutoRecognitionLoop();
    } catch {
      this.errorMessage = 'No se pudo abrir la camara. Revisa permisos.';
      this.stopRecognitionCamera();
    }
  }

  stopRecognitionCamera(): void {
    if (this.autoRecognitionTimer) {
      clearInterval(this.autoRecognitionTimer);
      this.autoRecognitionTimer = null;
    }

    if (this.recognitionStream) {
      this.recognitionStream.getTracks().forEach((track) => track.stop());
      this.recognitionStream = null;
    }

    const video = this.recognitionVideo?.nativeElement;
    if (video) {
      video.pause();
      video.srcObject = null;
    }

    this.isCameraRunning = false;
    this.isRecognizingBurst = false;
    if (this.activeView === 'recognition') {
      this.recognitionStatus = 'Camara detenida.';
    }
  }

  onToggleAutoRecognition(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.autoRecognitionEnabled = target.checked;
    this.configureAutoRecognitionLoop();
  }

  canCaptureBurstNow(): boolean {
    return this.isCameraRunning && !this.isRecognizingBurst;
  }

  async captureBurstNow(): Promise<void> {
    await this.captureBurstAndRecognize();
  }

  private configureAutoRecognitionLoop(): void {
    if (this.autoRecognitionTimer) {
      clearInterval(this.autoRecognitionTimer);
      this.autoRecognitionTimer = null;
    }

    if (!this.isCameraRunning || !this.autoRecognitionEnabled) {
      return;
    }

    this.autoRecognitionTimer = setInterval(() => {
      void this.captureBurstAndRecognize();
    }, 2200);
  }

  private async captureBurstAndRecognize(): Promise<void> {
    if (!this.isCameraRunning || this.isRecognizingBurst) {
      return;
    }

    const video = this.recognitionVideo?.nativeElement;
    const canvas = this.recognitionCanvas?.nativeElement;
    if (!video || !canvas) {
      return;
    }
    if (video.videoWidth <= 0 || video.videoHeight <= 0) {
      return;
    }

    this.isRecognizingBurst = true;
    this.recognitionStatus = 'Analizando rafaga...';

    try {
      const frames = await this.captureFramesFromVideo(video, canvas, this.burstFrameCount, this.burstFrameDelayMs);
      if (frames.length === 0) {
        this.recognitionStatus = 'No se pudo capturar frames.';
        return;
      }

      const response = await firstValueFrom(
        this.attendanceService.recognizeBurst({
          frames,
          minVotes: this.burstMinVotes,
          minConfidence: this.burstMinConfidence,
          registerAttendance: true,
        }),
      );

      this.applyBurstRecognitionResult(response);
      if (response.attendanceLogged) {
        this.loadAttendance();
      }
    } catch {
      this.recognitionStatus = 'Error en reconocimiento. Reintentando...';
    } finally {
      this.isRecognizingBurst = false;
      this.cdr.detectChanges();
    }
  }

  private async captureFramesFromVideo(
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    frameCount: number,
    delayMs: number,
  ): Promise<{ name: string; data: string }[]> {
    const safeCount = this.clampBurstFrameCount(frameCount);
    const safeDelay = this.clampBurstFrameDelayMs(delayMs);
    const frames: { name: string; data: string }[] = [];

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return frames;
    }

    for (let index = 0; index < safeCount; index++) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/jpeg', this.uploadJpegQuality);
      frames.push({
        name: `frame_${index + 1}.jpg`,
        data,
      });
      if (index < safeCount - 1) {
        await this.delay(safeDelay);
      }
    }

    return frames;
  }

  private applyBurstRecognitionResult(response: RecognizeBurstResponse): void {
    if (response.recognized) {
      const confidencePct = Math.round((response.confidence || 0) * 100);
      const attendanceText = response.attendanceLogged ? 'asistencia registrada' : response.attendanceMessage || 'sin registro';
      this.recognitionStatus = `Reconocido: ${response.name || response.employee_id}  -  conf ${confidencePct}%  -  votos ${response.votes}/${response.minVotes}  -  ${attendanceText}`;
      this.errorMessage = '';
      return;
    }

    if (response.errors && response.errors.length > 0) {
      this.recognitionStatus = `Sin reconocimiento (${response.framesProcessed} frames). ${response.errors[0]}`;
      return;
    }

    this.recognitionStatus = `Sin reconocimiento (${response.framesProcessed} frames).`;
  }

  clampBurstFrameCount(value: number): number {
    if (!Number.isFinite(value)) {
      return 4;
    }
    return Math.max(3, Math.min(7, Math.round(value)));
  }

  clampBurstFrameDelayMs(value: number): number {
    if (!Number.isFinite(value)) {
      return 220;
    }
    return Math.max(120, Math.min(600, Math.round(value)));
  }

  clampBurstMinVotes(value: number): number {
    if (!Number.isFinite(value)) {
      return 2;
    }
    return Math.max(1, Math.min(5, Math.round(value)));
  }

  clampBurstMinConfidence(value: number): number {
    if (!Number.isFinite(value)) {
      return 0.35;
    }
    const clamped = Math.max(0.2, Math.min(0.95, value));
    return Number(clamped.toFixed(2));
  }

  private async delay(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), ms);
    });
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

  async confirmEmbeddingExtraction(): Promise<void> {
    if (this.isExtracting) {
      return;
    }

    const minPhotosRequired = this.isRetryFailedFlow ? 1 : 5;
    if (this.selectedPhotos.length < minPhotosRequired || this.selectedPhotos.length > 10) {
      this.errorMessage = this.isRetryFailedFlow
        ? 'Para reintento se requiere entre 1 y 10 fotos fallidas.'
        : 'Para precision, cada empleado debe tener entre 5 y 10 fotos.';
      this.message = '';
      return;
    }

    const name = this.embeddingNameInput.trim();
    const employeeId = Number(this.employeeIdInput);
    if (!name || !Number.isFinite(employeeId) || employeeId <= 0) {
      this.errorMessage = 'Debes completar nombre e ID validos antes de extraer.';
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
      this.errorMessage = 'La operacion tardo demasiado y fue detenida. Intenta con fotos mas ligeras o reintenta.';
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
        this.embeddingFinalStatus = 'Error al guardar (ninguna foto valida)';
        this.message = '';
        return;
      }

      if (!this.isRetryFailedFlow && filesPayload.length < 5) {
        this.embeddingProgressStage = 'Error';
        this.embeddingFinalStatus = `Error al guardar (solo ${filesPayload.length} foto(s) validas)`;
        this.errorMessage = `Se requieren entre 5 y 10 fotos validas por empleado. Solo quedaron ${filesPayload.length}.`;
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
          `OK Datos faciales guardados con exito: empleado ${response.saved[0].employeeId}, ${processedPhotos} foto(s), ${elapsedSeconds}s.`,
          5000,
        );
        this.embeddingProgressStage = 'Guardado exitoso';
        this.embeddingFinalStatus = `Guardado exitoso (${processedPhotos} foto(s), ${elapsedSeconds}s)`;
        this.retryFailedPhotosQueue = [];
      } else if (response.saved.length > 0) {
        this.showMessageForDuration(
          `ADVERTENCIA Guardado parcial: empleado ${response.saved[0].employeeId}, ${processedPhotos} procesadas, ${failedPhotos} fallidas, ${elapsedSeconds}s.`,
          5000,
        );
        this.embeddingProgressStage = 'Guardado parcial';
        this.embeddingFinalStatus = `Guardado parcial (${processedPhotos} OK / ${failedPhotos} fallidas, ${elapsedSeconds}s)`;
      } else {
        this.showMessageForDuration(
          `ERROR No se guardaron datos faciales. Revisa el error y vuelve a intentar. (${elapsedSeconds}s)`,
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
        this.embeddingFinalStatus = 'Error al guardar (fallo conexion o backend)';
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
      this.errorMessage = `Se requieren entre 5 y 10 embeddings validos por empleado. Actualmente: ${this.processedEmbeddings.length}.`;
      this.message = '';
      return;
    }

    if (this.isSavingEmbeddings) {
      return;
    }

    const name = this.embeddingNameInput.trim();

    this.isSavingEmbeddings = true;
    this.errorMessage = '';
    this.message = 'Preparando imagenes para extraccion...';
    const startedAt = Date.now();

    try {
      const processedFileNames = new Set(this.processedEmbeddings.map((item) => item.fileName));
      const filesToPersist = this.selectedPhotos.filter((photo) => processedFileNames.has(photo.name));

      if (filesToPersist.length === 0) {
        this.errorMessage = 'No hay fotos validas para guardar en base de datos.';
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
        this.message = `OK Confirmacion BD: empleado ${response.saved[0].employeeId} guardado con ${processedPhotos} foto(s) en ${elapsedSeconds}s.`;
      } else if (response.saved.length > 0) {
        this.message = `ADVERTENCIA Guardado parcial: empleado ${response.saved[0].employeeId}, confirmados en BD ${confirmedCount}/${response.saved.length} en ${elapsedSeconds}s.`;
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

  canDeleteEmployee(): boolean {
    return Number.isFinite(this.deleteEmployeeIdInput) && this.deleteEmployeeIdInput > 0 && !this.isDeletingEmployee;
  }

  async deleteEmployeeById(): Promise<void> {
    if (!this.canAccessEmployeeDelete() || !this.canDeleteEmployee()) {
      return;
    }
    const employeeId = String(this.deleteEmployeeIdInput);
    const confirmed = window.confirm(
      `Eliminar definitivamente al empleado ${employeeId}? Esto borra embeddings, foto y asistencias.`,
    );
    if (!confirmed) {
      return;
    }
    this.isDeletingEmployee = true;
    try {
      await firstValueFrom(this.attendanceService.deleteEmployee(employeeId));
      this.message = `Empleado ${employeeId} eliminado correctamente.`;
      this.errorMessage = '';
      this.deleteEmployeeIdInput = 0;
      this.loadEmployeesFromDb();
      this.loadEmployeeStorage();
    } catch (err) {
      this.errorMessage = this.extractBackendErrorMessage(err) || 'No se pudo eliminar el empleado.';
    } finally {
      this.isDeletingEmployee = false;
      this.cdr.detectChanges();
    }
  }

  toggleDeleteEmployeePanel(): void {
    if (!this.canAccessEmployeeDelete()) {
      this.errorMessage = 'No tienes permisos para eliminar empleados.';
      return;
    }
    this.showDeleteEmployeePanel = !this.showDeleteEmployeePanel;
  }

  loadUsers(): void {
    if (!this.canAccessUserPanel()) {
      return;
    }
    this.isLoadingUsers = true;
    this.userAdminError = '';
    this.attendanceService
      .getUsers()
      .pipe(
        finalize(() => {
          this.isLoadingUsers = false;
          this.cdr.detectChanges();
        }),
      )
      .subscribe({
        next: (users) => {
          this.authUsers = users;
          this.syncUserEdits(users);
        },
        error: () => {
          this.userAdminError = 'No se pudieron cargar usuarios.';
        },
      });
  }

  canCreateUser(): boolean {
    return Boolean(
      this.newUserUsername.trim() && this.newUserPassword.trim() && this.newUserRole.trim(),
    );
  }

  async createUser(): Promise<void> {
    if (!this.canAccessUserAdmin() || this.isCreatingUser || !this.canCreateUser()) {
      return;
    }
    this.isCreatingUser = true;
    this.userAdminStatus = '';
    this.userAdminError = '';
    try {
      await firstValueFrom(
        this.attendanceService.createUser({
          username: this.newUserUsername.trim(),
          password: this.newUserPassword,
          role: this.newUserRole.trim(),
          active: this.newUserActive,
        }),
      );
      this.userAdminStatus = 'Usuario creado correctamente.';
      this.newUserUsername = '';
      this.newUserPassword = '';
      this.newUserRole = 'vigilante';
      this.newUserActive = true;
      this.loadUsers();
    } catch (err) {
      this.userAdminError = this.extractBackendErrorMessage(err) || 'No se pudo crear el usuario.';
    } finally {
      this.isCreatingUser = false;
      this.cdr.detectChanges();
    }
  }

  exportUsersCsv(): void {
    if (this.authUsers.length === 0) {
      return;
    }
    const exportedAt = this.getExportTimestampLabel();
    const headers = ['id', 'username', 'role', 'active', 'created_at', 'exported_at'];
    const rows = this.authUsers.map((user) => [
      user.id,
      user.username,
      user.role,
      user.active ? 'true' : 'false',
      user.created_at,
      exportedAt,
    ]);
    this.downloadCsv('usuarios.csv', [headers, ...rows]);
  }

  getUserEdit(userID: number): UserEditState {
    const key = String(userID);
    const existing = this.userEdits[key];
    if (existing) {
      return existing;
    }
    const user = this.authUsers.find((row) => row.id === userID);
    const fallback: UserEditState = {
      role: user?.role ?? 'vigilante',
      active: user?.active ?? true,
      password: '',
    };
    this.userEdits[key] = fallback;
    return fallback;
  }

  onUserRoleChange(userID: number, event: Event): void {
    this.getUserEdit(userID).role = this.readInputValue(event);
  }

  onUserActiveChange(userID: number, event: Event): void {
    this.getUserEdit(userID).active = this.readInputBool(event);
  }

  onUserPasswordChange(userID: number, event: Event): void {
    this.getUserEdit(userID).password = this.readInputValue(event);
  }

  private syncUserEdits(users: AuthUser[]): void {
    const next: Record<string, UserEditState> = {};
    users.forEach((user) => {
      next[String(user.id)] = {
        role: user.role,
        active: user.active,
        password: '',
      };
    });
    this.userEdits = next;
  }

  async updateUser(user: AuthUser): Promise<void> {
    if (!this.canAccessUserAdmin() || this.isUpdatingUserId !== null) {
      return;
    }
    const edit = this.getUserEdit(user.id);
    if (this.isCurrentAuthUser(user) && edit.role !== user.role) {
      this.userAdminError = 'No puedes cambiar tu propio rol desde este panel.';
      return;
    }
    if (this.isCurrentAuthUser(user) && edit.active !== user.active) {
      this.userAdminError = 'No puedes desactivarte a ti mismo.';
      return;
    }
    if (edit.password.trim()) {
      const confirmed = window.confirm('Confirmar cambio de password para este usuario?');
      if (!confirmed) {
        return;
      }
    }
    if (edit.active === false && user.active === true) {
      const confirmed = window.confirm(`Desactivar usuario ${user.username}?`);
      if (!confirmed) {
        return;
      }
    }
    if (edit.role !== user.role) {
      const confirmed = window.confirm(`Cambiar rol de ${user.username} a ${edit.role}?`);
      if (!confirmed) {
        return;
      }
    }
    const payload: { id: number; role?: string; active?: boolean; password?: string } = { id: user.id };
    if (edit.role !== user.role) {
      payload.role = edit.role;
    }
    if (edit.active !== user.active) {
      payload.active = edit.active;
    }
    if (edit.password.trim()) {
      payload.password = edit.password.trim();
    }
    if (!payload.role && payload.active === undefined && !payload.password) {
      this.userAdminStatus = 'Sin cambios por aplicar.';
      return;
    }
    this.isUpdatingUserId = user.id;
    this.userAdminStatus = '';
    this.userAdminError = '';
    try {
      await firstValueFrom(this.attendanceService.updateUser(payload));
      this.userAdminStatus = 'Usuario actualizado.';
      this.loadUsers();
    } catch (err) {
      this.userAdminError = this.extractBackendErrorMessage(err) || 'No se pudo actualizar el usuario.';
    } finally {
      this.isUpdatingUserId = null;
      this.cdr.detectChanges();
    }
  }

  canDeleteUser(user: AuthUser): boolean {
    if (!this.canAccessUserDelete()) {
      return false;
    }
    if (this.isCurrentAuthUser(user)) {
      return false;
    }
    return this.isDeletingUserId === null && this.isUpdatingUserId === null;
  }

  async deleteUser(user: AuthUser): Promise<void> {
    if (!this.canDeleteUser(user)) {
      return;
    }
    const confirmed = window.confirm(`Eliminar usuario ${user.username}? Esta accion no se puede deshacer.`);
    if (!confirmed) {
      return;
    }

    this.isDeletingUserId = user.id;
    this.userAdminStatus = '';
    this.userAdminError = '';
    try {
      await firstValueFrom(this.attendanceService.deleteUser(user.id));
      this.userAdminStatus = 'Usuario eliminado.';
      this.loadUsers();
    } catch (err) {
      this.userAdminError = this.extractBackendErrorMessage(err) || 'No se pudo eliminar el usuario.';
    } finally {
      this.isDeletingUserId = null;
      this.cdr.detectChanges();
    }
  }

  isCurrentAuthUser(user: AuthUser): boolean {
    return this.isLoggedIn && !!this.authUsername && user.username === this.authUsername;
  }

  startCreateRecord(): void {
    this.isCreating = true;
    this.isEditing = false;
    this.editingOriginalRowId = null;
    this.manualEmployeeIdInput = '';
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
        this.errorMessage = 'El ID de empleado es obligatorio y debe ser un numero entero mayor a 0.';
        return;
      }
      const employeeId = String(parsedEmployeeId);

      const timestamp = this.normalizeManualTimestamp(this.editingRecord.timestamp);
      if (this.editingRecord.timestamp && !timestamp) {
        this.errorMessage = 'Fecha/Hora invalida. Usa un valor valido.';
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
        .createAttendance({ employee_id: employeeId, timestamp })
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
      name: '',
      timestamp: this.editingRecord.timestamp || this.toDateTimeLocal(new Date().toISOString()),
    };

    if (parsedEmployeeId === null) {
      this.errorMessage = 'El ID de empleado es obligatorio y debe ser un numero entero mayor a 0.';
      return;
    }

    const timestamp = this.normalizeManualTimestamp(this.editingRecord.timestamp);
    if (!timestamp) {
      this.errorMessage = 'Fecha/Hora invalida. Usa un valor valido.';
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
    const confirmed = window.confirm(`Seguro que deseas eliminar el registro ${displayId}?`);
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
    this.editingRecord = this.emptyRecord();
  }

  exportAsExcel(): void {
    const exportedAt = this.getExportTimestampLabel();
    const headers = ['id', 'name', 'timestamp', 'exported_at'];
    const rows = this.attendance.map((record) => [
      record.id,
      record.name,
      this.formatAttendanceTimestamp(record.timestamp),
      exportedAt,
    ]);
    this.downloadCsv('asistencia.csv', [headers, ...rows]);
  }

  exportAsPdf(): void {
    const exportedAt = this.getExportTimestampLabel();
    const exportedBy = this.authUsername ? `${this.authUsername} (${this.authRole})` : 'desconocido';
    const tableHtml = `
      <h2>Reporte de asistencia</h2>
      <p><strong>Exportado el:</strong> ${exportedAt}</p>
      <p><strong>Exportado por:</strong> ${exportedBy}</p>
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
      this.errorMessage = 'No se pudo abrir ventana de impresion para PDF.';
      return;
    }

    printWindow.document.write(`<html><body>${tableHtml}</body></html>`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }

  private getExportTimestampLabel(): string {
    return this.formatAttendanceTimestamp(new Date().toISOString());
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
          this.errorMessage = 'CSV invalido: verifica encabezados y columnas.';
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

  readInputBool(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
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

  isManualEmployeeIdValid(): boolean {
    return this.toPositiveEmployeeId(this.manualEmployeeIdInput) !== null;
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
      return `ADVERTENCIA Calidad de foto: ${payload} | +${warnings.length - cleaned.length} mas`;
    }

    return `ADVERTENCIA Calidad de foto: ${payload}`;
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
    this.message = `OK ${source} cargado: ${imported.length} registro(s) importado(s).`;
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
    return extractHttpErrorMessage(err);
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



