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
