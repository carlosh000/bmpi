import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ChangeDetectorRef, Component, ElementRef, Inject, NgZone, OnDestroy, OnInit, PLATFORM_ID, ViewChild } from '@angular/core';
import {
  AttendanceService,
  AttendanceRecord,
  EmbeddingResult,
  EmployeeStorageRecord,
  AuthUser,
  RecognizeBurstResponse,
  RegisterPhotosResponse,
} from './attendance.service';
import { finalize, firstValueFrom, timeout } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';

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
  imports: [CommonModule],
  template: `
    <div class="intro-splash" *ngIf="showIntroSplash" aria-hidden="true">
      <div class="intro-logo">
        <img src="bmpi-logo.png" alt="BMPI" />
      </div>
      <div class="intro-line"></div>
      <div class="intro-flash"></div>
    </div>
    <section class="attendance-container" [class.reveal]="uiRevealPulse">
      <header>
        <h2>Registro de Asistencia de la empresa BMPI</h2>
        <p class="description">
          Administra registros de asistencia y prepara embeddings faciales por empleado desde carpetas de fotos.
        </p>
      </header>

      <section class="panel" *ngIf="!isLoggedIn">
        <h3>Acceso</h3>
        <form class="login-form" (submit)="$event.preventDefault(); submitLogin()">
          <div class="form-grid">
            <label>
              Usuario
              <input
                #loginUsernameField
                type="text"
                [value]="loginUsername"
                (input)="loginUsername = readInputValue($event)"
              />
            </label>
            <label>
              Password
              <div class="password-field">
                <input
                  [type]="showLoginPassword ? 'text' : 'password'"
                  [value]="loginPassword"
                  (input)="loginPassword = readInputValue($event)"
                  (keydown)="onPasswordKeydown($event)"
                  (keyup)="onPasswordKeydown($event)"
                />
                <button type="button" class="small" (click)="showLoginPassword = !showLoginPassword">
                  {{ showLoginPassword ? 'Ocultar' : 'Ver' }}
                </button>
              </div>
              <small *ngIf="isCapsLockOn" class="hint-invalid">Caps Lock activado.</small>
            </label>
          </div>
          <div class="toolbar compact">
            <label class="inline-toggle">
              <input type="checkbox" [checked]="rememberLogin" (change)="rememberLogin = readInputBool($event)" />
              Recordar sesion en este equipo
            </label>
            <button type="submit" [disabled]="isLoggingIn || !canSubmitLogin()">
              {{ isLoggingIn ? 'Ingresando...' : 'Entrar' }}
            </button>
          </div>
        </form>
        <p class="status" *ngIf="authStatus">{{ authStatus }}</p>
        <p class="status" *ngIf="authInfo">{{ authInfo }}</p>
        <p class="error" *ngIf="authError">{{ authError }}</p>
      </section>

      <section class="panel" *ngIf="isLoggedIn">
        <h3>Sesion activa</h3>
        <p class="status">Usuario: {{ authUsername }} · Rol: {{ authRole }}</p>
        <p class="status">Sesion expira: {{ formatAuthExpiry(authExpiresAt) }}</p>
        <p class="status" *ngIf="authInfo">{{ authInfo }}</p>
        <div class="toolbar compact">
          <button type="button" class="small" (click)="openAccountView()">Mi cuenta</button>
          <button type="button" class="danger" (click)="logout()">Cerrar sesion</button>
        </div>
      </section>

      <section class="panel" *ngIf="activeView === 'account' && isLoggedIn">
        <h3>Mi cuenta</h3>
        <p class="status">Gestiona tu password y revisa el estado de tu sesion.</p>
        <div class="toolbar compact">
          <button type="button" class="section-toggle" (click)="backToHome()">Volver</button>
        </div>
        <div class="panel mini-panel">
          <div class="form-grid">
            <label>
              Password actual
              <input
                [type]="showCurrentPassword ? 'text' : 'password'"
                [value]="currentPasswordInput"
                (input)="currentPasswordInput = readInputValue($event)"
              />
            </label>
            <label>
              Nuevo password
              <input
                [type]="showNewPassword ? 'text' : 'password'"
                [value]="newPasswordInput"
                (input)="newPasswordInput = readInputValue($event)"
              />
            </label>
            <label>
              Confirmar nuevo password
              <input
                [type]="showConfirmPassword ? 'text' : 'password'"
                [value]="confirmPasswordInput"
                (input)="confirmPasswordInput = readInputValue($event)"
              />
            </label>
          </div>
          <div class="toolbar compact">
            <button type="button" class="small" (click)="togglePasswordVisibility('current')">
              {{ showCurrentPassword ? 'Ocultar' : 'Ver' }} actual
            </button>
            <button type="button" class="small" (click)="togglePasswordVisibility('new')">
              {{ showNewPassword ? 'Ocultar' : 'Ver' }} nuevo
            </button>
            <button type="button" class="small" (click)="togglePasswordVisibility('confirm')">
              {{ showConfirmPassword ? 'Ocultar' : 'Ver' }} confirmar
            </button>
            <button type="button" [disabled]="isUpdatingPassword || !canUpdatePassword()" (click)="updateOwnPassword()">
              {{ isUpdatingPassword ? 'Actualizando...' : 'Actualizar password' }}
            </button>
          </div>
          <p class="status" *ngIf="passwordStatus">{{ passwordStatus }}</p>
          <p class="error" *ngIf="passwordError">{{ passwordError }}</p>
        </div>
      </section>

      <section class="panel" *ngIf="activeView === 'home' && isLoggedIn">
        <h3>Tabla de asistencias</h3>
        <div class="toolbar section-toolbar">
          <button type="button" class="section-toggle" [disabled]="!canAccessAttendanceWrite()" (click)="openManualView()">Registro manual</button>
          <button type="button" class="section-toggle" [disabled]="!canAccessEmbedding()" (click)="openEmbeddingView()">Extraer embeddings</button>
          <button type="button" class="section-toggle" [disabled]="!canAccessRecognition()" (click)="openRecognitionView()">Reconocimiento entrada</button>
          <button type="button" class="section-toggle" *ngIf="canAccessUserAdmin()" (click)="openAdminView()">Usuarios y roles</button>
        </div>

        <div class="toolbar compact">
          <button type="button" [disabled]="attendance.length === 0 || !canAccessExports()" (click)="exportAsExcel()">Exportar Excel (CSV)</button>
          <button type="button" [disabled]="!canAccessAttendanceWrite()" (click)="openExcelImportPicker()">Importar Excel (CSV)</button>
          <button type="button" [disabled]="attendance.length === 0 || !canAccessExports()" (click)="exportAsPdf()">Exportar PDF</button>
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
                <button type="button" class="small" [disabled]="!isRecordFromToday(record) || !canAccessAttendanceWrite()" [title]="isRecordFromToday(record) ? '' : 'Solo se permite editar registros de hoy'" (click)="editRecord(record)">Editar</button>
                <button type="button" class="small danger" [disabled]="!isRecordFromToday(record) || !canAccessAttendanceWrite()" [title]="isRecordFromToday(record) ? '' : 'Solo se permite eliminar registros de hoy'" (click)="deleteRecord(record)">Eliminar</button>
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
        <p *ngIf="!canAccessAttendanceWrite()" class="status">No tienes permisos para registrar asistencia manual.</p>
        <ng-container *ngIf="canAccessAttendanceWrite()">
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
        </ng-container>
      </section>

      <section class="panel" *ngIf="activeView === 'embedding'">
        <h3>Extraer embeddings</h3>
        <p *ngIf="!canAccessEmbedding()" class="status">No tienes permisos para gestionar embeddings.</p>
        <ng-container *ngIf="canAccessEmbedding()">
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
          <button type="button" class="danger" [disabled]="!canAccessEmployeeDelete()" (click)="toggleDeleteEmployeePanel()">
            {{ showDeleteEmployeePanel ? 'Ocultar eliminar' : 'Eliminar empleado' }}
          </button>
        </div>

        <div class="panel admin-panel" *ngIf="showDeleteEmployeePanel && canAccessEmployeeDelete()">
          <h4>Eliminar empleado (admin)</h4>
          <div class="form-grid">
            <label>
              ID de empleado a eliminar
              <input
                type="number"
                min="1"
                [value]="deleteEmployeeIdInput"
                (input)="deleteEmployeeIdInput = readInputNumber($event)"
                placeholder="Ej: 1001"
              />
            </label>
            <div class="toolbar compact">
              <button type="button" class="danger" [disabled]="!canDeleteEmployee()" (click)="deleteEmployeeById()">
                {{ isDeletingEmployee ? 'Eliminando...' : 'Eliminar empleado' }}
              </button>
              <button type="button" (click)="toggleDeleteEmployeePanel()">Volver</button>
            </div>
          </div>
          <small class="row-lock-note">Esta accion borra embeddings, foto y asistencias del empleado.</small>
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
        </ng-container>
      </section>

      <section class="panel" *ngIf="activeView === 'recognition'">
        <h3>Reconocimiento en entrada (ráfaga)</h3>
        <p *ngIf="!canAccessRecognition()" class="status">No tienes permisos para reconocimiento en entrada.</p>
        <ng-container *ngIf="canAccessRecognition()">
        <div class="toolbar compact">
          <button type="button" class="section-toggle" (click)="backToHome()">Volver</button>
          <button type="button" [disabled]="isCameraRunning" (click)="startRecognitionCamera()">Iniciar cámara</button>
          <button type="button" class="danger" [disabled]="!isCameraRunning" (click)="stopRecognitionCamera()">Detener cámara</button>
          <button type="button" [disabled]="!canCaptureBurstNow()" (click)="captureBurstNow()">Capturar ahora</button>
        </div>

        <div class="toolbar compact">
          <label>
            Frames por ráfaga
            <input type="number" min="3" max="7" [value]="burstFrameCount" (input)="burstFrameCount = clampBurstFrameCount(readInputNumber($event))" />
          </label>
          <label>
            Intervalo entre frames (ms)
            <input type="number" min="120" max="600" [value]="burstFrameDelayMs" (input)="burstFrameDelayMs = clampBurstFrameDelayMs(readInputNumber($event))" />
          </label>
          <label>
            Votos mínimos
            <input type="number" min="1" max="5" [value]="burstMinVotes" (input)="burstMinVotes = clampBurstMinVotes(readInputNumber($event))" />
          </label>
          <label>
            Confianza mínima
            <input type="number" min="0.20" max="0.95" step="0.01" [value]="burstMinConfidence" (input)="burstMinConfidence = clampBurstMinConfidence(readInputNumber($event))" />
          </label>
          <label>
            <input type="checkbox" [checked]="autoRecognitionEnabled" (change)="onToggleAutoRecognition($event)" />
            Auto (escaneo continuo)
          </label>
        </div>

        <div *ngIf="message" class="toast toast-success">{{ message }}</div>
        <div *ngIf="errorMessage" class="toast toast-error">{{ errorMessage }}</div>
        <p *ngIf="recognitionStatus" class="status">{{ recognitionStatus }}</p>

        <div class="recognition-stage">
          <video #recognitionVideo autoplay muted playsinline></video>
          <canvas #recognitionCanvas class="hidden-input"></canvas>
        </div>
        </ng-container>
      </section>

      <section class="panel" *ngIf="activeView === 'admin'">
        <h3>Usuarios y roles</h3>
        <p *ngIf="!canAccessUserAdmin()" class="status">No tienes permisos para administrar usuarios.</p>
        <ng-container *ngIf="canAccessUserAdmin()">
          <div class="toolbar compact">
            <button type="button" class="section-toggle" (click)="backToHome()">Volver</button>
            <button type="button" [disabled]="isLoadingUsers" (click)="loadUsers()">
              {{ isLoadingUsers ? 'Cargando...' : 'Recargar usuarios' }}
            </button>
            <button type="button" [disabled]="authUsers.length === 0" (click)="exportUsersCsv()">Exportar usuarios (CSV)</button>
          </div>

          <form class="assign-form" (submit)="$event.preventDefault()">
            <h4>Crear usuario</h4>
            <div class="form-grid three">
              <label>
                Usuario
                <input type="text" [value]="newUserUsername" (input)="newUserUsername = readInputValue($event)" />
              </label>
              <label>
                Password
                <input type="password" [value]="newUserPassword" (input)="newUserPassword = readInputValue($event)" />
              </label>
              <label>
                Rol
                <select [value]="newUserRole" (change)="newUserRole = readInputValue($event)">
                  <option value="admin">admin</option>
                  <option value="rh">rh</option>
                  <option value="operator">operator</option>
                  <option value="vigilante">vigilante</option>
                  <option value="jefe">jefe</option>
                </select>
              </label>
            </div>
            <div class="toolbar compact">
              <label>
                <input type="checkbox" [checked]="newUserActive" (change)="newUserActive = readInputBool($event)" />
                Activo
              </label>
              <button type="button" [disabled]="isCreatingUser || !canCreateUser()" (click)="createUser()">
                {{ isCreatingUser ? 'Creando...' : 'Crear usuario' }}
              </button>
            </div>
          </form>

          <div *ngIf="userAdminStatus" class="toast toast-success">{{ userAdminStatus }}</div>
          <div *ngIf="userAdminError" class="toast toast-error">{{ userAdminError }}</div>

          <table class="mini-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Usuario</th>
                <th>Rol</th>
                <th>Activo</th>
                <th>Password nuevo</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let user of authUsers">
                <td>{{ user.id }}</td>
                <td>{{ user.username }}</td>
                <td>
                  <select [value]="getUserEdit(user.id).role" (change)="onUserRoleChange(user.id, $event)">
                    <option value="admin">admin</option>
                    <option value="rh">rh</option>
                    <option value="operator">operator</option>
                    <option value="vigilante">vigilante</option>
                    <option value="jefe">jefe</option>
                  </select>
                </td>
                <td>
                  <input type="checkbox" [checked]="getUserEdit(user.id).active" (change)="onUserActiveChange(user.id, $event)" />
                </td>
                <td>
                  <input
                    type="password"
                    [value]="getUserEdit(user.id).password"
                    (input)="onUserPasswordChange(user.id, $event)"
                    placeholder="Opcional"
                  />
                </td>
                <td>
                  <button type="button" class="small" [disabled]="isUpdatingUserId === user.id" (click)="updateUser(user)">
                    {{ isUpdatingUserId === user.id ? 'Actualizando...' : 'Actualizar' }}
                  </button>
                </td>
              </tr>
              <tr *ngIf="authUsers.length === 0">
                <td colspan="6" class="empty">No hay usuarios registrados.</td>
              </tr>
            </tbody>
          </table>
        </ng-container>
      </section>
    </section>
  `,
  styles: [
    `
      @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Unbounded:wght@500;700&display=swap');

      :host {
        --bg-base: #0f172a;
        --bg-muted: #111827;
        --surface: #f8fafc;
        --surface-strong: #ffffff;
        --text-main: #0f172a;
        --text-muted: #475569;
        --accent: #2563eb;
        --accent-soft: #93c5fd;
        --accent-warm: #f59e0b;
        --danger: #dc2626;
        --success: #16a34a;
        display: block;
        min-height: 100vh;
        position: relative;
        color: var(--text-main);
      }

      :host::before {
        content: '';
        position: fixed;
        inset: 0;
        background:
          radial-gradient(circle at 15% 20%, rgba(59, 130, 246, 0.18), transparent 50%),
          radial-gradient(circle at 85% 15%, rgba(245, 158, 11, 0.15), transparent 45%),
          linear-gradient(160deg, #f8fafc 0%, #eef2ff 50%, #e2e8f0 100%);
        z-index: -1;
      }

      .attendance-container {
        margin: 2.5rem auto 3rem;
        max-width: 1100px;
        font-family: 'Space Grotesk', 'Segoe UI', sans-serif;
        display: grid;
        gap: 1.6rem;
        position: relative;
        z-index: 1;
      }

      .attendance-container.reveal {
        opacity: 0;
        transform: translateY(18px) scale(0.98);
        animation: container-in 720ms ease 0.85s forwards;
      }

      header h2 {
        font-family: 'Unbounded', 'Space Grotesk', sans-serif;
        font-size: clamp(1.6rem, 2.2vw, 2.2rem);
        margin-bottom: 0.35rem;
        letter-spacing: -0.02em;
      }

      .description {
        color: var(--text-muted);
        margin-top: 0.25rem;
        max-width: 700px;
      }

      .intro-splash {
        position: fixed;
        inset: 0;
        background:
          radial-gradient(circle at 18% 22%, rgba(59, 130, 246, 0.18), transparent 45%),
          radial-gradient(circle at 82% 18%, rgba(245, 158, 11, 0.16), transparent 40%),
          linear-gradient(160deg, #f8fafc 0%, #eef2ff 50%, #e2e8f0 100%);
        display: grid;
        place-items: center;
        align-items: center;
        justify-items: center;
        gap: 1rem;
        z-index: 20;
        animation: splash-out 900ms ease 1.35s forwards;
        pointer-events: none;
        overflow: hidden;
        padding: 0;
      }

      .intro-splash::before {
        content: '';
        position: absolute;
        inset: -10%;
        background:
          radial-gradient(circle at 20% 30%, rgba(59, 130, 246, 0.22), transparent 55%),
          radial-gradient(circle at 78% 20%, rgba(245, 158, 11, 0.2), transparent 50%);
        opacity: 0.9;
        animation: splash-zoom 1.6s ease forwards;
      }

      .intro-logo {
        display: grid;
        place-items: center;
        width: 100vw;
        height: 100vh;
        justify-items: center;
        align-items: center;
        filter: drop-shadow(0 28px 50px rgba(15, 23, 42, 0.4));
        transform: translateZ(0) scale(0.9);
        animation: letters-in 520ms ease forwards, letters-out 820ms ease 0.85s forwards;
      }

      .intro-logo img {
        display: block;
        margin: 0 auto;
        max-width: min(90vw, 900px);
        max-height: 80vh;
        width: auto;
        height: auto;
        object-fit: contain;
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
        transform: translateZ(0);
        will-change: transform, opacity, filter;
        image-rendering: auto;
        filter: none;
        opacity: 1;
      }

      .intro-flash {
        position: absolute;
        inset: 0;
        background: #ffffff;
        opacity: 0;
        animation: flash-pop 1.2s ease 0.95s forwards;
        pointer-events: none;
      }

      .intro-line {
        width: min(60vw, 360px);
        height: 3px;
        background: linear-gradient(90deg, transparent, rgba(147, 197, 253, 0.9), transparent);
        opacity: 0;
        animation: line-scan 650ms ease 0.28s forwards;
      }

      .panel {
        border-radius: 18px;
        padding: 1.2rem 1.4rem;
        background: linear-gradient(145deg, #ffffff 0%, #f8fbff 100%);
        border: 1px solid rgba(148, 163, 184, 0.35);
        box-shadow: 0 18px 45px rgba(15, 23, 42, 0.08);
        animation: panel-in 520ms ease;
      }

      .mini-panel {
        margin-top: 0.9rem;
        background: #f1f5f9;
        border: 1px dashed rgba(148, 163, 184, 0.55);
        box-shadow: none;
      }

      .admin-panel {
        background: linear-gradient(145deg, #fff5f5 0%, #ffffff 100%);
        border-color: rgba(248, 113, 113, 0.35);
      }

      .toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        margin: 1rem 0;
      }

      .toolbar.compact { margin: 0.8rem 0; }
      .section-toolbar { margin-bottom: 0.35rem; }
      .login-form { display: grid; gap: 0.8rem; }
      .inline-toggle { display: inline-flex; align-items: center; gap: 0.5rem; font-size: 0.86rem; color: #475569; }
      .inline-toggle input { width: auto; }

      button {
        background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
        border: none;
        border-radius: 10px;
        color: #fff;
        cursor: pointer;
        font-size: 0.95rem;
        padding: 0.6rem 1rem;
        transition: transform 160ms ease, box-shadow 160ms ease, opacity 160ms ease;
        box-shadow: 0 8px 18px rgba(37, 99, 235, 0.25);
      }

      button:hover { transform: translateY(-1px); }
      button:active { transform: translateY(0); }
      button.small { padding: 0.4rem 0.65rem; font-size: 0.85rem; }

      button.section-toggle {
        font-size: 1rem;
        font-weight: 600;
        padding: 0.75rem 1.1rem;
        background: linear-gradient(135deg, #0f172a 0%, #1f2937 100%);
        box-shadow: 0 12px 18px rgba(15, 23, 42, 0.2);
      }

      button.danger {
        background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
        box-shadow: 0 10px 18px rgba(185, 28, 28, 0.22);
      }

      button:disabled {
        background: #94a3b8;
        cursor: not-allowed;
        box-shadow: none;
        transform: none;
      }

      .hidden-input { display: none; }
      .status { margin: 0.35rem 0; color: #0f172a; }

      .progress-wrap { display: flex; align-items: center; gap: 0.6rem; margin: 0.4rem 0 0.7rem; }
      .progress-track { flex: 1; height: 10px; border-radius: 999px; background: rgba(148, 163, 184, 0.35); overflow: hidden; }
      .progress-fill { height: 100%; background: #2563eb; transition: width 180ms ease; }
      .progress-fill.complete { background: #16a34a; }
      .progress-fill.error { background: #dc2626; }

      .error { margin: 0.35rem 0; color: #b91c1c; }

      .toast {
        border-radius: 12px;
        font-size: 0.9rem;
        margin: 0.55rem 0;
        padding: 0.65rem 0.9rem;
        box-shadow: 0 10px 18px rgba(15, 23, 42, 0.1);
      }

      .toast-success { background: #dcfce7; border: 1px solid #86efac; color: #166534; }
      .toast-error { background: #fee2e2; border: 1px solid #fca5a5; color: #991b1b; }
      .toast-warning { background: #fef3c7; border: 1px solid #fcd34d; color: #92400e; }

      .form-grid {
        display: grid;
        gap: 0.75rem;
        grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
        align-items: end;
      }

      .form-grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }

      label {
        display: grid;
        gap: 0.35rem;
        font-size: 0.9rem;
        color: #334155;
      }

      .password-field { display: grid; grid-template-columns: 1fr auto; gap: 0.5rem; align-items: center; }
      small { font-size: 0.78rem; }
      .hint-valid { color: #166534; }
      .hint-invalid { color: #b91c1c; }

      input, select {
        border: 1px solid rgba(148, 163, 184, 0.5);
        border-radius: 10px;
        padding: 0.55rem 0.7rem;
        font-family: inherit;
        background: #fff;
        transition: border-color 150ms ease, box-shadow 150ms ease;
      }

      input:focus, select:focus {
        outline: none;
        border-color: rgba(37, 99, 235, 0.8);
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
      }

      table { border-collapse: collapse; width: 100%; margin-top: 0.75rem; }
      th, td { border: 1px solid rgba(148, 163, 184, 0.4); padding: 0.65rem; }
      th { background: #eff6ff; text-align: left; font-weight: 600; }
      tbody tr { transition: background 160ms ease; }
      tbody tr:hover { background: rgba(59, 130, 246, 0.05); }

      .actions { display: flex; gap: 0.5rem; }
      .row-lock-note { align-self: center; color: #6b7280; font-size: 0.75rem; }
      .empty { color: #6b7280; text-align: center; }

      .embedding-results {
        background: #fff;
        border: 1px solid rgba(226, 232, 240, 0.85);
        border-radius: 12px;
        margin-top: 1rem;
        padding: 0.85rem;
      }

      .embedding-results ul { list-style: none; margin: 0; padding: 0; }
      .embedding-results li { align-items: baseline; display: flex; gap: 0.75rem; padding: 0.25rem 0; }
      .embedding-results span { color: #475569; font-family: 'Courier New', monospace; }

      .mini-table { margin-top: 1rem; }

      .recognition-stage {
        margin-top: 0.8rem;
        border: 1px solid rgba(148, 163, 184, 0.6);
        border-radius: 14px;
        overflow: hidden;
        max-width: 560px;
        background: #0f172a;
        box-shadow: 0 16px 30px rgba(15, 23, 42, 0.2);
      }

      .recognition-stage video { display: block; width: 100%; height: auto; }

      @keyframes container-in {
        from { opacity: 0; transform: translateY(18px) scale(0.98); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }

      @keyframes panel-in {
        from { opacity: 0; transform: translateY(12px); }
        to { opacity: 1; transform: translateY(0); }
      }

      @keyframes splash-out {
        0% { opacity: 1; }
        70% { opacity: 1; }
        100% { opacity: 0; visibility: hidden; }
      }

      @keyframes splash-zoom {
        0% { transform: scale(1); }
        100% { transform: scale(1.08); }
      }

      @keyframes letters-in {
        0% { opacity: 0; transform: scale(0.82) translateY(6px); filter: none; }
        100% { opacity: 1; transform: scale(1) translateY(0); filter: none; }
      }

      @keyframes letters-out {
        0% { opacity: 1; transform: scale(1) translateY(0); filter: none; }
        40% { opacity: 1; transform: scale(1.35) translateY(-6px); filter: blur(1px); }
        100% { opacity: 0; transform: scale(2.6) translateY(-12px); filter: blur(8px); }
      }

      @keyframes flash-pop {
        0% { opacity: 0; }
        20% { opacity: 0.55; }
        100% { opacity: 0; }
      }

      @keyframes line-scan {
        0% { opacity: 0; transform: scaleX(0.4); }
        100% { opacity: 1; transform: scaleX(1); }
      }

      @media (max-width: 900px) {
        .attendance-container { margin: 1.5rem 1rem 2.5rem; }
        .form-grid { grid-template-columns: 1fr; }
        .form-grid.three { grid-template-columns: 1fr; }
        .actions { flex-direction: column; }
        button.section-toggle { width: 100%; justify-content: center; }
      }
    `,
  ],
})
export class AttendanceListComponent implements OnInit, OnDestroy {
  @ViewChild('manualEmployeeIdField') manualEmployeeIdField?: ElementRef<HTMLInputElement>;
  @ViewChild('manualEmployeeNameField') manualEmployeeNameField?: ElementRef<HTMLInputElement>;
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
  manualEmployeeNameInput = '';
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
    if (!this.canAccessUserAdmin()) {
      this.errorMessage = 'No tienes permisos para administrar usuarios.';
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
    try {
      await firstValueFrom(this.attendanceService.logout());
    } catch {
      // ignore backend logout errors
    } finally {
      this.backToHome();
      this.clearAuthState();
      this.authStatus = 'Sesion cerrada.';
      this.focusLoginInput();
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
      this.errorMessage = 'Este navegador no soporta acceso a cámara.';
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
        this.errorMessage = 'No se pudo inicializar el visor de cámara.';
        this.stopRecognitionCamera();
        return;
      }

      video.srcObject = stream;
      await video.play();
      this.isCameraRunning = true;
      this.recognitionStatus = 'Cámara activa. Esperando rostro...';
      this.configureAutoRecognitionLoop();
    } catch {
      this.errorMessage = 'No se pudo abrir la cámara. Revisa permisos.';
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
      this.recognitionStatus = 'Cámara detenida.';
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
    this.recognitionStatus = 'Analizando ráfaga...';

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
      this.recognitionStatus = `Reconocido: ${response.name || response.employee_id} · conf ${confidencePct}% · votos ${response.votes}/${response.minVotes} · ${attendanceText}`;
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
    if (!this.canAccessUserAdmin()) {
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
    const headers = ['id', 'username', 'role', 'active', 'created_at'];
    const rows = this.authUsers.map((user) => [
      user.id,
      user.username,
      user.role,
      user.active ? 'true' : 'false',
      user.created_at,
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
