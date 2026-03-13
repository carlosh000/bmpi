import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface AttendanceRecord {
  row_id?: number;
  id: number;
  name: string;
  timestamp: string;
}

export interface CreateAttendanceRequest {
  employee_id: string;
  name?: string;
  timestamp?: string;
}

export interface UpdateAttendanceRequest {
  employee_id: string;
  name: string;
  timestamp: string;
}

export interface EmbeddingResult {
  fileName: string;
  embedding: number[];
  dimensions: number;
}

export interface EmbeddingExtractResponse {
  results: EmbeddingResult[];
  errors: string[];
}

export interface EmployeeRecord {
  employee_id: string;
  name: string;
}

export interface RegisterPhotosRequest {
  employeeName: string;
  employeeId: string;
  files: { name: string; data: string }[];
}

export interface RegisterPhotosResponse {
  saved: { employeeId: string; employeeName: string; photosProcessed: number; failedPhotos: number }[];
  errors: string[];
  qualityWarnings?: string[];
}

export interface EmployeeStorageRecord {
  employee_id: string;
  name: string;
  embedding_bytes: number;
  photo_bytes: number;
  photo_data_url: string;
}

export interface RecognizeBurstRequest {
  frames: { name: string; data: string }[];
  minVotes?: number;
  minConfidence?: number;
  registerAttendance: boolean;
}

export interface RecognizeBurstResponse {
  recognized: boolean;
  employee_id: string;
  name: string;
  confidence: number;
  bestFrameConfidence?: number;
  votes: number;
  minVotes: number;
  framesProcessed: number;
  recognizedFrames: number;
  attendanceLogged?: boolean;
  attendanceMessage?: string;
  errors?: string[];
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  role: string;
  username: string;
  expiresAt: string;
}

export interface RefreshResponse {
  token: string;
  role: string;
  username: string;
  expiresAt: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface AuthMeResponse {
  username: string;
  role: string;
}

export interface AuthUser {
  id: number;
  username: string;
  role: string;
  active: boolean;
  created_at: string;
}

export interface CreateUserRequest {
  username: string;
  password: string;
  role: string;
  active?: boolean;
}

export interface UpdateUserRequest {
  id: number;
  username?: string;
  role?: string;
  active?: boolean;
  password?: string;
}

@Injectable({ providedIn: 'root' })
export class AttendanceService {
  private apiBaseUrl = '/api';

  constructor(private http: HttpClient) {}

  private resolveAuthToken(): string {
    if (typeof window === 'undefined') {
      return '';
    }
    try {
      const localToken = window.localStorage.getItem('bmpi_auth_token');
      if (localToken && localToken.trim() !== '') {
        return localToken.trim();
      }
      const token = window.sessionStorage.getItem('bmpi_auth_token');
      return token?.trim() ?? '';
    } catch {
      return '';
    }
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

  extractEmbeddings(files: { name: string; data: string }[]): Observable<EmbeddingExtractResponse> {
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
}
