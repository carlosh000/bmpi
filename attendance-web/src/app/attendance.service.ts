import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { resolveStoredAuthToken } from './core/helpers';
import {
  AttendanceRecord,
  CreateAttendanceRequest,
  UpdateAttendanceRequest,
  EmployeeRecord,
  RegisterPhotoFile,
  RegisterPhotosRequest,
  RegisterPhotosResponse,
  EmployeeStorageRecord,
  EmbeddingExtractResponse,
  RecognizeBurstRequest,
  RecognizeBurstResponse,
  AuthMeResponse,
  AuthUser,
  ChangePasswordRequest,
  CreateUserRequest,
  LoginRequest,
  LoginResponse,
  RefreshResponse,
  UpdateUserRequest,
} from './core/dto';

@Injectable({ providedIn: 'root' })
export class AttendanceService {
  private apiBaseUrl = '/api';

  constructor(private http: HttpClient) {}

  private resolveAuthToken(): string {
    return resolveStoredAuthToken();
  }

  private authOptions(): { headers?: HttpHeaders } {
    const token = this.resolveAuthToken();
    if (!token) {
      return {};
    }
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return { headers: new HttpHeaders(headers) };
  }

  getAttendance(date?: string): Observable<AttendanceRecord[]> {
    const query = date ? `?date=${encodeURIComponent(date)}` : '';
    return this.http.get<AttendanceRecord[]>(`${this.apiBaseUrl}/attendance${query}`, this.authOptions());
  }

  createAttendance(payload: CreateAttendanceRequest): Observable<AttendanceRecord> {
    return this.http.post<AttendanceRecord>(`${this.apiBaseUrl}/attendance`, payload, this.authOptions());
  }

  updateAttendance(rowId: number, payload: UpdateAttendanceRequest): Observable<AttendanceRecord> {
    return this.http.put<AttendanceRecord>(`${this.apiBaseUrl}/attendance/${rowId}`, payload, this.authOptions());
  }

  deleteAttendance(rowId: number): Observable<void> {
    return this.http.delete<void>(`${this.apiBaseUrl}/attendance/${rowId}`, this.authOptions());
  }

  getEmployees(): Observable<EmployeeRecord[]> {
    return this.http.get<EmployeeRecord[]>(`${this.apiBaseUrl}/employees`, this.authOptions());
  }

  deleteEmployee(employeeId: string): Observable<void> {
    const query = `?employee_id=${encodeURIComponent(employeeId)}`;
    return this.http.delete<void>(`${this.apiBaseUrl}/employees${query}`, this.authOptions());
  }

  extractEmbeddings(files: RegisterPhotoFile[]): Observable<EmbeddingExtractResponse> {
    return this.http.post<EmbeddingExtractResponse>(`${this.apiBaseUrl}/embeddings/extract`, { files }, this.authOptions());
  }

  registerEmployeePhotos(payload: RegisterPhotosRequest): Observable<RegisterPhotosResponse> {
    return this.http.post<RegisterPhotosResponse>(`${this.apiBaseUrl}/employees/register-photos`, payload, this.authOptions());
  }

  getEmployeeStorage(): Observable<EmployeeStorageRecord[]> {
    return this.http.get<EmployeeStorageRecord[]>(`${this.apiBaseUrl}/employees/storage`, this.authOptions());
  }

  recognizeBurst(payload: RecognizeBurstRequest): Observable<RecognizeBurstResponse> {
    return this.http.post<RecognizeBurstResponse>(`${this.apiBaseUrl}/attendance/recognize-burst`, payload, this.authOptions());
  }

  login(payload: LoginRequest): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${this.apiBaseUrl}/auth/login`, payload, this.authOptions());
  }

  refreshToken(): Observable<RefreshResponse> {
    return this.http.post<RefreshResponse>(`${this.apiBaseUrl}/auth/refresh`, {}, this.authOptions());
  }

  getMe(): Observable<AuthMeResponse> {
    return this.http.get<AuthMeResponse>(`${this.apiBaseUrl}/auth/me`, this.authOptions());
  }

  logout(): Observable<void> {
    return this.http.post<void>(`${this.apiBaseUrl}/auth/logout`, {}, this.authOptions());
  }

  changePassword(payload: ChangePasswordRequest): Observable<void> {
    return this.http.post<void>(`${this.apiBaseUrl}/auth/password`, payload, this.authOptions());
  }

  getUsers(): Observable<AuthUser[]> {
    return this.http.get<AuthUser[]>(`${this.apiBaseUrl}/auth/users`, this.authOptions());
  }

  createUser(payload: CreateUserRequest): Observable<void> {
    return this.http.post<void>(`${this.apiBaseUrl}/auth/users`, payload, this.authOptions());
  }

  updateUser(payload: UpdateUserRequest): Observable<void> {
    return this.http.put<void>(`${this.apiBaseUrl}/auth/users`, payload, this.authOptions());
  }

  deleteUser(userID: number): Observable<void> {
    const query = `?id=${encodeURIComponent(String(userID))}`;
    return this.http.delete<void>(`${this.apiBaseUrl}/auth/users${query}`, this.authOptions());
  }
}
